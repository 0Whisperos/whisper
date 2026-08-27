use crate::frame::{self, Frame};
use crate::presence::PresenceManager;
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{Instant, Interval};

pub(crate) const HEARTBEAT: &str = "heartbeat";
pub(crate) const HEARTBEAT_OK: &str = "heartbeat_ok";

const PRESENCE_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
const CLIENT_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct HeartbeatPayload {
    pub(crate) sent_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct HeartbeatOkPayload {
    pub(crate) sent_at: String,
}

#[derive(Debug, PartialEq, Eq)]
enum ClientPresenceRefresh {
    Refreshed,
    AwaitingClientHeartbeat,
    ClientTimedOut,
    PresenceMismatchOrMissing,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ClientFrameHandleResult {
    Continue,
    Stop,
}

pub(crate) struct ClientHeartbeat {
    connected_at: Instant,
    last_seen_at: Option<Instant>,
    timeout: Duration,
    refresh_ticker: Interval,
    write_tx: mpsc::Sender<Message>,
    user_id: u64,
    connection_id: String,
}

impl ClientHeartbeat {
    pub(crate) fn new(
        now: Instant,
        write_tx: mpsc::Sender<Message>,
        user_id: u64,
        connection_id: String,
    ) -> Self {
        Self {
            connected_at: now,
            last_seen_at: None,
            timeout: CLIENT_HEARTBEAT_TIMEOUT,
            refresh_ticker: tokio::time::interval_at(
                now + PRESENCE_REFRESH_INTERVAL,
                PRESENCE_REFRESH_INTERVAL,
            ),
            write_tx,
            user_id,
            connection_id,
        }
    }

    pub(crate) fn mark_received(&mut self, now: Instant) {
        self.last_seen_at = Some(now);
    }

    pub(crate) fn is_expired(&self, now: Instant) -> bool {
        now.duration_since(self.last_seen_at.unwrap_or(self.connected_at)) >= self.timeout
    }

    pub(crate) fn can_refresh_presence(&self, now: Instant) -> bool {
        self.last_seen_at
            .is_some_and(|last_seen_at| now.duration_since(last_seen_at) < self.timeout)
    }

    pub(crate) async fn refresh_presence(&mut self, presence: &PresenceManager) -> bool {
        match self.refresh_presence_tick(presence).await {
            Ok(ClientPresenceRefresh::Refreshed) => {
                tracing::debug!(
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "presence refreshed after client heartbeat check"
                );
                true
            }
            Ok(ClientPresenceRefresh::AwaitingClientHeartbeat) => {
                tracing::debug!(
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "skip presence refresh: waiting for first client heartbeat"
                );
                true
            }
            Ok(ClientPresenceRefresh::ClientTimedOut) => {
                tracing::debug!(
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "stop websocket connection: client heartbeat timed out"
                );
                false
            }
            Ok(ClientPresenceRefresh::PresenceMismatchOrMissing) => {
                tracing::debug!(
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "stop websocket connection: presence connection_id mismatch or key missing"
                );
                false
            }
            Err(error) => {
                tracing::warn!(
                    %error,
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "failed to refresh presence after client heartbeat check"
                );
                false
            }
        }
    }

    async fn refresh_presence_tick(
        &mut self,
        presence: &PresenceManager,
    ) -> Result<ClientPresenceRefresh, redis::RedisError> {
        self.refresh_ticker.tick().await;

        let now = Instant::now();
        if self.is_expired(now) {
            return Ok(ClientPresenceRefresh::ClientTimedOut);
        }

        if !self.can_refresh_presence(now) {
            return Ok(ClientPresenceRefresh::AwaitingClientHeartbeat);
        }

        if presence
            .refresh_presence(self.user_id, &self.connection_id)
            .await?
        {
            Ok(ClientPresenceRefresh::Refreshed)
        } else {
            Ok(ClientPresenceRefresh::PresenceMismatchOrMissing)
        }
    }

    pub(crate) async fn handle_frame(
        &mut self,
        raw_frame: Frame<serde_json::Value>,
    ) -> ClientFrameHandleResult {
        let payload = match serde_json::from_value::<HeartbeatPayload>(raw_frame.payload) {
            Ok(payload) => payload,
            Err(error) => {
                tracing::debug!(
                    %error,
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "ignore invalid heartbeat payload"
                );
                return ClientFrameHandleResult::Continue;
            }
        };

        self.mark_received(Instant::now());
        tracing::debug!(
            user_id = self.user_id,
            connection_id = %self.connection_id,
            client_sent_at = %payload.sent_at,
            "client heartbeat received"
        );

        self.send_heartbeat_response(raw_frame.request_id).await
    }

    async fn send_heartbeat_response(&self, request_id: String) -> ClientFrameHandleResult {
        let response = heartbeat_ok_frame(request_id);
        let text = match frame::to_text(&response) {
            Ok(text) => text,
            Err(error) => {
                tracing::warn!(
                    %error,
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "failed to serialize heartbeat response"
                );
                return ClientFrameHandleResult::Stop;
            }
        };

        match self.write_tx.send(Message::Text(text.into())).await {
            Ok(()) => ClientFrameHandleResult::Continue,
            Err(_) => {
                tracing::debug!(
                    user_id = self.user_id,
                    connection_id = %self.connection_id,
                    "stop websocket connection: heartbeat response writer queue closed"
                );
                ClientFrameHandleResult::Stop
            }
        }
    }
}

pub(crate) fn heartbeat_ok_frame(request_id: String) -> Frame<HeartbeatOkPayload> {
    Frame::new(
        HEARTBEAT_OK.to_string(),
        request_id,
        HeartbeatOkPayload {
            sent_at: time::OffsetDateTime::now_utc().to_string(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn client_heartbeat_is_active_before_timeout() {
        // 测试目标：验证连接建立后未超过超时阈值时，不会被提前视为客户端掉线。
        // 构造方法：创建 ClientHeartbeat，并使用小于 30s 的时间点检查过期状态。
        // 输入数据：初始时间 now，检查时间 now + 29s。
        // 预期行为：is_expired 返回 false。
        let now = Instant::now();
        let (sender, _receiver) = mpsc::channel(1);
        let heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());

        assert!(!heartbeat.is_expired(now + Duration::from_secs(29)));
    }

    #[tokio::test]
    async fn client_heartbeat_expires_at_timeout_boundary() {
        // 测试目标：验证达到 30s 心跳超时边界时，连接会被视为客户端已掉线。
        // 构造方法：创建 ClientHeartbeat，并使用正好等于 30s 的时间点检查过期状态。
        // 输入数据：初始时间 now，检查时间 now + 30s。
        // 预期行为：is_expired 返回 true，后续不会继续刷新 Redis presence。
        let now = Instant::now();
        let (sender, _receiver) = mpsc::channel(1);
        let heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());

        assert!(heartbeat.is_expired(now + Duration::from_secs(30)));
    }

    #[tokio::test]
    async fn presence_refresh_waits_for_first_client_heartbeat() {
        // 测试目标：验证未收到首个客户端心跳时，服务端不会刷新 Redis presence。
        // 构造方法：创建 ClientHeartbeat，并在未调用 mark_received 的情况下检查刷新资格。
        // 输入数据：初始时间 now，检查时间 now + 10s。
        // 预期行为：can_refresh_presence 返回 false，避免未收到 heartbeat 也续期在线状态。
        let now = Instant::now();
        let (sender, _receiver) = mpsc::channel(1);
        let heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());

        assert!(!heartbeat.can_refresh_presence(now + Duration::from_secs(10)));
    }

    #[tokio::test]
    async fn mark_received_extends_client_heartbeat_deadline() {
        // 测试目标：验证收到新的客户端心跳后，会用最新交互时间延长保活窗口。
        // 构造方法：创建 ClientHeartbeat，先推进 20s 标记收到心跳，再从新时间点推进 29s 检查。
        // 输入数据：初始时间 now，新心跳时间 now + 20s，检查时间 now + 49s。
        // 预期行为：is_expired 返回 false。
        let now = Instant::now();
        let (sender, _receiver) = mpsc::channel(1);
        let mut heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());
        let received_at = now + Duration::from_secs(20);

        heartbeat.mark_received(received_at);

        assert!(!heartbeat.is_expired(now + Duration::from_secs(49)));
        assert!(heartbeat.can_refresh_presence(now + Duration::from_secs(49)));
    }

    #[tokio::test]
    async fn handle_frame_records_heartbeat_and_sends_response() {
        // 测试目标：验证心跳模块处理合法 heartbeat 时，会更新连接心跳状态并发送 heartbeat_ok。
        // 构造方法：创建带 mpsc 写队列的 ClientHeartbeat，传入 Frame<serde_json::Value>，再读取队列消息。
        // 输入数据：type="heartbeat"，request_id="req-1"，payload.sent_at="now"。
        // 预期行为：返回 Continue，can_refresh_presence 为 true，队列收到 request_id 原样返回的 heartbeat_ok。
        let now = Instant::now();
        let (sender, mut receiver) = mpsc::channel(1);
        let mut heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());
        let frame = Frame::new(
            HEARTBEAT.to_string(),
            "req-1".to_string(),
            serde_json::json!({ "sent_at": "now" }),
        );

        let result = heartbeat.handle_frame(frame).await;

        assert_eq!(result, ClientFrameHandleResult::Continue);
        assert!(heartbeat.can_refresh_presence(Instant::now()));
        let Some(Message::Text(text)) = receiver.recv().await else {
            panic!("heartbeat response should be text");
        };
        let response: Frame<serde_json::Value> =
            serde_json::from_str(text.as_str()).expect("heartbeat response should be json");

        assert_eq!(response.frame_type, HEARTBEAT_OK);
        assert_eq!(response.request_id, "req-1");
        assert!(
            !response.payload["sent_at"]
                .as_str()
                .unwrap_or_default()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn handle_frame_ignores_invalid_payload_without_refreshing_heartbeat() {
        // 测试目标：验证非法 heartbeat payload 不会刷新客户端心跳状态，也不会关闭连接。
        // 构造方法：创建 ClientHeartbeat，传入缺少 sent_at 的 heartbeat frame，并检查状态和写队列。
        // 输入数据：type="heartbeat"，request_id="req-1"，payload={}。
        // 预期行为：返回 Continue，can_refresh_presence 为 false，写队列没有 heartbeat_ok。
        let now = Instant::now();
        let (sender, mut receiver) = mpsc::channel(1);
        let mut heartbeat = ClientHeartbeat::new(now, sender, 20001, "connection-1".to_string());
        let frame = Frame::new(
            HEARTBEAT.to_string(),
            "req-1".to_string(),
            serde_json::json!({}),
        );

        let result = heartbeat.handle_frame(frame).await;

        assert_eq!(result, ClientFrameHandleResult::Continue);
        assert!(!heartbeat.can_refresh_presence(Instant::now()));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn heartbeat_ok_frame_uses_heartbeat_ok_type_and_request_id() {
        // 测试目标：验证服务端心跳响应帧使用约定的 type，并复用客户端请求的 request_id。
        // 构造方法：调用 heartbeat_ok_frame 构造响应帧，直接检查 Frame 字段。
        // 输入数据：request_id="req-1"。
        // 预期行为：响应 type 为 heartbeat_ok，request_id 保持为 req-1，sent_at 不为空。
        let frame = heartbeat_ok_frame("req-1".to_string());

        assert_eq!(frame.frame_type, HEARTBEAT_OK);
        assert_eq!(frame.request_id, "req-1");
        assert!(!frame.payload.sent_at.is_empty());
    }
}
