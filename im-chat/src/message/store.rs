use super::content::{self, ValidatedMessage};
use super::event::MessageCreatedEvent;
use super::{
    AcceptedMessage, CONVERSATION_NOT_FOUND, DUPLICATE_CLIENT_MESSAGE_CONFLICT, INTERNAL_ERROR,
    INVALID_MESSAGE, NOT_CONVERSATION_MEMBER, SendMessagePayload,
};
use sqlx::mysql::{MySqlQueryResult, MySqlRow};
use sqlx::{MySqlPool, Row};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, PrimitiveDateTime};

const DIRECT_CONVERSATION: &str = "direct";
const ACTIVE_MEMBER: &str = "active";

#[derive(Debug, thiserror::Error)]
pub(super) enum AcceptMessageError {
    #[error("invalid message")]
    InvalidMessage,

    #[error("conversation not found")]
    ConversationNotFound,

    #[error("not a conversation member")]
    NotConversationMember,

    #[error("duplicate client message conflict")]
    DuplicateClientMessageConflict,

    #[error("internal sql error: {source}")]
    InternalSql {
        #[from]
        source: sqlx::Error,
    },

    #[error("internal json error: {source}")]
    InternalJson {
        #[from]
        source: serde_json::Error,
    },
}

impl AcceptMessageError {
    pub(super) fn into_reject(self, client_message_id: Option<String>) -> super::SendMessageReject {
        let (error_code, message) = match self {
            Self::InvalidMessage => (INVALID_MESSAGE, "invalid message"),
            Self::ConversationNotFound => (CONVERSATION_NOT_FOUND, "conversation not found"),
            Self::NotConversationMember => (
                NOT_CONVERSATION_MEMBER,
                "current user is not an active member of the conversation",
            ),
            Self::DuplicateClientMessageConflict => (
                DUPLICATE_CLIENT_MESSAGE_CONFLICT,
                "client_message_id was reused with different content",
            ),
            Self::InternalSql { .. } | Self::InternalJson { .. } => {
                (INTERNAL_ERROR, "internal error")
            }
        };
        super::SendMessageReject {
            client_message_id,
            error_code,
            message,
        }
    }
}

pub(super) async fn accept_message(
    pool: &MySqlPool,
    sender_user_id: u64,
    payload: SendMessagePayload,
) -> Result<AcceptedMessage, AcceptMessageError> {
    let validated =
        content::validate_send_payload(&payload).map_err(|_| AcceptMessageError::InvalidMessage)?;

    let mut tx = pool.begin().await?;
    ensure_direct_conversation(&mut tx, payload.conversation_id).await?;
    ensure_active_member(&mut tx, payload.conversation_id, sender_user_id).await?;

    if let Some(existing) =
        find_existing_message_in_tx(&mut tx, sender_user_id, &payload.client_message_id).await?
    {
        let accepted = accept_existing_or_conflict(existing, &payload, &validated)?;
        tx.commit().await?;
        return Ok(accepted);
    }

    let now = OffsetDateTime::now_utc();
    let created_at = primitive_utc(now);
    let conversation_seq =
        next_conversation_seq(&mut tx, payload.conversation_id, created_at).await?;
    let message = AcceptedMessage {
        message_id: uuid::Uuid::new_v4().to_string(),
        conversation_id: payload.conversation_id,
        conversation_seq,
        sender_user_id,
        client_message_id: payload.client_message_id.clone(),
        message_type: validated.message_type.clone(),
        content: validated.content.clone(),
        created_at: format_protocol_time(now),
    };

    let insert_result =
        insert_message(&mut tx, &message, &validated.content_hash, created_at).await;
    if let Err(error) = insert_result {
        if is_duplicate_key_error(&error) {
            let _ = tx.rollback().await;
            return accept_concurrent_duplicate(pool, sender_user_id, payload, validated).await;
        }
        return Err(AcceptMessageError::InternalSql { source: error });
    }

    insert_outbox_event(&mut tx, &message, now, created_at).await?;
    tx.commit().await?;
    Ok(message)
}

async fn ensure_direct_conversation(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    conversation_id: u64,
) -> Result<(), AcceptMessageError> {
    let row = sqlx::query("SELECT conversation_type FROM conversations WHERE id = ?")
        .bind(conversation_id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(row) = row else {
        return Err(AcceptMessageError::ConversationNotFound);
    };
    let conversation_type: String = row.try_get("conversation_type")?;
    if conversation_type != DIRECT_CONVERSATION {
        return Err(AcceptMessageError::ConversationNotFound);
    }
    Ok(())
}

async fn ensure_active_member(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    conversation_id: u64,
    sender_user_id: u64,
) -> Result<(), AcceptMessageError> {
    let row = sqlx::query(
        "SELECT 1 FROM conversation_members \
         WHERE conversation_id = ? AND user_id = ? AND member_state = ?",
    )
    .bind(conversation_id)
    .bind(sender_user_id)
    .bind(ACTIVE_MEMBER)
    .fetch_optional(&mut **tx)
    .await?;
    if row.is_none() {
        return Err(AcceptMessageError::NotConversationMember);
    }
    Ok(())
}

async fn find_existing_message_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    sender_user_id: u64,
    client_message_id: &str,
) -> Result<Option<StoredMessage>, AcceptMessageError> {
    let row = existing_message_query()
        .bind(sender_user_id)
        .bind(client_message_id)
        .fetch_optional(&mut **tx)
        .await?;
    row.map(stored_message_from_row).transpose()
}

async fn find_existing_message(
    pool: &MySqlPool,
    sender_user_id: u64,
    client_message_id: &str,
) -> Result<Option<StoredMessage>, AcceptMessageError> {
    let row = existing_message_query()
        .bind(sender_user_id)
        .bind(client_message_id)
        .fetch_optional(pool)
        .await?;
    row.map(stored_message_from_row).transpose()
}

fn existing_message_query() -> sqlx::query::Query<'static, sqlx::MySql, sqlx::mysql::MySqlArguments>
{
    sqlx::query(
        "SELECT message_id, conversation_id, conversation_seq, sender_user_id, \
         client_message_id, message_type, CAST(content AS CHAR) AS content, \
         content_hash, created_at \
         FROM messages WHERE sender_user_id = ? AND client_message_id = ?",
    )
}

async fn next_conversation_seq(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    conversation_id: u64,
    updated_at: PrimitiveDateTime,
) -> Result<u64, AcceptMessageError> {
    let row = sqlx::query("SELECT last_seq FROM conversations WHERE id = ? FOR UPDATE")
        .bind(conversation_id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(row) = row else {
        return Err(AcceptMessageError::ConversationNotFound);
    };
    let last_seq: u64 = row.try_get("last_seq")?;
    let next_seq = last_seq.saturating_add(1);
    sqlx::query("UPDATE conversations SET last_seq = ?, updated_at = ? WHERE id = ?")
        .bind(next_seq)
        .bind(updated_at)
        .bind(conversation_id)
        .execute(&mut **tx)
        .await?;
    Ok(next_seq)
}

async fn insert_message(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    message: &AcceptedMessage,
    content_hash: &str,
    created_at: PrimitiveDateTime,
) -> Result<MySqlQueryResult, sqlx::Error> {
    let content = serde_json::to_string(&message.content)
        .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
    sqlx::query(
        "INSERT INTO messages \
         (message_id, conversation_id, conversation_seq, sender_user_id, client_message_id, \
          message_type, content, content_hash, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)",
    )
    .bind(&message.message_id)
    .bind(message.conversation_id)
    .bind(message.conversation_seq)
    .bind(message.sender_user_id)
    .bind(&message.client_message_id)
    .bind(&message.message_type)
    .bind(content)
    .bind(content_hash)
    .bind(created_at)
    .execute(&mut **tx)
    .await
}

async fn insert_outbox_event(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    message: &AcceptedMessage,
    occurred_at: OffsetDateTime,
    created_at: PrimitiveDateTime,
) -> Result<(), AcceptMessageError> {
    let event = MessageCreatedEvent::new(message.clone(), format_protocol_time(occurred_at));
    let payload = serde_json::to_string(&event)?;
    sqlx::query(
        "INSERT INTO outbox_events \
         (id, aggregatetype, aggregateid, type, payload, created_at) \
         VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)",
    )
    .bind(&event.event_id)
    .bind(&event.aggregate_type)
    .bind(&event.aggregate_id)
    .bind(&event.event_type)
    .bind(payload)
    .bind(created_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn accept_concurrent_duplicate(
    pool: &MySqlPool,
    sender_user_id: u64,
    payload: SendMessagePayload,
    validated: ValidatedMessage,
) -> Result<AcceptedMessage, AcceptMessageError> {
    let Some(existing) =
        find_existing_message(pool, sender_user_id, &payload.client_message_id).await?
    else {
        return Err(AcceptMessageError::InternalSql {
            source: sqlx::Error::RowNotFound,
        });
    };
    accept_existing_or_conflict(existing, &payload, &validated)
}

fn accept_existing_or_conflict(
    existing: StoredMessage,
    payload: &SendMessagePayload,
    validated: &ValidatedMessage,
) -> Result<AcceptedMessage, AcceptMessageError> {
    if existing.message.conversation_id == payload.conversation_id
        && existing.message.message_type == validated.message_type
        && existing.content_hash == validated.content_hash
    {
        return Ok(existing.message);
    }
    Err(AcceptMessageError::DuplicateClientMessageConflict)
}

#[derive(Debug)]
struct StoredMessage {
    message: AcceptedMessage,
    content_hash: String,
}

fn stored_message_from_row(row: MySqlRow) -> Result<StoredMessage, AcceptMessageError> {
    let content: String = row.try_get("content")?;
    let content = serde_json::from_str(&content)?;
    let created_at: PrimitiveDateTime = row.try_get("created_at")?;
    let message = AcceptedMessage {
        message_id: row.try_get("message_id")?,
        conversation_id: row.try_get("conversation_id")?,
        conversation_seq: row.try_get("conversation_seq")?,
        sender_user_id: row.try_get("sender_user_id")?,
        client_message_id: row.try_get("client_message_id")?,
        message_type: row.try_get("message_type")?,
        content,
        created_at: format_protocol_time(created_at.assume_utc()),
    };
    Ok(StoredMessage {
        message,
        content_hash: row.try_get("content_hash")?,
    })
}

fn primitive_utc(offset: OffsetDateTime) -> PrimitiveDateTime {
    PrimitiveDateTime::new(offset.date(), offset.time())
}

fn format_protocol_time(time: OffsetDateTime) -> String {
    time.format(&Rfc3339)
        .expect("UTC message timestamps should format as RFC3339")
}

fn is_duplicate_key_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .is_some_and(|code| code.as_ref() == "23000")
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
