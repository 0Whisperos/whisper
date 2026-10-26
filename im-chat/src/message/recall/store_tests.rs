use super::*;
use crate::message::send::test_support::{
    TestFixture, accept_message, ensure_schema, insert_uploaded_attachment, test_pool,
    valid_payload,
};
use sqlx::mysql::MySqlPoolOptions;

#[tokio::test]
async fn invalid_id_is_rejected_before_storage() {
    // 测试目标：验证非法 ID 不触发数据库操作。
    // 构造方法：构建无连接的 MySQL lazy pool 并调用撤回服务。
    // 输入数据：用户 1 和字符串 not-a-uuid。
    // 预期行为：返回 InvalidMessageId。
    let pool = MySqlPoolOptions::new()
        .connect_lazy("mysql://localhost/unused")
        .unwrap();
    assert!(matches!(
        recall_message(&pool, 1, "not-a-uuid").await,
        Err(RecallError::InvalidMessageId)
    ));
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn permissions_and_concurrent_recall_preserve_message_and_sequence() {
    // 测试目标：验证撤回权限、并发幂等、原正文及会话序号保留。
    // 构造方法：创建原发送者和另一有效成员；先尝试越权，再同时提交两次本人撤回并重试发送。
    // 输入数据：文本 hello、用户 20001/20002/20003、同一个 message_id 的大小写 UUID。
    // 预期行为：不可见者 not found、他人 not owned、并发返回相同时间且仅一条事件，正文/序号不变。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    sqlx::query("INSERT INTO conversation_members (conversation_id,user_id,member_state,joined_at) VALUES (?,20002,'active',NOW(6))")
        .bind(fixture.conversation_id).execute(&pool).await.unwrap();
    let payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);
    let client_id = payload.client_message_id.clone();
    let original = accept_message(&pool, 20001, payload).await;
    assert!(matches!(
        recall_message(&pool, 20003, &original.message_id).await,
        Err(RecallError::MessageNotFound)
    ));
    assert!(matches!(
        recall_message(&pool, 20002, &original.message_id).await,
        Err(RecallError::MessageNotOwned)
    ));
    assert!(matches!(
        recall_message(&pool, 20001, &uuid::Uuid::new_v4().to_string()).await,
        Err(RecallError::MessageNotFound)
    ));
    sqlx::query("UPDATE conversation_members SET member_state='left' WHERE conversation_id=? AND user_id=20001")
        .bind(fixture.conversation_id).execute(&pool).await.unwrap();
    assert!(matches!(
        recall_message(&pool, 20001, &original.message_id).await,
        Err(RecallError::MessageNotFound)
    ));
    sqlx::query("UPDATE conversation_members SET member_state='active' WHERE conversation_id=? AND user_id=20001")
        .bind(fixture.conversation_id).execute(&pool).await.unwrap();
    let uppercase_id = original.message_id.to_uppercase();
    let (first, second) = tokio::join!(
        recall_message(&pool, 20001, &uppercase_id),
        recall_message(&pool, 20001, &original.message_id)
    );
    let first = first.unwrap();
    assert_eq!(first.message_id, original.message_id);
    assert_eq!(first, second.unwrap());
    assert_eq!(
        first,
        recall_message(&pool, 20001, &original.message_id)
            .await
            .unwrap()
    );
    let retry = accept_message(
        &pool,
        20001,
        valid_payload(client_id, fixture.conversation_id),
    )
    .await;
    assert_eq!(retry.message_id, original.message_id);
    assert_eq!(retry.content, original.content);
    assert_eq!(retry.conversation_seq, original.conversation_seq);
    assert_eq!(
        retry.recalled_at.as_deref(),
        Some(first.recalled_at.as_str())
    );
    let last_seq: u64 = sqlx::query_scalar("SELECT last_seq FROM conversations WHERE id=?")
        .bind(fixture.conversation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(last_seq, 1);
    let events: Vec<String> = sqlx::query_scalar("SELECT CAST(payload AS CHAR) FROM outbox_events WHERE aggregateid=? AND type='message_recalled'")
        .bind(fixture.conversation_id.to_string()).fetch_all(&pool).await.unwrap();
    assert_eq!(events.len(), 1);
    let event: MessageRecalledEvent = serde_json::from_str(&events[0]).unwrap();
    event.validate().unwrap();
    assert_eq!(event.recalled_message, first);
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn recalled_target_remains_replyable_and_creation_refreshes_current_state() {
    // 测试目标：验证已撤回目标仍可被引用且旧创建事件出站补上当前状态。
    // 构造方法：先发送目标并撤回，随后创建引用并用同一幂等键重试，再刷新旧目标快照。
    // 输入数据：正文 hello、目标 message_id 和两个唯一 client_message_id。
    // 预期行为：回复成功且保留目标原文和撤回时间；旧目标快照刷新后原文不变、状态更新。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let mut original = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id),
    )
    .await;
    let recalled = recall_message(&pool, 20001, &original.message_id)
        .await
        .unwrap();
    let client_id = uuid::Uuid::new_v4().to_string();
    for _ in 0..2 {
        let mut payload = valid_payload(client_id.clone(), fixture.conversation_id);
        payload.reply_to_message_id = Some(original.message_id.clone());
        let reply = accept_message(&pool, 20001, payload).await;
        let target = reply.reply_to.unwrap();
        assert_eq!(target.content, original.content);
        assert_eq!(
            target.recalled_at.as_deref(),
            Some(recalled.recalled_at.as_str())
        );
        assert_eq!(reply.conversation_seq, 2);
    }
    crate::message::refresh_message(&pool, &mut original)
        .await
        .unwrap();
    assert_eq!(original.content, serde_json::json!({"text":"hello"}));
    assert_eq!(
        original.recalled_at.as_deref(),
        Some(recalled.recalled_at.as_str())
    );
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database with TRIGGER privilege"]
async fn outbox_failure_rolls_back_recall_update() {
    // 测试目标：验证 outbox 插入失败时消息撤回时间一并回滚。
    // 构造方法：为本用例会话安装唯一触发器拒绝撤回事件，调用服务后先删除触发器再检查状态。
    // 输入数据：一个已发送消息、仅匹配该 conversation_id 的 message_recalled 故障。
    // 预期行为：返回内部错误、recalled_at 仍为空、无撤回事件；移除故障后可正常撤回。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let message = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id),
    )
    .await;
    let trigger = format!("recall_failure_{}", uuid::Uuid::new_v4().simple());
    let statement = format!(
        "CREATE TRIGGER {trigger} BEFORE INSERT ON outbox_events FOR EACH ROW BEGIN IF NEW.type = 'message_recalled' AND NEW.aggregateid = '{}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test outbox unavailable'; END IF; END",
        fixture.conversation_id
    );
    // Audited: the identifier is fixed-prefix UUID hex and the predicate is a u64 fixture ID.
    sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .execute(&pool)
        .await
        .unwrap();
    let result = recall_message(&pool, 20001, &message.message_id).await;
    let cleanup = sqlx::raw_sql(sqlx::AssertSqlSafe(format!("DROP TRIGGER {trigger}")))
        .execute(&pool)
        .await;
    cleanup.expect("remove only this fixture's fault trigger");
    assert_eq!(
        result.as_ref().unwrap_err().rejection(),
        ("internal_error", "internal error")
    );
    assert!(matches!(result, Err(RecallError::Sql(_))));
    let recalled_at: Option<PrimitiveDateTime> =
        sqlx::query_scalar("SELECT recalled_at FROM messages WHERE message_id=?")
            .bind(&message.message_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(recalled_at.is_none());
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM outbox_events WHERE aggregateid=? AND type='message_recalled'",
    )
    .bind(fixture.conversation_id.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
    recall_message(&pool, 20001, &message.message_id)
        .await
        .unwrap();
    fixture.cleanup(&pool).await;
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn recall_preserves_rich_content_reply_attachments_and_member_cursors() {
    // 测试目标：验证不限时撤回保留原富文本、回复关系、附件关联及双方游标。
    // 构造方法：建立原目标和带图片的回复，将回复创建时间设为 2000 年并写入固定成员游标，再撤回。
    // 输入数据：image/text 混排 blocks、reply_to_message_id、delivered_seq=2、read_seq=1。
    // 预期行为：只新增 recalled_at；正文、hash、reply、附件 attached 状态及游标均保持不变。
    let pool = test_pool().await;
    ensure_schema(&pool).await;
    let fixture = TestFixture::create(&pool, 20001, true).await;
    let original = accept_message(
        &pool,
        20001,
        valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id),
    )
    .await;
    let attachment_id = uuid::Uuid::new_v4().to_string();
    insert_uploaded_attachment(&pool, &attachment_id, 20001, fixture.conversation_id, 100).await;
    let mut payload = valid_payload(uuid::Uuid::new_v4().to_string(), fixture.conversation_id);
    payload.message_type = "rich".into();
    payload.content = serde_json::json!({"blocks":[{"type":"image","attachment_id":attachment_id},{"type":"text","text":"caption"}]});
    payload.reply_to_message_id = Some(original.message_id.clone());
    let message = accept_message(&pool, 20001, payload).await;
    sqlx::query("UPDATE messages SET created_at='2000-01-01 00:00:00' WHERE message_id=?")
        .bind(&message.message_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS conversation_member_cursors (conversation_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,delivered_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,delivered_at DATETIME(6) NULL,read_at DATETIME(6) NULL,PRIMARY KEY(conversation_id,user_id))").execute(&pool).await.unwrap();
    for user in [20001u64, 20002] {
        sqlx::query("INSERT INTO conversation_member_cursors (conversation_id,user_id,delivered_seq,read_seq) VALUES (?,?,2,1)")
            .bind(fixture.conversation_id).bind(user).execute(&pool).await.unwrap();
    }
    let before: (String,String,Option<String>,u64,PrimitiveDateTime) = sqlx::query_as("SELECT CAST(content AS CHAR),content_hash,reply_to_message_id,conversation_seq,created_at FROM messages WHERE message_id=?")
        .bind(&message.message_id).fetch_one(&pool).await.unwrap();
    recall_message(&pool, 20001, &message.message_id)
        .await
        .unwrap();
    let after: (String,String,Option<String>,u64,PrimitiveDateTime) = sqlx::query_as("SELECT CAST(content AS CHAR),content_hash,reply_to_message_id,conversation_seq,created_at FROM messages WHERE message_id=?")
        .bind(&message.message_id).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let attachment: (String, Option<String>) =
        sqlx::query_as("SELECT status,message_id FROM attachments WHERE attachment_id=?")
            .bind(&attachment_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(attachment, ("attached".into(), Some(message.message_id)));
    let cursors: Vec<(u64, u64)> = sqlx::query_as(
        "SELECT delivered_seq,read_seq FROM conversation_member_cursors WHERE conversation_id=?",
    )
    .bind(fixture.conversation_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(cursors, [(2, 1), (2, 1)]);
    sqlx::query("DELETE FROM conversation_member_cursors WHERE conversation_id=?")
        .bind(fixture.conversation_id)
        .execute(&pool)
        .await
        .unwrap();
    fixture.cleanup(&pool).await;
}
