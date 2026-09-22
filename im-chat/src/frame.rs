use crate::error::{Error, Result};
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Frame<T> {
    #[serde(rename = "type")]
    pub(crate) frame_type: String,
    pub(crate) request_id: String,
    pub(crate) payload: T,
}

impl<T> Frame<T> {
    pub(crate) fn new(frame_type: String, request_id: String, payload: T) -> Self {
        Self {
            frame_type,
            request_id,
            payload,
        }
    }
}

/// Server-initiated messages have no corresponding client request identifier.
#[derive(Debug, Serialize)]
pub(crate) struct PushFrame<T> {
    #[serde(rename = "type")]
    frame_type: String,
    payload: T,
}

impl<T> PushFrame<T> {
    pub(crate) fn new(frame_type: impl Into<String>, payload: T) -> Self {
        Self {
            frame_type: frame_type.into(),
            payload,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FailedPayload {
    pub(crate) error_code: &'static str,
    pub(crate) message: &'static str,
}

pub(crate) fn to_text<T>(frame: &Frame<T>) -> Result<String>
where
    T: Serialize,
{
    serde_json::to_string(frame).map_err(|source| Error::Serialize { source })
}

pub(crate) async fn send<T>(socket: &mut WebSocket, frame: &Frame<T>) -> Result<()>
where
    T: Serialize,
{
    let text = to_text(frame)?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|source| Error::WebSocketSend { source })?;
    Ok(())
}

pub(crate) async fn close(socket: &mut WebSocket, code: u16, reason: impl Into<Utf8Bytes>) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    if let Err(err) = socket.send(Message::Close(Some(frame))).await {
        tracing::debug!(%err, "failed to send close frame");
    }
}

#[cfg(test)]
#[path = "frame_tests.rs"]
mod tests;
