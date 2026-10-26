use super::*;
use serde_json::json;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires IM_CHAT_CDC_CONFIG and isolated MySQL/Redis/Kafka/Debezium"]
async fn recall_reaches_both_clients_and_old_creation_replay_keeps_recall_state() -> Result<()> {
    // 测试目标：验证撤回经真实 MySQL/CDC/Kafka 到达双方，且旧创建重放读取最新撤回状态。
    // 构造方法：启动单节点与两个 WebSocket，发送原消息，撤回并重放两类事件，再发送引用回复。
    // 输入数据：原文 recall-original、同一撤回 ID、旧创建事件及已撤回目标的回复。
    // 预期行为：仅本人可撤回、重复请求幂等，撤回重放不重复推送，创建重放正文保留且携带撤回时间，回复正常。
    run(1).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires IM_CHAT_CDC_CONFIG and isolated MySQL/Redis/Kafka/Debezium"]
async fn recall_crosses_nodes_with_shared_consumer_completion_and_unchanged_cursors() -> Result<()>
{
    // 测试目标：验证撤回跨节点签名 RPC、共享消费组确认及原序号/游标不变。
    // 构造方法：启动两节点，双方分别连接一个节点，执行相同撤回和重放场景。
    // 输入数据：Alice 原消息、Bob 越权撤回、Alice 首次与重复撤回、两类 Kafka 重放。
    // 预期行为：双方收到相同撤回事件、共享完成标记及 offset 正常推进，游标不变且仍可回复。
    run(2).await
}

async fn run(nodes: usize) -> Result<()> {
    let (mut servers, settings) = TestServer::start_cluster(nodes)?;
    let fixture = Fixture::create(settings.mysql.connect().await?).await?;
    let result = exercise(&mut servers, &settings, &fixture)
        .await
        .with_context(|| {
            format!(
                "recall CDC failed; logs: {:?}",
                servers
                    .iter()
                    .map(|server| &server.log_dir)
                    .collect::<Vec<_>>()
            )
        });
    drop(servers);
    let cleanup = fixture.cleanup().await;
    result?;
    cleanup
}

async fn exercise(
    servers: &mut [TestServer],
    settings: &Settings,
    fixture: &Fixture,
) -> Result<()> {
    let observer = Observer::new(&settings.kafka)?;
    let mut alice =
        Client::connect(&mut servers[0], fixture.alice, &settings.auth.jwt_secret).await?;
    let peer_node = servers.len() - 1;
    let mut bob = Client::connect(
        &mut servers[peer_node],
        fixture.bob,
        &settings.auth.jwt_secret,
    )
    .await?;
    let original = super::exchange(
        &mut alice,
        &mut bob,
        fixture.conversation,
        &Uuid::new_v4().to_string(),
        "recall-original",
    )
    .await?;
    let message_id = original["message_id"]
        .as_str()
        .context("message id missing")?;
    let created_event = fixture.stored_event(message_id).await?;
    let created_position = observer.expect_event(&created_event, None).await?;
    expect_done(settings, &created_event).await?;
    kafka::expect_committed(&settings.kafka, &created_position).await?;

    bob.send_request(
        "recall_message",
        "other-user",
        json!({"message_id":message_id}),
    )?;
    let rejected = bob.receive().await?;
    ensure!(
        rejected["type"] == "recall_message_rejected"
            && rejected["payload"]["error_code"] == "message_not_owned",
        "non-owner recall accepted"
    );
    alice.send_request(
        "recall_message",
        "recall-first",
        json!({"message_id":message_id}),
    )?;
    let (frames, pushed) = tokio::try_join!(
        async { Ok::<_, anyhow::Error>([alice.receive().await?, alice.receive().await?]) },
        bob.receive()
    )?;
    let accepted = frames
        .iter()
        .find(|frame| frame["type"] == "recall_message_accepted")
        .context("recall acceptance missing")?;
    let own_push = frames
        .iter()
        .find(|frame| frame["type"] == "message_recalled")
        .context("own recall push missing")?;
    ensure!(
        accepted["request_id"] == "recall-first",
        "recall request id differs"
    );
    ensure!(
        pushed["type"] == "message_recalled" && own_push["payload"] == pushed["payload"],
        "recall pushes differ"
    );
    ensure!(
        pushed.get("request_id").is_none(),
        "recall push has request id"
    );
    for name in [
        "message_id",
        "conversation_id",
        "conversation_seq",
        "sender_user_id",
        "recalled_at",
    ] {
        ensure!(
            accepted["payload"][name] == pushed["payload"][name],
            "accepted and pushed recall differ at {name}"
        );
    }
    let recalled_at = accepted["payload"]["recalled_at"].clone();
    let raw: String = sqlx::query_scalar("SELECT CAST(payload AS CHAR) FROM outbox_events WHERE aggregateid=? AND type='message_recalled'")
        .bind(fixture.conversation.to_string()).fetch_one(&fixture.pool).await?;
    let recalled_event: Value = serde_json::from_str(&raw)?;
    let recall_position = observer.expect_event(&recalled_event, None).await?;
    ensure!(
        created_position.partition == recall_position.partition,
        "creation and recall partition differ"
    );
    expect_done(settings, &recalled_event).await?;
    kafka::expect_committed(&settings.kafka, &recall_position).await?;
    fixture.check_cursors_unchanged().await?;
    let last_seq: u64 = sqlx::query_scalar("SELECT last_seq FROM conversations WHERE id=?")
        .bind(fixture.conversation)
        .fetch_one(&fixture.pool)
        .await?;
    ensure!(last_seq == 1, "recall allocated a new sequence");

    alice.send_request(
        "recall_message",
        "recall-retry",
        json!({"message_id":message_id}),
    )?;
    let repeated = alice.receive().await?;
    ensure!(
        repeated["type"] == "recall_message_accepted" && repeated["payload"] == accepted["payload"],
        "recall retry differs"
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM outbox_events WHERE aggregateid=? AND type='message_recalled'",
    )
    .bind(fixture.conversation.to_string())
    .fetch_one(&fixture.pool)
    .await?;
    ensure!(count == 1, "repeat recall wrote another event");
    kafka::replay(&settings.kafka, &recalled_event, &recall_position).await?;
    let replayed = observer.expect_event(&recalled_event, None).await?;
    kafka::expect_committed(&settings.kafka, &replayed).await?;
    for client in [&mut alice, &mut bob] {
        ensure!(
            tokio::time::timeout(Duration::from_millis(300), client.receive())
                .await
                .is_err(),
            "recall replay produced duplicate push"
        );
    }

    // Expire only this fixture's creation completion marker to exercise a real replay after dedup loss.
    let mut redis = settings
        .redis
        .client()?
        .get_multiplexed_async_connection()
        .await?;
    let marker = format!(
        "chat:delivery:done:{}:{}",
        settings.kafka.group_id,
        created_event["event_id"].as_str().unwrap()
    );
    let _: i64 = redis::cmd("DEL")
        .arg(marker)
        .query_async(&mut redis)
        .await?;
    kafka::replay(&settings.kafka, &created_event, &created_position).await?;
    let replayed = observer.expect_event(&created_event, None).await?;
    for client in [&mut alice, &mut bob] {
        let frame = client.receive().await?;
        ensure!(
            frame["type"] == "message_created",
            "old creation was dropped"
        );
        ensure!(
            frame["payload"]["message"]["recalled_at"] == recalled_at,
            "old creation lacks current recall state"
        );
        ensure!(
            frame["payload"]["message"]["content"] == original["content"],
            "old creation body was changed"
        );
        ensure!(
            frame["payload"]["message"]["conversation_seq"] == original["conversation_seq"],
            "old creation sequence changed"
        );
    }
    expect_done(settings, &created_event).await?;
    kafka::expect_committed(&settings.kafka, &replayed).await?;
    fixture.check_cursors_unchanged().await?;

    let reply_client_id = Uuid::new_v4().to_string();
    bob.send_request("send_message", &reply_client_id, json!({"conversation_id":fixture.conversation,
        "client_message_id":reply_client_id,"message_type":"text","content":{"text":"reply still allowed"},"reply_to_message_id":message_id}))?;
    let (reply_frames, received) = tokio::try_join!(
        async { Ok::<_, anyhow::Error>([bob.receive().await?, bob.receive().await?]) },
        alice.receive()
    )?;
    let reply = reply_frames
        .iter()
        .find(|frame| frame["type"] == "server_accepted")
        .context("reply was rejected")?;
    ensure!(
        reply["payload"]["message"]["reply_to"]["recalled_at"] == recalled_at,
        "reply target state missing"
    );
    ensure!(
        reply["payload"]["message"]["reply_to"]["content"] == original["content"],
        "reply target body changed"
    );
    ensure!(
        received["payload"]["message"]["content"]["text"] == "reply still allowed",
        "reply not delivered"
    );
    let reply_event = fixture
        .stored_event(reply["payload"]["message"]["message_id"].as_str().unwrap())
        .await?;
    expect_done(settings, &reply_event).await?;
    fixture.check_cursors_unchanged().await
}
