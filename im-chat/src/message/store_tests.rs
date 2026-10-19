use super::super::event::{CHAT_MESSAGE, EVENT_VERSION, MESSAGE_CREATED};
use super::*;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;
use std::env;

#[path = "store_reply_tests.rs"]
mod reply_tests;

fn valid_payload(client_message_id: String, conversation_id: u64) -> SendMessagePayload {
    SendMessagePayload {
        client_message_id,
        conversation_id,
        message_type: super::super::TEXT.to_string(),
        content: json!({ "text": "hello" }),
        reply_to_message_id: None,
        client_sent_at: Some("2026-08-16T12:00:00Z".to_string()),
    }
}

#[test]
fn duplicate_key_classifier_requires_the_idempotency_index() {
    // 测试目标：验证只有 messages 幂等唯一键冲突才进入并发恢复分支。
    // 构造方法：分别传入幂等索引、其他唯一索引和非唯一性 SQLSTATE 错误信息。
    // 输入数据：SQLSTATE 23000 与三种不同的数据库错误消息。
    // 预期行为：仅 uk_messages_sender_client_msg 被分类为幂等重复。
    assert!(is_idempotency_duplicate_key_details(
        Some("23000"),
        "Duplicate entry for key 'uk_messages_sender_client_msg'"
    ));
    assert!(!is_idempotency_duplicate_key_details(
        Some("23000"),
        "Duplicate entry for key 'uk_messages_message_id'"
    ));
    assert!(!is_idempotency_duplicate_key_details(
        Some("23000"),
        "foreign key constraint failed"
    ));
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
    // 预期行为：返回 conversation_seq=1，数据库中存在 message 和 outbox，时间在 DATETIME(6) 微秒精度一致。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);

    let accepted = accept_message(&pool, 20001, payload)
        .await
        .expect("message should be accepted");

    assert_eq!(accepted.conversation_seq, 1);
    assert_eq!(accepted.content, json!({ "text": "hello" }));
    let stored_created_at: PrimitiveDateTime =
        sqlx::query_scalar("SELECT created_at FROM messages WHERE message_id = ?")
            .bind(&accepted.message_id)
            .fetch_one(&pool)
            .await
            .expect("message timestamp should load");
    let accepted_created_at = OffsetDateTime::parse(&accepted.created_at, &Rfc3339)
        .expect("accepted timestamp is RFC3339");
    let expected_created_at = to_database_datetime(accepted_created_at);
    assert_eq!(
        (stored_created_at.date(), stored_created_at.as_hms_micro()),
        (
            expected_created_at.date(),
            expected_created_at.as_hms_micro()
        )
    );
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

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn rich_message_attaches_uploaded_attachments_and_preserves_outbox_blocks() {
    // 测试目标：验证 rich 消息事务将上传完成的图片附件关联，并按原顺序写入 outbox。
    // 构造方法：建立两个 uploaded 附件，再发送包含图片、文字、图片的 rich 消息。
    // 输入数据：同一会话的两个图片 UUID 与交错 blocks。
    // 预期行为：消息、outbox blocks 顺序相同，两个附件状态转为 attached 且指向该消息。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let first_id = uuid::Uuid::new_v4().to_string();
    let second_id = uuid::Uuid::new_v4().to_string();
    insert_uploaded_attachment(&pool, &first_id, 20001, fixture.conversation_id, 100).await;
    insert_uploaded_attachment(&pool, &second_id, 20001, fixture.conversation_id, 200).await;
    let mut payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);
    payload.message_type = super::super::RICH.to_string();
    payload.content = json!({ "blocks": [
        { "type": "image", "attachment_id": first_id },
        { "type": "text", "text": "caption" },
        { "type": "image", "attachment_id": second_id }
    ] });

    let accepted = accept_message(&pool, 20001, payload)
        .await
        .expect("rich send should pass");

    assert_eq!(accepted.message_type, super::super::RICH);
    assert_eq!(accepted.content["blocks"][0]["type"], "image");
    assert_eq!(accepted.content["blocks"][1]["text"], "caption");
    assert_eq!(accepted.content["blocks"][2]["attachment_id"], second_id);
    let statuses: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT status, message_id FROM attachments WHERE attachment_id IN (?, ?) ORDER BY attachment_id",
    )
    .bind(&first_id)
    .bind(&second_id)
    .fetch_all(&pool)
    .await
    .expect("attachment status should load");
    assert_eq!(statuses.len(), 2);
    assert!(
        statuses
            .iter()
            .all(|(status, message_id)| status == "attached"
                && message_id.as_deref() == Some(&accepted.message_id))
    );
    let outbox_payload: String = sqlx::query_scalar(
        "SELECT CAST(payload AS CHAR) FROM outbox_events WHERE aggregateid = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(fixture.conversation_id.to_string())
    .bind(MESSAGE_CREATED)
    .fetch_one(&pool)
    .await
    .expect("rich outbox event should load");
    let value: serde_json::Value = serde_json::from_str(&outbox_payload).expect("outbox is JSON");
    assert_eq!(
        value["message"]["content"]["blocks"],
        accepted.content["blocks"]
    );
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn invalid_attachment_rolls_back_message_sequence_and_prior_attachment_updates() {
    // 测试目标：验证附件校验失败会回滚消息、序号和此前已处理附件的关联状态。
    // 构造方法：按有效附件后无效附件顺序插入 blocks，第二个附件绑定到其他会话。
    // 输入数据：两个 uploaded 附件，其中第二个会话 ID 与目标会话不同。
    // 预期行为：返回 AttachmentForbidden，消息/outbox 不存在，序号不变，附件仍为 uploaded。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let first_id = uuid::Uuid::new_v4().to_string();
    let second_id = uuid::Uuid::new_v4().to_string();
    insert_uploaded_attachment(&pool, &first_id, 20001, fixture.conversation_id, 100).await;
    insert_uploaded_attachment(&pool, &second_id, 20001, fixture.conversation_id + 1, 100).await;
    let mut payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);
    payload.message_type = super::super::RICH.to_string();
    payload.content = json!({ "blocks": [
        { "type": "image", "attachment_id": first_id },
        { "type": "image", "attachment_id": second_id }
    ] });

    let error = accept_message(&pool, 20001, payload)
        .await
        .expect_err("foreign attachment should fail");

    assert!(matches!(error, AcceptMessageError::AttachmentForbidden));
    let last_seq: u64 = sqlx::query_scalar("SELECT last_seq FROM conversations WHERE id = ?")
        .bind(fixture.conversation_id)
        .fetch_one(&pool)
        .await
        .expect("conversation sequence should load");
    let message_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE conversation_id = ?")
            .bind(fixture.conversation_id)
            .fetch_one(&pool)
            .await
            .expect("message count should load");
    let first_status: String =
        sqlx::query_scalar("SELECT status FROM attachments WHERE attachment_id = ?")
            .bind(&first_id)
            .fetch_one(&pool)
            .await
            .expect("attachment status should load");
    assert_eq!(last_seq, 0);
    assert_eq!(message_count, 0);
    assert_eq!(first_status, "uploaded");
    sqlx::query("DELETE FROM attachments WHERE attachment_id IN (?, ?)")
        .bind(&first_id)
        .bind(&second_id)
        .execute(&pool)
        .await
        .expect("delete rollback test attachments");
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn concurrent_same_key_requests_both_miss_then_recover_the_committed_message() {
    // 测试目标：验证两个请求都完成首次幂等未命中后，唯一键冲突方回滚并恢复同一已提交消息。
    // 构造方法：启用双请求 barrier，在独立数据库连接上并发发送完全相同的 payload。
    // 输入数据：相同 sender、client_message_id、会话和文本内容。
    // 预期行为：两次返回同一消息和序号，仅一条 message、一个 outbox，last_seq 仅增加一次。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let client_message_id = uuid::Uuid::new_v4().to_string();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    *IDEMPOTENCY_MISS_BARRIER.lock().expect("barrier lock") =
        Some((client_message_id.clone(), barrier));
    let payload_a = valid_payload(client_message_id.clone(), fixture.conversation_id);
    let payload_b = valid_payload(client_message_id.clone(), fixture.conversation_id);
    let pool_a = pool.clone();
    let pool_b = pool.clone();
    let request_a = tokio::spawn(async move { accept_message(&pool_a, 20001, payload_a).await });
    let request_b = tokio::spawn(async move { accept_message(&pool_b, 20001, payload_b).await });
    let first = request_a
        .await
        .expect("request A task should finish")
        .expect("request A should pass");
    let second = request_b
        .await
        .expect("request B task should finish")
        .expect("request B should recover");
    *IDEMPOTENCY_MISS_BARRIER.lock().expect("barrier lock") = None;

    assert_eq!(first.message_id, second.message_id);
    assert_eq!(first.conversation_seq, second.conversation_seq);
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE sender_user_id = ? AND client_message_id = ?",
    )
    .bind(20001_u64)
    .bind(client_message_id)
    .fetch_one(&pool)
    .await
    .expect("message count should load");
    let outbox_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM outbox_events WHERE aggregateid = ? AND type = ?")
            .bind(fixture.conversation_id.to_string())
            .bind(MESSAGE_CREATED)
            .fetch_one(&pool)
            .await
            .expect("outbox count should load");
    let last_seq: u64 = sqlx::query_scalar("SELECT last_seq FROM conversations WHERE id = ?")
        .bind(fixture.conversation_id)
        .fetch_one(&pool)
        .await
        .expect("conversation sequence should load");
    assert_eq!(message_count, 1);
    assert_eq!(outbox_count, 1);
    assert_eq!(last_seq, 1);
    fixture.cleanup(&pool).await;
}

async fn test_pool() -> MySqlPool {
    let database_url = env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required");
    MySqlPoolOptions::new()
        .max_connections(5)
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
            reply_to_message_id CHAR(36) NULL DEFAULT NULL,
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
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS attachments (
            attachment_id CHAR(36) PRIMARY KEY,
            uploader_user_id BIGINT UNSIGNED NOT NULL,
            conversation_id BIGINT UNSIGNED NOT NULL,
            object_key VARCHAR(1024) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            content_type VARCHAR(128) NOT NULL,
            size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL,
            message_id CHAR(36) NULL,
            expires_at DATETIME(6) NOT NULL,
            created_at DATETIME(6) NOT NULL,
            updated_at DATETIME(6) NOT NULL,
            INDEX idx_attachments_message (message_id)
        )",
    )
    .execute(pool)
    .await
    .expect("create attachments table");
}

async fn insert_uploaded_attachment(
    pool: &MySqlPool,
    attachment_id: &str,
    uploader_user_id: u64,
    conversation_id: u64,
    size_bytes: u64,
) {
    let now = to_database_datetime(OffsetDateTime::now_utc());
    sqlx::query(
        "INSERT INTO attachments \
         (attachment_id, uploader_user_id, conversation_id, object_key, file_name, content_type, \
          size_bytes, status, message_id, expires_at, created_at, updated_at) \
         VALUES (?, ?, ?, ?, 'image.png', 'image/png', ?, 'uploaded', NULL, ?, ?, ?)",
    )
    .bind(attachment_id)
    .bind(uploader_user_id)
    .bind(conversation_id)
    .bind(format!("test/{attachment_id}"))
    .bind(size_bytes)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert uploaded attachment");
}

struct TestFixture {
    conversation_id: u64,
}

impl TestFixture {
    async fn create(pool: &MySqlPool, user_id: u64, active_member: bool) -> Self {
        let now = to_database_datetime(OffsetDateTime::now_utc());
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
        sqlx::query("DELETE FROM attachments WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(pool)
            .await
            .expect("delete test attachments");
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
