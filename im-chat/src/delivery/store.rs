use sqlx::MySqlPool;

pub(super) async fn active_members(
    pool: &MySqlPool,
    conversation_id: u64,
) -> Result<Vec<u64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT user_id FROM conversation_members \
         WHERE conversation_id = ? AND member_state = 'active' ORDER BY user_id",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL pointing to a dedicated migrated MySQL database"]
    async fn filters_active_members_and_orders_users() {
        // 测试目标：验证成员查询只返回目标会话 active 成员，并包含发送者。
        // 构造方法：在专用已迁移数据库插入独立会话和三名不同状态成员，查询后清理。
        // 输入数据：用户 20002/20001 为 active，20003 为 left，另查不存在会话。
        // 预期行为：返回 [20001, 20002]，不存在会话返回空列表。
        let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL is required");
        let pool = MySqlPool::connect(&url)
            .await
            .expect("connect test database");
        let id = sqlx::query(
            "INSERT INTO conversations (conversation_type, last_seq, created_at, updated_at) \
             VALUES ('direct', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        )
        .execute(&pool)
        .await
        .expect("insert conversation")
        .last_insert_id();
        for (user_id, state) in [(20002_u64, "active"), (20001, "active"), (20003, "left")] {
            sqlx::query(
                "INSERT INTO conversation_members (conversation_id, user_id, member_state, joined_at) \
                 VALUES (?, ?, ?, UTC_TIMESTAMP(6))",
            ).bind(id).bind(user_id).bind(state).execute(&pool).await.expect("insert member");
        }
        let actual = active_members(&pool, id).await;
        let absent = active_members(&pool, 0).await;
        sqlx::query("DELETE FROM conversation_members WHERE conversation_id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .expect("cleanup members");
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .expect("cleanup conversation");
        assert_eq!(actual.expect("query members"), vec![20001, 20002]);
        assert!(absent.expect("query absent conversation").is_empty());
    }
}
