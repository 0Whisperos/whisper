use crate::frame::{self, Frame};
use crate::presence::PresenceManager;
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{Instant, Interval};

pub(crate) const HEARTBEAT: &str = "heartbeat";
pub(crate) const HEARTBEAT_OK: &str = "heartbeat_ok";

const PRESENCE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
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
#[path = "client_tests.rs"]
mod tests;
