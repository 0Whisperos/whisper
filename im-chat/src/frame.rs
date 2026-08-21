use axum::extract::ws::{Message, WebSocket};
use serde::{Deserialize, Serialize};
use crate::error::{Error, Result};

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
            payload
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FailedPayload {
    pub(crate) error_code: &'static str,
    pub(crate) message: &'static str,
}

type FailedFrame = Frame<FailedPayload>;

pub(crate) async fn send<T>(socket: &mut WebSocket, frame: &Frame<T>) -> Result<()>
where T: Serialize{
    let text = serde_json::to_string(frame)
        .map_err(|source| Error::Serialize { source })?;
    socket.send(Message::Text(text.into())).await
        .map_err(|source| {Error::WebSocketSend { source }})?;
    Ok(())
}