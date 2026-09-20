use super::{AcceptedMessage, SendMessagePayload, content};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub(super) const MESSAGE_CREATED: &str = "message_created";
pub(super) const CHAT_MESSAGE: &str = "chat_message";
pub(super) const EVENT_VERSION: u32 = 1;

/// The same envelope is written into outbox payloads and consumed from Kafka.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct MessageCreatedEvent {
    pub(crate) event_id: String,
    pub(crate) event_type: String,
    pub(crate) aggregate_type: String,
    pub(crate) aggregate_id: String,
    pub(crate) event_version: u32,
    pub(crate) occurred_at: String,
    pub(crate) message: AcceptedMessage,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum EventValidationError {
    #[error("unsupported event type")]
    UnsupportedType,
    #[error("unsupported event version")]
    UnsupportedVersion,
    #[error("aggregate id does not match the message conversation")]
    AggregateMismatch,
    #[error("invalid event field: {0}")]
    InvalidField(&'static str),
}

impl MessageCreatedEvent {
    pub(super) fn new(message: AcceptedMessage, occurred_at: String) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: MESSAGE_CREATED.to_owned(),
            aggregate_type: CHAT_MESSAGE.to_owned(),
            aggregate_id: message.conversation_id.to_string(),
            event_version: EVENT_VERSION,
            occurred_at,
            message,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), EventValidationError> {
        if self.event_type != MESSAGE_CREATED {
            return Err(EventValidationError::UnsupportedType);
        }
        if self.event_version != EVENT_VERSION {
            return Err(EventValidationError::UnsupportedVersion);
        }
        if self.aggregate_type != CHAT_MESSAGE {
            return Err(EventValidationError::InvalidField("aggregate_type"));
        }
        if self.aggregate_id != self.message.conversation_id.to_string() {
            return Err(EventValidationError::AggregateMismatch);
        }
        for (name, value) in [
            ("event_id", self.event_id.as_str()),
            ("message.message_id", self.message.message_id.as_str()),
        ] {
            if value.len() != 36 || uuid::Uuid::parse_str(value).is_err() {
                return Err(EventValidationError::InvalidField(name));
            }
        }
        for (name, value) in [
            ("occurred_at", self.occurred_at.as_str()),
            ("message.created_at", self.message.created_at.as_str()),
        ] {
            if OffsetDateTime::parse(value, &Rfc3339).is_err() {
                return Err(EventValidationError::InvalidField(name));
            }
        }
        if self.message.sender_user_id == 0 {
            return Err(EventValidationError::InvalidField("message.sender_user_id"));
        }
        if self.message.conversation_seq == 0 {
            return Err(EventValidationError::InvalidField(
                "message.conversation_seq",
            ));
        }
        let payload = SendMessagePayload {
            client_message_id: self.message.client_message_id.clone(),
            conversation_id: self.message.conversation_id,
            message_type: self.message.message_type.clone(),
            content: self.message.content.clone(),
            client_sent_at: None,
        };
        content::validate_send_payload(&payload)
            .map_err(|_| EventValidationError::InvalidField("message"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
