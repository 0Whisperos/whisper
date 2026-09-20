use rdkafka::Message;
use rdkafka::message::Headers;

use crate::message::MessageCreatedEvent;

/// Owns bytes so a record never keeps a consumer alive during a blocking close.
pub(super) struct EventRecord {
    pub(super) position: RecordPosition,
    pub(super) key: Option<Vec<u8>>,
    pub(super) payload: Option<Vec<u8>>,
    pub(super) headers: Vec<(String, Option<Vec<u8>>)>,
}

#[derive(Clone, Debug)]
pub(super) struct RecordPosition {
    pub(super) topic: String,
    pub(super) partition: i32,
    pub(super) offset: i64,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum RecordError {
    #[error("missing event payload")]
    MissingPayload,
    #[error("invalid event JSON at line {line}, column {column}")]
    InvalidJson { line: usize, column: usize },
    #[error("invalid event envelope: {0}")]
    InvalidEnvelope(#[from] crate::message::EventValidationError),
    #[error("Kafka key does not match event aggregate_id")]
    InvalidKey,
    #[error("missing, duplicated, or conflicting event header: {0}")]
    InvalidHeader(&'static str),
}

impl EventRecord {
    pub(super) fn from_message(message: &impl Message) -> Self {
        Self {
            position: RecordPosition {
                topic: message.topic().to_owned(),
                partition: message.partition(),
                offset: message.offset(),
            },
            key: message.key().map(<[u8]>::to_vec),
            payload: message.payload().map(<[u8]>::to_vec),
            headers: message
                .headers()
                .map(|headers| {
                    headers
                        .iter()
                        .map(|header| (header.key.to_owned(), header.value.map(<[u8]>::to_vec)))
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub(super) fn parse(&self) -> Result<MessageCreatedEvent, RecordError> {
        let payload = self.payload.as_deref().ok_or(RecordError::MissingPayload)?;
        // Do not log serde's input-dependent error text: malformed fields may contain chat text.
        let event: MessageCreatedEvent =
            serde_json::from_slice(payload).map_err(|error| RecordError::InvalidJson {
                line: error.line(),
                column: error.column(),
            })?;
        event.validate()?;
        if self.key.as_deref() != Some(event.aggregate_id.as_bytes()) {
            return Err(RecordError::InvalidKey);
        }
        for (name, expected) in [
            ("event_id", event.event_id.as_str()),
            ("event_type", event.event_type.as_str()),
            ("aggregate_type", event.aggregate_type.as_str()),
        ] {
            let mut values = self.headers.iter().filter(|(key, _)| key == name);
            if values.next().and_then(|(_, value)| value.as_deref()) != Some(expected.as_bytes())
                || values.next().is_some()
            {
                return Err(RecordError::InvalidHeader(name));
            }
        }
        Ok(event)
    }

    pub(super) fn event_id_for_log(&self) -> Option<String> {
        let value = self
            .payload
            .as_deref()
            .and_then(|payload| serde_json::from_slice::<serde_json::Value>(payload).ok());
        value
            .as_ref()
            .and_then(|value| value.get("event_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                self.headers
                    .iter()
                    .find(|(name, _)| name == "event_id")
                    .and_then(|(_, value)| value.as_deref())
                    .and_then(|bytes| std::str::from_utf8(bytes).ok())
                    .map(str::to_owned)
            })
    }
}
