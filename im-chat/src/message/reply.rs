//! Reply references are persisted as IDs; target content is read at client exits.

use super::AcceptedMessage;
use serde::{Deserialize, Serialize, Serializer, ser::SerializeStruct};
use sqlx::{Executor, MySql, Row};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ReplyTarget {
    pub(crate) message_id: String,
    pub(crate) sender_user_id: u64,
    pub(crate) message_type: String,
    pub(crate) content: serde_json::Value,
}

pub(super) fn valid_reply_id(message_id: Option<&str>) -> bool {
    message_id.is_none_or(|id| id.len() == 36 && uuid::Uuid::parse_str(id).is_ok())
}

pub(super) async fn find_reply_target<'e>(
    executor: impl Executor<'e, Database = MySql>,
    conversation_id: u64,
    message_id: &str,
) -> Result<Option<ReplyTarget>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT message_id, sender_user_id, message_type, CAST(content AS CHAR) AS content \
         FROM messages WHERE conversation_id = ? AND message_id = ?",
    )
    .bind(conversation_id)
    .bind(message_id)
    .fetch_optional(executor)
    .await?;
    row.map(|row| {
        let content: String = row.try_get("content")?;
        Ok(ReplyTarget {
            message_id: row.try_get("message_id")?,
            sender_user_id: row.try_get("sender_user_id")?,
            message_type: row.try_get("message_type")?,
            content: serde_json::from_str(&content)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        })
    })
    .transpose()
}

pub(crate) async fn populate_reply<'e>(
    executor: impl Executor<'e, Database = MySql>,
    message: &mut AcceptedMessage,
) -> Result<(), sqlx::Error> {
    message.reply_to = match message.reply_to_message_id.as_deref() {
        Some(id) => find_reply_target(executor, message.conversation_id, id).await?,
        None => None,
    };
    Ok(())
}

/// Keep target bodies out of append-only events even when an accepted DTO has one.
pub(super) fn serialize_event_message<S: Serializer>(
    message: &AcceptedMessage,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut state = serializer.serialize_struct("MessageCreatedBody", 9)?;
    state.serialize_field("message_id", &message.message_id)?;
    state.serialize_field("conversation_id", &message.conversation_id)?;
    state.serialize_field("conversation_seq", &message.conversation_seq)?;
    state.serialize_field("sender_user_id", &message.sender_user_id)?;
    state.serialize_field("client_message_id", &message.client_message_id)?;
    state.serialize_field("message_type", &message.message_type)?;
    state.serialize_field("content", &message.content)?;
    state.serialize_field("reply_to_message_id", &message.reply_to_message_id)?;
    state.serialize_field("created_at", &message.created_at)?;
    state.end()
}
