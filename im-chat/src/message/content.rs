use super::{SendMessagePayload, TEXT};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

pub(super) const MAX_TEXT_MESSAGE_CHARS: usize = 4096;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ContentValidationError {
    InvalidMessage,
}

#[derive(Debug)]
pub(super) struct ValidatedMessage {
    pub(super) message_type: String,
    pub(super) content: serde_json::Value,
    pub(super) content_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TextPayload {
    text: String,
}

pub(super) fn validate_send_payload(
    payload: &SendMessagePayload,
) -> Result<ValidatedMessage, ContentValidationError> {
    validate_client_message_id(&payload.client_message_id)?;
    validate_conversation_id(payload.conversation_id)?;
    validate_client_sent_at(payload.client_sent_at.as_deref())?;

    match payload.message_type.as_str() {
        TEXT => validate_text_content(payload.content.clone()),
        _ => Err(ContentValidationError::InvalidMessage),
    }
}

fn validate_client_message_id(client_message_id: &str) -> Result<(), ContentValidationError> {
    if client_message_id.len() != 36 || uuid::Uuid::parse_str(client_message_id).is_err() {
        return Err(ContentValidationError::InvalidMessage);
    }
    Ok(())
}

fn validate_conversation_id(conversation_id: u64) -> Result<(), ContentValidationError> {
    if conversation_id == 0 {
        return Err(ContentValidationError::InvalidMessage);
    }
    Ok(())
}

fn validate_client_sent_at(client_sent_at: Option<&str>) -> Result<(), ContentValidationError> {
    if let Some(client_sent_at) = client_sent_at {
        OffsetDateTime::parse(client_sent_at, &Rfc3339)
            .map_err(|_| ContentValidationError::InvalidMessage)?;
    }
    Ok(())
}

fn validate_text_content(
    content: serde_json::Value,
) -> Result<ValidatedMessage, ContentValidationError> {
    let content = serde_json::from_value::<TextPayload>(content)
        .map_err(|_| ContentValidationError::InvalidMessage)?;
    if content.text.trim().is_empty() || content.text.chars().count() > MAX_TEXT_MESSAGE_CHARS {
        return Err(ContentValidationError::InvalidMessage);
    }

    let content = serde_json::json!({ "text": content.text });
    let content_hash = content_hash(&content);
    Ok(ValidatedMessage {
        message_type: TEXT.to_string(),
        content,
        content_hash,
    })
}

fn content_hash(content: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec(content).expect("normalized message content should serialize");
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
#[path = "content_tests.rs"]
mod tests;
