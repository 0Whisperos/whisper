use super::event::{MessageRecalledEvent, RecalledMessage};
use crate::db_time::{from_database_datetime, to_database_datetime};
use sqlx::{MySqlPool, Row};
use time::{OffsetDateTime, PrimitiveDateTime, format_description::well_known::Rfc3339};

#[derive(Debug, thiserror::Error)]
pub(super) enum RecallError {
    #[error("invalid message id")]
    InvalidMessageId,
    #[error("message not found")]
    MessageNotFound,
    #[error("current user cannot recall this message")]
    MessageNotOwned,
    #[error("recall storage failed: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("recall event serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
}

impl RecallError {
    pub(super) fn rejection(&self) -> (&'static str, &'static str) {
        match self {
            Self::InvalidMessageId => ("invalid_message_id", "invalid message id"),
            Self::MessageNotFound => ("message_not_found", "message not found"),
            Self::MessageNotOwned => (
                "message_not_owned",
                "current user cannot recall this message",
            ),
            Self::Sql(_) | Self::Serialize(_) => ("internal_error", "internal error"),
        }
    }
}

pub(super) async fn recall_message(
    pool: &MySqlPool,
    user_id: u64,
    message_id: &str,
) -> Result<RecalledMessage, RecallError> {
    if message_id.len() != 36 {
        return Err(RecallError::InvalidMessageId);
    }
    let canonical_id = uuid::Uuid::parse_str(message_id)
        .map_err(|_| RecallError::InvalidMessageId)?
        .to_string();
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT message_id, conversation_id, conversation_seq, sender_user_id, recalled_at \
         FROM messages WHERE message_id = ? FOR UPDATE",
    )
    .bind(&canonical_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(RecallError::MessageNotFound)?;
    let message_id: String = row.try_get("message_id")?;
    let conversation_id: u64 = row.try_get("conversation_id")?;
    let visible: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id \
         WHERE m.conversation_id = ? AND m.user_id = ? AND m.member_state = 'active' \
         AND c.conversation_type = 'direct'",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if visible.is_none() {
        return Err(RecallError::MessageNotFound);
    }
    let sender_user_id: u64 = row.try_get("sender_user_id")?;
    if sender_user_id != user_id {
        return Err(RecallError::MessageNotOwned);
    }
    let stored: Option<PrimitiveDateTime> = row.try_get("recalled_at")?;
    let first_recall = stored.is_none();
    let recalled_at = match stored {
        Some(value) => value,
        None => {
            sqlx::query("UPDATE messages SET recalled_at = ? WHERE message_id = ?")
                .bind(to_database_datetime(OffsetDateTime::now_utc()))
                .bind(&message_id)
                .execute(&mut *tx)
                .await?;
            // Read back DATETIME(6) so the first response, retries and event share exact precision.
            sqlx::query_scalar("SELECT recalled_at FROM messages WHERE message_id = ?")
                .bind(&message_id)
                .fetch_one(&mut *tx)
                .await?
        }
    };
    let message = RecalledMessage {
        message_id,
        conversation_id,
        conversation_seq: row.try_get("conversation_seq")?,
        sender_user_id,
        recalled_at: from_database_datetime(recalled_at)
            .format(&Rfc3339)
            .expect("database time formats"),
    };
    if first_recall {
        let event = MessageRecalledEvent::new(message.clone());
        sqlx::query(
            "INSERT INTO outbox_events (id, aggregatetype, aggregateid, type, payload, created_at) \
             VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)",
        )
        .bind(&event.event_id)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.event_type)
        .bind(serde_json::to_string(&event)?)
        .bind(recalled_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(message)
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
