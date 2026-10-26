use super::{recall::MessageRecalledEvent, send::MessageCreatedEvent};
use serde::Deserialize;

#[derive(Clone, Debug)]
pub(crate) enum MessageEvent {
    Created(Box<MessageCreatedEvent>),
    Recalled(MessageRecalledEvent),
}

impl<'de> Deserialize<'de> for MessageEvent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value.get("event_type").and_then(|kind| kind.as_str()) {
            Some("message_created") => serde_json::from_value(value)
                .map(Box::new)
                .map(Self::Created)
                .map_err(serde::de::Error::custom),
            Some("message_recalled") => serde_json::from_value(value)
                .map(Self::Recalled)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom("unsupported event type")),
        }
    }
}

impl MessageEvent {
    pub(crate) fn validate(&self) -> Result<(), EventValidationError> {
        match self {
            Self::Created(event) => event.validate(),
            Self::Recalled(event) => event.validate(),
        }
    }
    pub(crate) fn event_id(&self) -> &str {
        match self {
            Self::Created(event) => &event.event_id,
            Self::Recalled(event) => &event.event_id,
        }
    }
    pub(crate) fn event_type(&self) -> &str {
        match self {
            Self::Created(event) => &event.event_type,
            Self::Recalled(event) => &event.event_type,
        }
    }
    pub(crate) fn aggregate_id(&self) -> &str {
        match self {
            Self::Created(event) => &event.aggregate_id,
            Self::Recalled(event) => &event.aggregate_id,
        }
    }
    pub(crate) fn aggregate_type(&self) -> &str {
        match self {
            Self::Created(event) => &event.aggregate_type,
            Self::Recalled(event) => &event.aggregate_type,
        }
    }
}

pub(super) const CHAT_MESSAGE: &str = "chat_message";
pub(super) const EVENT_VERSION: u32 = 1;

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
