use super::environment::TestServer;
use anyhow::{Context, Result, bail, ensure};
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde_json::{Value, json};
use std::time::Duration;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, timeout_at};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub(super) struct Client {
    outgoing: mpsc::UnboundedSender<Message>,
    task: JoinHandle<()>,
    frames: mpsc::UnboundedReceiver<Result<Value>>,
}

impl Client {
    pub(super) async fn connect(
        server: &mut TestServer,
        user_id: u64,
        secret: &str,
    ) -> Result<Self> {
        let deadline = Instant::now() + Duration::from_secs(30);
        let (mut socket, _) = loop {
            server.check_running()?;
            match connect_async(&server.ws_url).await {
                Ok(connected) => break connected,
                Err(_) if Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(error) => return Err(error).context("connect to test im-chat"),
            }
        };
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let token = encode(
            &Header::default(),
            &json!({
                "sub": user_id.to_string(), "typ": "access", "iat": now, "exp": now + 3600,
            }),
            &EncodingKey::from_secret(secret.as_bytes()),
        )?;
        socket
            .send(Message::Text(
                json!({
                    "type": "auth", "request_id": "cdc-auth", "payload": { "access_token": token },
                })
                .to_string()
                .into(),
            ))
            .await?;
        let auth = timeout_at(deadline, socket.next())
            .await?
            .context("socket closed before auth")??;
        let Message::Text(auth) = auth else {
            bail!("expected text auth response")
        };
        let auth: Value = serde_json::from_str(&auth)?;
        ensure!(
            auth["type"] == "auth_ok",
            "test client authentication failed"
        );

        // A heartbeat roundtrip is a readiness barrier: presence and the connection
        // registry must have been installed before application frames are handled.
        socket.send(Message::Text(heartbeat_frame().into())).await?;
        let ready = timeout_at(deadline, socket.next())
            .await?
            .context("socket closed before readiness heartbeat")??;
        let Message::Text(ready) = ready else {
            bail!("expected heartbeat response")
        };
        ensure!(
            serde_json::from_str::<Value>(&ready)?["type"] == "heartbeat_ok",
            "client was not ready"
        );
        let (outgoing, mut outgoing_rx) = mpsc::unbounded_channel();
        let (frames_tx, frames) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if let Err(error) = socket.send(Message::Text(heartbeat_frame().into())).await {
                            let _ = frames_tx.send(Err(error.into()));
                            break;
                        }
                    }
                    outgoing = outgoing_rx.recv() => {
                        let Some(outgoing) = outgoing else { break };
                        if let Err(error) = socket.send(outgoing).await {
                            let _ = frames_tx.send(Err(error.into()));
                            break;
                        }
                    }
                    frame = socket.next() => {
                        let value = match frame {
                            Some(Ok(Message::Text(text))) => serde_json::from_str::<Value>(&text).map_err(Into::into),
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(_)) => continue,
                            Some(Err(error)) => Err(error.into()),
                        };
                        if frames_tx.send(value).is_err() { break; }
                    }
                }
            }
        });
        Ok(Self {
            outgoing,
            task,
            frames,
        })
    }

    pub(super) async fn send_text(
        &mut self,
        conversation: u64,
        client_id: &str,
        text: &str,
    ) -> Result<()> {
        self.outgoing
            .send(Message::Text(
                json!({
                    "type": "send_message", "request_id": client_id,
                    "payload": {
                        "conversation_id": conversation, "client_message_id": client_id,
                        "message_type": "text", "content": { "text": text },
                        "client_sent_at": OffsetDateTime::now_utc().format(&Rfc3339)?,
                    },
                })
                .to_string()
                .into(),
            ))
            .context("test socket writer closed")?;
        Ok(())
    }

    pub(super) async fn receive(&mut self) -> Result<Value> {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let frame = timeout_at(deadline, self.frames.recv())
                .await
                .context("timed out waiting for CDC delivery")?
                .context("test socket closed")??;
            if frame["type"] != "heartbeat_ok" {
                return Ok(frame);
            }
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn heartbeat_frame() -> String {
    json!({ "type": "heartbeat", "request_id": "cdc-heartbeat", "payload": { "sent_at": "cdc-test" } }).to_string()
}
