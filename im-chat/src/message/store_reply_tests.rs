use super::*;

fn reply_payload(client_id: &str, conversation_id: u64, target: &str) -> SendMessagePayload {
    let mut payload = valid_payload(client_id.to_owned(), conversation_id);
    payload.reply_to_message_id = Some(target.to_owned());
    payload
}

#[tokio::test]
async fn invalid_reply_id_is_rejected_before_database_access() {
    // 测试目标：验证非法引用 ID 稳定映射为独立错误，且不访问存储。
    // 构造方法：使用无法连接的 lazy pool 调用 accept_message。
    // 输入数据：其余合法的文本请求，引用 ID="not-a-uuid"。
    // 预期行为：直接返回 invalid_reply_message_id，而非数据库错误。
    let pool = MySqlPoolOptions::new()
        .connect_lazy("mysql://localhost/unused")
        .unwrap();
    let payload = reply_payload(&uuid::Uuid::new_v4().to_string(), 10001, "not-a-uuid");
    let error = accept_message(&pool, 20001, payload).await.unwrap_err();
    assert_eq!(
        error.into_reject(None).error_code,
        "invalid_reply_message_id"
    );
}

#[test]
fn idempotency_includes_reply_target() {
    // 测试目标：验证同正文不同引用不能复用幂等键，相同引用可以恢复。
    // 构造方法：构造 StoredMessage 和相同正文请求，依次保留、更换和移除引用。
    // 输入数据：同一 client_message_id，目标 UUID A、B 及 None。
    // 预期行为：只有相同目标恢复原消息，其余返回 DuplicateClientMessageConflict。
    let target = uuid::Uuid::new_v4().to_string();
    let mut payload = reply_payload(&uuid::Uuid::new_v4().to_string(), 10001, &target);
    let validated = content::validate_send_payload(&payload).unwrap();
    let accepted = AcceptedMessage {
        message_id: uuid::Uuid::new_v4().to_string(),
        conversation_id: 10001,
        conversation_seq: 1,
        sender_user_id: 20001,
        client_message_id: payload.client_message_id.clone(),
        message_type: "text".to_owned(),
        content: validated.content.clone(),
        reply_to_message_id: Some(target),
        reply_to: None,
        created_at: "2026-10-16T00:00:00Z".to_owned(),
    };
    let existing = || StoredMessage {
        message: accepted.clone(),
        content_hash: validated.content_hash.clone(),
    };
    assert!(accept_existing_or_conflict(existing(), &payload, &validated).is_ok());
    payload.reply_to_message_id = Some(uuid::Uuid::new_v4().to_string());
    assert!(matches!(
        accept_existing_or_conflict(existing(), &payload, &validated),
        Err(AcceptMessageError::DuplicateClientMessageConflict)
    ));
    payload.reply_to_message_id = None;
    assert!(matches!(
        accept_existing_or_conflict(existing(), &payload, &validated),
        Err(AcceptMessageError::DuplicateClientMessageConflict)
    ));
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn reply_persists_id_and_recovers_shallow_target_for_accept_and_delivery() {
    // 测试目标：验证回复持久关系、接受确认、事件和投递读取保持一致且不嵌套引用。
    // 构造方法：创建文本原消息、回复及回复的回复；从 outbox 再解码并补齐目标。
    // 输入数据：同会话文本原文 hello，第二条引用第一条，第三条引用第二条。
    // 预期行为：数据库仅存引用 ID，事件不含目标；客户端 DTO 带原目标正文且不嵌套。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let original = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id),
    )
    .await
    .unwrap();
    assert!(original.reply_to.is_none());
    let client_id = uuid::Uuid::new_v4().to_string();
    let reply = accept_message(
        &pool,
        20001,
        reply_payload(&client_id, fixture.conversation_id, &original.message_id),
    )
    .await
    .unwrap();
    assert_eq!(reply.reply_to.as_ref().unwrap().content, original.content);
    let stored_id: Option<String> =
        sqlx::query_scalar("SELECT reply_to_message_id FROM messages WHERE message_id = ?")
            .bind(&reply.message_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_id.as_deref(), Some(original.message_id.as_str()));
    let retry = accept_message(
        &pool,
        20001,
        reply_payload(&client_id, fixture.conversation_id, &original.message_id),
    )
    .await
    .unwrap();
    assert_eq!(retry.message_id, reply.message_id);
    assert_eq!(retry.reply_to.unwrap().message_id, original.message_id);
    let third = accept_message(
        &pool,
        20001,
        reply_payload(
            &uuid::Uuid::new_v4().to_string(),
            fixture.conversation_id,
            &reply.message_id,
        ),
    )
    .await
    .unwrap();
    let quote = serde_json::to_value(third.reply_to.unwrap()).unwrap();
    assert_eq!(quote["message_id"], reply.message_id);
    assert_eq!(quote["content"], reply.content);
    assert!(quote.get("reply_to").is_none());
    let raw: String = sqlx::query_scalar("SELECT CAST(payload AS CHAR) FROM outbox_events WHERE aggregateid = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message.message_id')) = ?")
        .bind(fixture.conversation_id.to_string()).bind(&reply.message_id).fetch_one(&pool).await.unwrap();
    let raw_json: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert!(raw_json["message"].get("reply_to").is_none());
    let mut event: MessageCreatedEvent = serde_json::from_str(&raw).unwrap();
    super::super::super::populate_reply(&pool, &mut event.message)
        .await
        .unwrap();
    assert_eq!(event.message.reply_to.unwrap().content, original.content);
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn missing_and_foreign_reply_targets_are_indistinguishable_and_do_not_write() {
    // 测试目标：验证不存在及跨会话目标使用相同错误，拒绝时不分配消息序号。
    // 构造方法：创建两个会话，在第二个发送原消息，向第一个发送两种非法回复。
    // 输入数据：随机 UUID 与另一个会话真实消息 UUID。
    // 预期行为：均返回 reply_message_not_found，第一个会话 last_seq=0 且无消息/outbox。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let local = TestFixture::create(&pool, 20001, true).await;
    let foreign = TestFixture::create(&pool, 20001, true).await;
    let original = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), foreign.conversation_id),
    )
    .await
    .unwrap();
    for target in [uuid::Uuid::new_v4().to_string(), original.message_id] {
        let error = accept_message(
            &pool,
            20001,
            reply_payload(
                &uuid::Uuid::new_v4().to_string(),
                local.conversation_id,
                &target,
            ),
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.into_reject(None).error_code,
            "reply_message_not_found"
        );
    }
    let last_seq: u64 = sqlx::query_scalar("SELECT last_seq FROM conversations WHERE id = ?")
        .bind(local.conversation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(last_seq, 0);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE conversation_id = ?")
        .bind(local.conversation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM outbox_events WHERE aggregateid = ?")
        .bind(local.conversation_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    local.cleanup(&pool).await;
    foreign.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn missing_historical_target_keeps_id_and_drops_stale_body() {
    // 测试目标：验证旧损坏引用不会阻断确认恢复或重新投递，也不会沿用旧目标正文。
    // 构造方法：发送原消息和回复，删除原消息，再恢复幂等确认并执行引用补齐。
    // 输入数据：已持久化的 reply_to_message_id，目标记录已经不存在。
    // 预期行为：恢复原消息 ID，保留引用 ID，reply_to=null。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let original = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id),
    )
    .await
    .unwrap();
    let client_id = uuid::Uuid::new_v4().to_string();
    let mut reply = accept_message(
        &pool,
        20001,
        reply_payload(&client_id, fixture.conversation_id, &original.message_id),
    )
    .await
    .unwrap();
    sqlx::query("DELETE FROM messages WHERE message_id = ?")
        .bind(&original.message_id)
        .execute(&pool)
        .await
        .unwrap();
    let retry = accept_message(
        &pool,
        20001,
        reply_payload(&client_id, fixture.conversation_id, &original.message_id),
    )
    .await
    .unwrap();
    assert_eq!(retry.message_id, reply.message_id);
    assert_eq!(
        retry.reply_to_message_id.as_deref(),
        Some(original.message_id.as_str())
    );
    assert!(retry.reply_to.is_none());
    super::super::super::populate_reply(&pool, &mut reply)
        .await
        .unwrap();
    assert!(reply.reply_to.is_none());
    fixture.cleanup(&pool).await;
}
