use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::super::event::{CHAT_MESSAGE, EVENT_VERSION, EventValidationError};

pub(crate) const MESSAGE_RECALLED: &str = "message_recalled";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RecalledMessage {
    pub(crate) message_id: String,
    pub(crate) conversation_id: u64,
    pub(crate) conversation_seq: u64,
    pub(crate) sender_user_id: u64,
    pub(crate) recalled_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct MessageRecalledEvent {
    pub(crate) event_id: String,
    pub(crate) event_type: String,
    pub(crate) aggregate_type: String,
    pub(crate) aggregate_id: String,
    pub(crate) event_version: u32,
    pub(crate) occurred_at: String,
    pub(crate) recalled_message: RecalledMessage,
}

impl MessageRecalledEvent {
    pub(in crate::message) fn new(message: RecalledMessage) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: MESSAGE_RECALLED.to_owned(),
            aggregate_type: CHAT_MESSAGE.to_owned(),
            aggregate_id: message.conversation_id.to_string(),
            event_version: EVENT_VERSION,
            occurred_at: message.recalled_at.clone(),
            recalled_message: message,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), EventValidationError> {
        if self.event_type != MESSAGE_RECALLED {
            return Err(EventValidationError::UnsupportedType);
        }
        if self.event_version != EVENT_VERSION {
            return Err(EventValidationError::UnsupportedVersion);
        }
        if self.aggregate_type != CHAT_MESSAGE {
            return Err(EventValidationError::InvalidField("aggregate_type"));
        }
        if self.aggregate_id != self.recalled_message.conversation_id.to_string() {
            return Err(EventValidationError::AggregateMismatch);
        }
        for (name, value) in [
            ("event_id", self.event_id.as_str()),
            (
                "recalled_message.message_id",
                self.recalled_message.message_id.as_str(),
            ),
        ] {
            if value.len() != 36 || uuid::Uuid::parse_str(value).is_err() {
                return Err(EventValidationError::InvalidField(name));
            }
        }
        for (name, value) in [
            ("occurred_at", self.occurred_at.as_str()),
            (
                "recalled_message.recalled_at",
                self.recalled_message.recalled_at.as_str(),
            ),
        ] {
            if OffsetDateTime::parse(value, &Rfc3339).is_err() {
                return Err(EventValidationError::InvalidField(name));
            }
        }
        if self.recalled_message.conversation_id == 0 {
            return Err(EventValidationError::InvalidField(
                "recalled_message.conversation_id",
            ));
        }
        if self.recalled_message.conversation_seq == 0 {
            return Err(EventValidationError::InvalidField(
                "recalled_message.conversation_seq",
            ));
        }
        if self.recalled_message.sender_user_id == 0 {
            return Err(EventValidationError::InvalidField(
                "recalled_message.sender_user_id",
            ));
        }
        Ok(())
    }
}
