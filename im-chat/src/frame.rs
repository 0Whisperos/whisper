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
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn to_text_serializes_frame_with_wire_type_field() {
        // 测试目标：验证 Frame 序列化时使用 WebSocket 线协议约定的 type 字段。
        // 构造方法：构造一个带 request_id 和简单 payload 的 Frame，然后调用 to_text。
        // 输入数据：type="heartbeat_ok"，request_id="req-1"，payload={ "sent_at": "now" }。
        // 预期行为：序列化 JSON 包含 type、request_id 和 payload 三个协议字段。
        let frame = Frame::new(
            "heartbeat_ok".to_string(),
            "req-1".to_string(),
            json!({ "sent_at": "now" }),
        );

        let text = to_text(&frame).expect("frame should serialize");
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("serialized frame should be json");

        assert_eq!(value["type"], "heartbeat_ok");
        assert_eq!(value["request_id"], "req-1");
        assert_eq!(value["payload"]["sent_at"], "now");
    }
}
