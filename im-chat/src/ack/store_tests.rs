use super::*;
use sqlx::mysql::MySqlPoolOptions;
use std::env;

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to a dedicated MySQL database"]
async fn acknowledge_creates_member_cursor_and_enforces_monotonic_ranges() {
    // 测试目标：验证 ACK 首次请求会创建现有成员游标行、游标单调推进且 read_seq 不超过 delivered_seq/last_seq。
    // 构造方法：连接 TEST_DATABASE_URL，创建两个 active direct 成员但不预建 cursor 行，再依次提交和重发 ACK。
    // 输入数据：会话 last_seq=5；送达 3 后重发 2；尝试已读 4、确认已读 3、再尝试送达 6。
    // 预期行为：首个送达游标为 3，旧值仍接受且不回退，未送达和越界 ACK 返回 CursorOutOfRange，最终值为 3/3。
    let database_url = env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required");
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("TEST_DATABASE_URL should connect");
    for statement in [
        "CREATE TABLE IF NOT EXISTS users (
            id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
            account VARCHAR(12) NOT NULL,
            password_hash VARCHAR(60) NOT NULL,
            nickname VARCHAR(64) NOT NULL DEFAULT '',
            created_at DATETIME(6) NOT NULL,
            updated_at DATETIME(6) NOT NULL,
            UNIQUE KEY uk_users_account (account)
        )",
        "CREATE TABLE IF NOT EXISTS conversations (
            id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
            conversation_type VARCHAR(16) NOT NULL,
            last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL,
            updated_at DATETIME(6) NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS conversation_members (
            conversation_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            member_state VARCHAR(16) NOT NULL,
            joined_at DATETIME(6) NOT NULL,
            PRIMARY KEY (conversation_id, user_id)
        )",
        "CREATE TABLE IF NOT EXISTS conversation_member_cursors (
            conversation_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            delivered_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
            read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
            delivered_at DATETIME(6) NULL,
            read_at DATETIME(6) NULL,
            PRIMARY KEY (conversation_id, user_id)
        )",
    ] {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("create ACK test schema");
    }
    let mut tx = pool.begin().await.expect("begin fixture transaction");
    let mut users = Vec::new();
    for nickname in ["ack-alice", "ack-bob"] {
        let account = format!("{:012}", uuid::Uuid::new_v4().as_u128() % 1_000_000_000_000);
        let result = sqlx::query(
            "INSERT INTO users (account, password_hash, nickname, created_at, updated_at) \
             VALUES (?, 'ack-test-not-a-login-password', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        )
        .bind(account)
        .bind(nickname)
        .execute(&mut *tx)
        .await
        .expect("insert test user");
        users.push(result.last_insert_id());
    }
    let conversation_id: u64 = sqlx::query(
        "INSERT INTO conversations (conversation_type, last_seq, created_at, updated_at) \
         VALUES ('direct', 5, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
    )
    .execute(&mut *tx)
    .await
    .expect("insert direct conversation")
    .last_insert_id();
    for user_id in &users {
        sqlx::query(
            "INSERT INTO conversation_members (conversation_id, user_id, member_state, joined_at) \
             VALUES (?, ?, 'active', UTC_TIMESTAMP(6))",
        )
        .bind(conversation_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .expect("insert active member without a cursor row");
    }
    tx.commit().await.expect("commit test fixture");

    let first = acknowledge(&pool, users[0], conversation_id, 3, AckKind::Delivered)
        .await
        .expect("first delivered ack should create and advance cursor");
    assert_eq!(first.delivered_seq, 3);
    let repeated = acknowledge(&pool, users[0], conversation_id, 2, AckKind::Delivered)
        .await
        .expect("older delivered ack should remain accepted");
    assert_eq!(repeated.delivered_seq, 3);
    assert!(matches!(
        acknowledge(&pool, users[0], conversation_id, 4, AckKind::Read).await,
        Err(AckError::CursorOutOfRange)
    ));
    let read = acknowledge(&pool, users[0], conversation_id, 3, AckKind::Read)
        .await
        .expect("read ack at delivered cursor should be accepted");
    assert_eq!(read.read_seq, 3);
    assert!(matches!(
        acknowledge(&pool, users[0], conversation_id, 6, AckKind::Delivered).await,
        Err(AckError::CursorOutOfRange)
    ));

    let saved: (u64, u64) = sqlx::query_as(
        "SELECT delivered_seq, read_seq FROM conversation_member_cursors WHERE conversation_id = ? AND user_id = ?",
    )
    .bind(conversation_id)
    .bind(users[0])
    .fetch_one(&pool)
    .await
    .expect("load saved cursor");
    assert_eq!(saved, (3, 3));

    let mut tx = pool.begin().await.expect("begin fixture cleanup");
    sqlx::query("DELETE FROM conversation_member_cursors WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await
        .expect("delete test cursor rows");
    sqlx::query("DELETE FROM conversation_members WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await
        .expect("delete test members");
    sqlx::query("DELETE FROM conversations WHERE id = ?")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await
        .expect("delete test conversation");
    sqlx::query("DELETE FROM users WHERE id IN (?, ?)")
        .bind(users[0])
        .bind(users[1])
        .execute(&mut *tx)
        .await
        .expect("delete test users");
    tx.commit().await.expect("commit fixture cleanup");
    pool.close().await;
}
