//! Real MySQL -> Debezium -> Kafka -> im-chat -> WebSocket acceptance test.
//! Set IM_CHAT_CDC_CONFIG to a repository-local config for an already migrated,
//! isolated database, Redis DB, and running Kafka/Connect. See README.md.

#[path = "cdc_delivery/environment.rs"]
mod environment;
#[path = "cdc_delivery/fixture.rs"]
mod fixture;
#[path = "cdc_delivery/kafka.rs"]
mod kafka;
#[path = "cdc_delivery/socket.rs"]
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
