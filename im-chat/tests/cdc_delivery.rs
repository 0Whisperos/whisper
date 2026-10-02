//! Real MySQL -> Debezium -> Kafka -> im-chat -> WebSocket acceptance test.
//! Set IM_CHAT_CDC_CONFIG to a repository-local config for an already migrated,
//! isolated database, Redis DB, and running Kafka/Connect. See README.md.

#[path = "cdc_delivery_environment.rs"]
mod environment;
#[path = "cdc_delivery_fixture.rs"]
mod fixture;
#[path = "cdc_delivery_kafka.rs"]
mod kafka;
#[path = "cdc_delivery_socket.rs"]
mod socket;

use anyhow::{Context, Result, ensure};
use environment::{Settings, TestServer};
use fixture::Fixture;
use kafka::Observer;
use serde_json::Value;
use socket::Client;
use std::time::Duration;
use tokio::time::{Instant, timeout_at};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires IM_CHAT_CDC_CONFIG and isolated MySQL/Redis/Kafka/Debezium; missing config is an error"]
async fn committed_messages_reach_both_clients_and_rollback_is_not_published() -> Result<()> {
    // 测试目标：验证真实 CDC 全链路双向投递、Kafka 映射和 Redis 完成标记，并确认回滚不会发布。
    // 构造方法：启动独立 im-chat 子进程，创建专用用户/会话，连接两个真实 WebSocket 和 Kafka 观察者。
    // 输入数据：双方使用相同 client_message_id 互发不同文本，中间重放首条 Kafka 事件并回滚一条同会话 outbox。
    // 预期行为：双方均收到正式消息且重放不重复投递；Kafka 映射、分区、offset 和 7 天去重 TTL 正确，游标不变。
    let (mut server, settings) = TestServer::start()?;
    let pool = settings.mysql.connect().await?;
    let fixture = Fixture::create(pool).await?;
    let result = exercise(&mut server, &settings, &fixture)
        .await
        .with_context(|| {
            format!(
                "CDC acceptance failed; server logs: {}",
                server.log_dir.display()
            )
        });
    drop(server);
    let cleanup = fixture.cleanup().await;
    result?;
    cleanup
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires IM_CHAT_CDC_CONFIG and isolated MySQL/Redis/Kafka/Debezium; missing config is an error"]
async fn two_nodes_forward_messages_and_receipts_without_advancing_cursors_on_push() -> Result<()> {
    // 测试目标：验证跨节点消息和回执通知、Kafka 重放去重，以及远端节点失效后的持久状态。
    // 构造方法：启动共享 Redis/MySQL/Kafka 消费组的两个 im-chat，双方分别连一个节点，再关闭接收方节点。
    // 输入数据：Alice 发序号 1 消息、Bob 上报送达和已读序号 1、重放该事件，Bob 快速重连后再发送消息，最后关闭节点 B 并再发一条。
    // 预期行为：双方收到正式消息，Alice 收到两种游标通知，重放无重复帧；重连消息只进入新连接，节点关闭后消息仍落库且 Bob 游标仍为 1。
    let (mut servers, settings) = TestServer::start_cluster(2)?;
    let pool = settings.mysql.connect().await?;
    let fixture = Fixture::create(pool).await?;
    let result = exercise_cluster(&mut servers, &settings, &fixture)
        .await
        .with_context(|| {
            format!(
                "two-node CDC acceptance failed; logs: {}, {}",
                servers[0].log_dir.display(),
                servers[1].log_dir.display()
            )
        });
    drop(servers);
    let cleanup = fixture.cleanup().await;
    result?;
    cleanup
}

async fn exercise_cluster(
    servers: &mut [TestServer],
    settings: &Settings,
    fixture: &Fixture,
) -> Result<()> {
    let observer = Observer::new(&settings.kafka)?;
    let (first_node, second_node) = servers.split_at_mut(1);
    let mut alice =
        Client::connect(&mut first_node[0], fixture.alice, &settings.auth.jwt_secret).await?;
    let mut bob =
        Client::connect(&mut second_node[0], fixture.bob, &settings.auth.jwt_secret).await?;
    let first = exchange(
        &mut alice,
        &mut bob,
        fixture.conversation,
        &Uuid::new_v4().to_string(),
        "cross-node message",
    )
    .await?;
    let seq = first["conversation_seq"]
        .as_u64()
        .context("sequence missing")?;
    let first_event = fixture
        .stored_event(first["message_id"].as_str().context("message id missing")?)
        .await?;
    let first_position = observer.expect_event(&first_event, None).await?;
    expect_done(settings, &first_event).await?;
    kafka::expect_committed(&settings.kafka, &first_position).await?;
    fixture.check_cursors_unchanged().await?;

    for (kind, accepted_type, expected_read) in [
        ("delivered_ack", "delivered_ack_accepted", 0),
        ("read_ack", "read_ack_accepted", seq),
    ] {
        bob.send_ack(kind, fixture.conversation, seq)?;
        let accepted = bob.receive().await?;
        ensure!(
            accepted["type"] == accepted_type,
            "Bob acknowledgement was not accepted"
        );
        let update = alice.receive().await?;
        ensure!(
            update["type"] == "conversation_receipt_updated",
            "Alice did not receive cross-node receipt update"
        );
        ensure!(
            update["payload"]["conversation_id"] == fixture.conversation,
            "receipt conversation mismatch"
        );
        ensure!(
            update["payload"]["user_id"] == fixture.bob,
            "receipt user mismatch"
        );
        ensure!(
            update["payload"]["delivered_seq"] == seq,
            "delivered cursor mismatch"
        );
        ensure!(
            update["payload"]["read_seq"] == expected_read,
            "read cursor mismatch"
        );
    }
    let cursor: (u64, u64) = sqlx::query_as(
        "SELECT delivered_seq, read_seq FROM conversation_member_cursors WHERE conversation_id = ? AND user_id = ?",
    )
    .bind(fixture.conversation)
    .bind(fixture.bob)
    .fetch_one(&fixture.pool)
    .await?;
    ensure!(
        cursor == (seq, seq),
        "Bob's persisted cursor differs from notifications"
    );

    kafka::replay(&settings.kafka, &first_event, &first_position).await?;
    let replay_position = observer.expect_event(&first_event, None).await?;
    kafka::expect_committed(&settings.kafka, &replay_position).await?;
    ensure!(
        tokio::time::timeout(Duration::from_millis(500), alice.receive())
            .await
            .is_err(),
        "Alice received duplicate replay push"
    );
    ensure!(
        tokio::time::timeout(Duration::from_millis(500), bob.receive())
            .await
            .is_err(),
        "Bob received duplicate replay push"
    );

    let mut reconnected_bob =
        Client::connect(&mut second_node[0], fixture.bob, &settings.auth.jwt_secret).await?;
    let reconnect_message = exchange(
        &mut alice,
        &mut reconnected_bob,
        fixture.conversation,
        &Uuid::new_v4().to_string(),
        "after quick reconnect",
    )
    .await?;
    let old_connection_frame =
        tokio::time::timeout(Duration::from_millis(500), bob.receive()).await;
    ensure!(
        !matches!(old_connection_frame, Ok(Ok(ref frame)) if frame["type"] == "message_created"),
        "old Bob connection received a message after reconnect"
    );
    let reconnect_event = fixture
        .stored_event(
            reconnect_message["message_id"]
                .as_str()
                .context("reconnect message id missing")?,
        )
        .await?;
    expect_done(settings, &reconnect_event).await?;
    drop(reconnected_bob);
    drop(bob);
    second_node[0].stop()?;
    alice
        .send_text(
            fixture.conversation,
            &Uuid::new_v4().to_string(),
            "remote node stopped",
        )
        .await?;
    let frames = [alice.receive().await?, alice.receive().await?];
    let accepted = frames
        .iter()
        .find(|frame| frame["type"] == "server_accepted")
        .context("Alice did not receive server_accepted after Bob's node stopped")?;
    ensure!(
        frames
            .iter()
            .any(|frame| frame["type"] == "message_created"),
        "Alice did not receive its own second message"
    );
    let second_message_id = accepted["payload"]["message"]["message_id"]
        .as_str()
        .context("second message id missing")?;
    let second_event = fixture.stored_event(second_message_id).await?;
    expect_done(settings, &second_event).await?;
    let cursor_after: (u64, u64) = sqlx::query_as(
        "SELECT delivered_seq, read_seq FROM conversation_member_cursors WHERE conversation_id = ? AND user_id = ?",
    )
    .bind(fixture.conversation)
    .bind(fixture.bob)
    .fetch_one(&fixture.pool)
    .await?;
    ensure!(
        cursor_after == (seq, seq),
        "offline delivery advanced Bob's cursor"
    );
    Ok(())
}

async fn exercise(server: &mut TestServer, settings: &Settings, fixture: &Fixture) -> Result<()> {
    let observer = Observer::new(&settings.kafka)?;
    let mut alice = Client::connect(server, fixture.alice, &settings.auth.jwt_secret).await?;
    let mut bob = Client::connect(server, fixture.bob, &settings.auth.jwt_secret).await?;
    let client_id = Uuid::new_v4().to_string();
    let first = exchange(
        &mut alice,
        &mut bob,
        fixture.conversation,
        &client_id,
        "alice to bob",
    )
    .await?;
    let first_event = fixture
        .stored_event(first["message_id"].as_str().context("message id missing")?)
        .await?;
    let first_position = observer.expect_event(&first_event, None).await?;
    expect_done(settings, &first_event).await?;
    kafka::expect_committed(&settings.kafka, &first_position).await?;
    kafka::replay(&settings.kafka, &first_event, &first_position).await?;

    let rolled_back_id = fixture.rollback_event(&first_event).await?;
    let second = exchange(
        &mut bob,
        &mut alice,
        fixture.conversation,
        &client_id,
        "bob to alice",
    )
    .await?;
    ensure!(
        first["message_id"] != second["message_id"],
        "different senders sharing a client id must create distinct messages"
    );
    ensure!(
        first["conversation_seq"] == 1 && second["conversation_seq"] == 2,
        "conversation sequence did not advance"
    );
    let second_event = fixture
        .stored_event(
            second["message_id"]
                .as_str()
                .context("message id missing")?,
        )
        .await?;
    // The later committed event is a same-key partition barrier. Seeing it proves
    // CDC progressed past the rollback, without a timing-only negative assertion.
    let second_position = observer
        .expect_event(&second_event, Some(&rolled_back_id))
        .await?;
    ensure!(
        first_position.partition == second_position.partition,
        "same conversation was routed to different partitions"
    );
    expect_done(settings, &second_event).await?;
    kafka::expect_committed(&settings.kafka, &second_position).await?;
    fixture.check_cursors_unchanged().await
}

async fn exchange(
    sender: &mut Client,
    receiver: &mut Client,
    conversation: u64,
    client_id: &str,
    text: &str,
) -> Result<Value> {
    sender.send_text(conversation, client_id, text).await?;
    let (sender_frames, received) = tokio::try_join!(
        async {
            // server_accepted and message_created may arrive in either order.
            Ok::<_, anyhow::Error>([sender.receive().await?, sender.receive().await?])
        },
        receiver.receive()
    )?;
    let accepted = sender_frames
        .iter()
        .find(|frame| frame["type"] == "server_accepted")
        .context("sender did not receive server_accepted")?;
    let created = sender_frames
        .iter()
        .find(|frame| frame["type"] == "message_created")
        .context("sender did not receive its own message_created")?;
    ensure!(
        received["type"] == "message_created",
        "recipient did not receive a message_created"
    );
    ensure!(
        created.get("request_id").is_none() && received.get("request_id").is_none(),
        "push frames must omit request_id"
    );
    ensure!(
        created["payload"] == received["payload"],
        "sender and recipient pushes differ"
    );
    let message = accepted["payload"]["message"].clone();
    ensure!(
        message == created["payload"]["message"],
        "push differs from committed server acceptance"
    );
    ensure!(
        message["content"]["text"] == text && message["client_message_id"] == client_id,
        "delivered content differs from request"
    );
    Ok(message)
}

async fn expect_done(settings: &Settings, event: &Value) -> Result<()> {
    let event_id = event["event_id"].as_str().context("event id missing")?;
    let key = format!("chat:delivery:done:{}:{event_id}", settings.kafka.group_id);
    let deadline = Instant::now() + Duration::from_secs(10);
    timeout_at(deadline, async {
        let mut connection = settings
            .redis
            .client()?
            .get_multiplexed_async_connection()
            .await?;
        loop {
            let ttl: i64 = redis::cmd("TTL")
                .arg(&key)
                .query_async(&mut connection)
                .await?;
            if ttl >= 0 {
                ensure!(
                    (604_700..=604_800).contains(&ttl),
                    "event completion TTL is not seven days"
                );
                return Ok::<(), anyhow::Error>(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .context("event was pushed but never marked complete in Redis")?
}
