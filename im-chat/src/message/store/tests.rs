use super::super::event::{CHAT_MESSAGE, EVENT_VERSION, MESSAGE_CREATED};
use super::*;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;
use std::env;

fn valid_payload(client_message_id: String, conversation_id: u64) -> SendMessagePayload {
    SendMessagePayload {
        client_message_id,
        conversation_id,
        message_type: super::super::TEXT.to_string(),
        content: json!({ "text": "hello" }),
        client_sent_at: Some("2026-08-16T12:00:00Z".to_string()),
    }
}

#[test]
fn maps_internal_errors_to_internal_error_reject() {
    // 测试目标：验证内部 SQL 错误不会泄露底层数据库细节到 WebSocket 协议。
    // 构造方法：直接把 RowNotFound 包装成模块内部错误并映射为 reject payload。
    // 输入数据：client_message_id="550e8400-e29b-41d4-a716-446655440000"。
    // 预期行为：error_code 为 internal_error，message 为稳定调试文本。
    let reject = AcceptMessageError::InternalSql {
        source: sqlx::Error::RowNotFound,
    }
    .into_reject(Some("550e8400-e29b-41d4-a716-446655440000".to_string()));

    assert_eq!(reject.error_code, INTERNAL_ERROR);
    assert_eq!(reject.message, "internal error");
    assert_eq!(
        reject.client_message_id.as_deref(),
        Some("550e8400-e29b-41d4-a716-446655440000")
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn accept_message_writes_message_and_outbox_when_test_database_is_configured() {
    // 测试目标：验证正常发送会在同一事务中写入 messages 与 outbox_events 并返回 accepted。
    // 构造方法：TEST_DATABASE_URL 存在时创建最小 schema 和 active 会话成员，然后调用 accept_message。
    // 输入数据：user_id=20001，direct conversation，text="hello"，唯一 client_message_id。
    // 预期行为：返回 conversation_seq=1，数据库中存在对应 message 和 message_created outbox。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);

    let accepted = accept_message(&pool, 20001, payload)
        .await
        .expect("message should be accepted");

    assert_eq!(accepted.conversation_seq, 1);
    assert_eq!(accepted.content, json!({ "text": "hello" }));
    let message_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE message_id = ?")
            .bind(&accepted.message_id)
            .fetch_one(&pool)
            .await
            .expect("message count should load");
    let outbox_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM outbox_events WHERE type = ? AND aggregateid = ?")
            .bind(MESSAGE_CREATED)
            .bind(fixture.conversation_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("outbox count should load");

    assert_eq!(message_count, 1);
    assert_eq!(outbox_count, 1);
    let outbox_payload: String = sqlx::query_scalar(
        "SELECT CAST(payload AS CHAR) FROM outbox_events WHERE type = ? AND aggregateid = ?",
    )
    .bind(MESSAGE_CREATED)
    .bind(fixture.conversation_id.to_string())
    .fetch_one(&pool)
    .await
    .expect("outbox payload should load");
    let outbox_payload: serde_json::Value =
        serde_json::from_str(&outbox_payload).expect("outbox payload should be json");
    let event: MessageCreatedEvent = serde_json::from_value(outbox_payload.clone())
        .expect("outbox must match consumer envelope");
    event
        .validate()
        .expect("outbox must satisfy consumer contract");
    assert_eq!(outbox_payload["event_type"], MESSAGE_CREATED);
    assert_eq!(outbox_payload["aggregate_type"], CHAT_MESSAGE);
    assert_eq!(
        outbox_payload["aggregate_id"],
        fixture.conversation_id.to_string()
    );
    assert_eq!(outbox_payload["event_version"], EVENT_VERSION);
    assert_eq!(outbox_payload["message"]["message_id"], accepted.message_id);
    assert_eq!(
        outbox_payload["message"]["conversation_seq"],
        accepted.conversation_seq
    );
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn accept_message_returns_existing_message_for_idempotent_retry() {
    // 测试目标：验证同一 sender_user_id 和 client_message_id 的相同内容重试不会创建重复消息。
    // 构造方法：TEST_DATABASE_URL 存在时先发送一次，再用相同 payload 发送第二次。
    // 输入数据：同一 conversation_id、同一 client_message_id、同一 text content。
    // 预期行为：两次返回同一个 message_id/conversation_seq，messages 只有一行。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let client_message_id = uuid::Uuid::new_v4().to_string();
    let payload = valid_payload(client_message_id.clone(), fixture.conversation_id);
    let first = accept_message(&pool, 20001, payload)
        .await
        .expect("first send should be accepted");

    let retry = accept_message(
        &pool,
        20001,
        valid_payload(client_message_id.clone(), fixture.conversation_id),
    )
    .await
    .expect("retry should be accepted");

    assert_eq!(retry.message_id, first.message_id);
    assert_eq!(retry.conversation_seq, first.conversation_seq);
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE sender_user_id = ? AND client_message_id = ?",
    )
    .bind(20001_u64)
    .bind(client_message_id)
    .fetch_one(&pool)
    .await
    .expect("message count should load");
    let outbox_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM outbox_events WHERE aggregateid = ?")
            .bind(fixture.conversation_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("outbox count should load");
    assert_eq!(message_count, 1);
    assert_eq!(outbox_count, 1);
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn accept_message_rejects_duplicate_client_message_conflict() {
    // 测试目标：验证同一 client_message_id 复用于不同内容时返回幂等冲突。
    // 构造方法：TEST_DATABASE_URL 存在时先发送 hello，再用同一 client_message_id 发送 changed。
    // 输入数据：相同 sender_user_id/client_message_id，不同 content.text。
    // 预期行为：第二次返回 DuplicateClientMessageConflict。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let client_message_id = uuid::Uuid::new_v4().to_string();
    accept_message(
        &pool,
        20001,
        valid_payload(client_message_id.clone(), fixture.conversation_id),
    )
    .await
    .expect("first send should be accepted");
    let mut conflict = valid_payload(client_message_id, fixture.conversation_id);
    conflict.content = json!({ "text": "changed" });

    let error = accept_message(&pool, 20001, conflict)
        .await
        .expect_err("conflicting retry should be rejected");

    assert!(matches!(
        error,
        AcceptMessageError::DuplicateClientMessageConflict
    ));
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn accept_message_rejects_missing_conversation() {
    // 测试目标：验证不存在的 conversation_id 会映射为 ConversationNotFound。
    // 构造方法：TEST_DATABASE_URL 存在时创建 schema 但不创建对应 conversation。
    // 输入数据：conversation_id 为一个极大的不存在 ID。
    // 预期行为：返回 ConversationNotFound，不写入 message。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let payload = valid_payload(uuid::Uuid::new_v4().to_string(), u64::MAX - 1);

    let error = accept_message(&pool, 20001, payload)
        .await
        .expect_err("missing conversation should be rejected");

    assert!(matches!(error, AcceptMessageError::ConversationNotFound));
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn accept_message_rejects_non_member() {
    // 测试目标：验证发送者不是 active 会话成员时会被拒绝。
    // 构造方法：TEST_DATABASE_URL 存在时创建 direct conversation 但不创建 active member。
    // 输入数据：user_id=20001，conversation 存在，conversation_members 无对应 active 行。
    // 预期行为：返回 NotConversationMember。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, false).await;
    let payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);

    let error = accept_message(&pool, 20001, payload)
        .await
        .expect_err("non-member should be rejected");

    assert!(matches!(error, AcceptMessageError::NotConversationMember));
    fixture.cleanup(&pool).await;
}

async fn test_pool() -> MySqlPool {
    let database_url = env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required");
    MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("TEST_DATABASE_URL should connect")
}

async fn ensure_schema(pool: &MySqlPool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
            conversation_type VARCHAR(16) NOT NULL,
            last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL,
            updated_at DATETIME(6) NOT NULL
        )",
    )
    .execute(pool)
    .await
    .expect("create conversations table");
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_members (
            conversation_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            member_state VARCHAR(16) NOT NULL,
            joined_at DATETIME(6) NOT NULL,
            left_at DATETIME(6) NULL,
            PRIMARY KEY (conversation_id, user_id),
            INDEX idx_conversation_members_user (user_id, member_state)
        )",
    )
    .execute(pool)
    .await
    .expect("create conversation_members table");
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
            message_id CHAR(36) NOT NULL,
            conversation_id BIGINT UNSIGNED NOT NULL,
            conversation_seq BIGINT UNSIGNED NOT NULL,
            sender_user_id BIGINT UNSIGNED NOT NULL,
            client_message_id CHAR(36) NOT NULL,
            message_type VARCHAR(32) NOT NULL,
            content JSON NOT NULL,
            content_hash CHAR(64) NOT NULL,
            created_at DATETIME(6) NOT NULL,
            UNIQUE KEY uk_messages_message_id (message_id),
            UNIQUE KEY uk_messages_conversation_seq (conversation_id, conversation_seq),
            UNIQUE KEY uk_messages_sender_client_msg (sender_user_id, client_message_id),
            INDEX idx_messages_conversation_created (conversation_id, created_at)
        )",
    )
    .execute(pool)
    .await
    .expect("create messages table");
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS outbox_events (
            id CHAR(36) PRIMARY KEY,
            aggregatetype VARCHAR(255) NOT NULL,
            aggregateid VARCHAR(255) NOT NULL,
            type VARCHAR(255) NOT NULL,
            payload JSON NOT NULL,
            created_at DATETIME(6) NOT NULL,
            INDEX idx_outbox_events_created (created_at)
        )",
    )
    .execute(pool)
    .await
    .expect("create outbox_events table");
}

struct TestFixture {
    conversation_id: u64,
}

impl TestFixture {
    async fn create(pool: &MySqlPool, user_id: u64, active_member: bool) -> Self {
        let now = primitive_utc(OffsetDateTime::now_utc());
        let result = sqlx::query(
            "INSERT INTO conversations (conversation_type, last_seq, created_at, updated_at) \
             VALUES (?, 0, ?, ?)",
        )
        .bind(DIRECT_CONVERSATION)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .expect("insert test conversation");
        let conversation_id = result.last_insert_id();
        if active_member {
            sqlx::query(
                "INSERT INTO conversation_members \
                 (conversation_id, user_id, member_state, joined_at, left_at) \
                 VALUES (?, ?, ?, ?, NULL)",
            )
            .bind(conversation_id)
            .bind(user_id)
            .bind(ACTIVE_MEMBER)
            .bind(now)
            .execute(pool)
            .await
            .expect("insert test member");
        }
        Self { conversation_id }
    }

    async fn cleanup(self, pool: &MySqlPool) {
        let conversation_id = self.conversation_id;
        sqlx::query("DELETE FROM outbox_events WHERE aggregateid = ?")
            .bind(conversation_id.to_string())
            .execute(pool)
            .await
            .expect("delete test outbox events");
        sqlx::query("DELETE FROM messages WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(pool)
            .await
            .expect("delete test messages");
        sqlx::query("DELETE FROM conversation_members WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(pool)
            .await
            .expect("delete test members");
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .execute(pool)
            .await
            .expect("delete test conversation");
    }
}
