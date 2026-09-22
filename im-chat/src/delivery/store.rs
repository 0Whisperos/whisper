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
#[path = "store_tests.rs"]
mod tests;
