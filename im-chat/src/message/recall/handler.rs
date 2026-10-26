use super::store::{self, RecallError};
use crate::frame::{self, Frame};
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use tokio::sync::mpsc;

pub(crate) const RECALL_MESSAGE: &str = "recall_message";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecallPayload {
    message_id: String,
}

#[derive(Serialize)]
struct RejectedPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    error_code: &'static str,
    message: &'static str,
}

pub(crate) async fn handle_frame(
    raw: Frame<serde_json::Value>,
    pool: &MySqlPool,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: &str,
) -> bool {
    let message_id = raw
        .payload
        .get("message_id")
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    let result = match serde_json::from_value::<RecallPayload>(raw.payload) {
        Ok(payload) => store::recall_message(pool, user_id, &payload.message_id).await,
        Err(_) => Err(RecallError::InvalidMessageId),
    };
    let text = match result {
        Ok(message) => frame::to_text(&Frame::new(
            "recall_message_accepted".to_owned(),
            raw.request_id,
            message,
        )),
        Err(error) => {
            let (error_code, message) = error.rejection();
            tracing::debug!(%error, user_id, %connection_id, "recall request rejected");
            frame::to_text(&Frame::new(
                "recall_message_rejected".to_owned(),
                raw.request_id,
                RejectedPayload {
                    message_id,
                    error_code,
                    message,
                },
            ))
        }
    };
    match text {
        Ok(text) => write_tx.send(Message::Text(text.into())).await.is_ok(),
        Err(error) => {
            tracing::warn!(%error, user_id, %connection_id, "failed to serialize recall response");
            false
        }
    }
}

#[cfg(test)]
#[path = "handler_tests.rs"]
mod tests;
