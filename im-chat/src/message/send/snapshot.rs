//! Refresh mutable message state while retaining the immutable creation body.

use super::{AcceptedMessage, populate_reply};
use crate::db_time::from_database_datetime;
use sqlx::MySqlPool;
use time::{PrimitiveDateTime, format_description::well_known::Rfc3339};

pub(crate) async fn refresh_message(
    pool: &MySqlPool,
    message: &mut AcceptedMessage,
) -> Result<(), sqlx::Error> {
    let recalled_at: Option<PrimitiveDateTime> = sqlx::query_scalar(
        "SELECT recalled_at FROM messages WHERE conversation_id = ? AND message_id = ?",
    )
    .bind(message.conversation_id)
    .bind(&message.message_id)
    .fetch_one(pool)
    .await?;
    message.recalled_at = recalled_at.map(|value| {
        from_database_datetime(value)
            .format(&Rfc3339)
            .expect("database time formats")
    });
    populate_reply(pool, message).await
}
