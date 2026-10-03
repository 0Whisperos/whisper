use crate::db_time::to_database_datetime;
use sqlx::{MySqlPool, Row};

#[derive(Clone, Copy)]
pub(super) enum AckKind {
    Delivered,
    Read,
}

pub(super) struct Cursor {
    pub(super) delivered_seq: u64,
    pub(super) read_seq: u64,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum AckError {
    #[error("conversation not found")]
    ConversationNotFound,
    #[error("not a conversation member")]
    NotConversationMember,
    #[error("cursor out of range")]
    CursorOutOfRange,
    #[error("internal sql error: {0}")]
    Sql(#[from] sqlx::Error),
}

pub(super) async fn acknowledge(
    pool: &MySqlPool,
    user_id: u64,
    conversation_id: u64,
    sequence: u64,
    kind: AckKind,
) -> Result<Cursor, AckError> {
    let mut tx = pool.begin().await?;
    let conversation =
        sqlx::query("SELECT conversation_type, last_seq FROM conversations WHERE id = ?")
            .bind(conversation_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(conversation) = conversation else {
        return Err(AckError::ConversationNotFound);
    };
    let conversation_type: String = conversation.try_get("conversation_type")?;
    let last_seq: u64 = conversation.try_get("last_seq")?;
    if conversation_type != "direct" {
        return Err(AckError::ConversationNotFound);
    }

    let member = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM conversation_members \
         WHERE conversation_id = ? AND user_id = ? AND member_state = 'active'",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if member.is_none() {
        return Err(AckError::NotConversationMember);
    }
    if sequence > last_seq {
        return Err(AckError::CursorOutOfRange);
    }

    sqlx::query(
        "INSERT INTO conversation_member_cursors (conversation_id, user_id) VALUES (?, ?) \
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)",
    )
    .bind(conversation_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    let cursor = sqlx::query(
        "SELECT delivered_seq, read_seq FROM conversation_member_cursors \
         WHERE conversation_id = ? AND user_id = ? FOR UPDATE",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;
    let delivered_seq: u64 = cursor.try_get("delivered_seq")?;
    let read_seq: u64 = cursor.try_get("read_seq")?;

    let (next_delivered, next_read) = match kind {
        AckKind::Delivered => (delivered_seq.max(sequence), read_seq),
        AckKind::Read if sequence > delivered_seq => return Err(AckError::CursorOutOfRange),
        AckKind::Read => (delivered_seq, read_seq.max(sequence)),
    };
    let advanced = match kind {
        AckKind::Delivered => next_delivered > delivered_seq,
        AckKind::Read => next_read > read_seq,
    };
    let now = to_database_datetime(time::OffsetDateTime::now_utc());
    match kind {
        AckKind::Delivered => {
            sqlx::query(
                "UPDATE conversation_member_cursors \
                 SET delivered_seq = ?, delivered_at = IF(?, ?, delivered_at) \
                 WHERE conversation_id = ? AND user_id = ?",
            )
            .bind(next_delivered)
            .bind(advanced)
            .bind(now)
            .bind(conversation_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
        AckKind::Read => {
            sqlx::query(
                "UPDATE conversation_member_cursors \
                 SET read_seq = ?, read_at = IF(?, ?, read_at) \
                 WHERE conversation_id = ? AND user_id = ?",
            )
            .bind(next_read)
            .bind(advanced)
            .bind(now)
            .bind(conversation_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(Cursor {
        delivered_seq: next_delivered,
        read_seq: next_read,
    })
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
