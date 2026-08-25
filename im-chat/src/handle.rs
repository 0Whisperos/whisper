use crate::auth;
use crate::config::Config;
use crate::connection::{ActiveConnection, ConnectionRegistry};
use crate::presence::PresenceManager;
use axum::extract::ws::{Message, WebSocket};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::sync::{mpsc, oneshot};

const SOCKET_WRITE_QUEUE_BUFFER_SIZE: usize = 64;
const PRESENCE_REFRESH_INTERVAL: Duration = Duration::from_secs(10);

pub(crate) async fn handle_socket(
    socket: WebSocket,
    config: Arc<Config>,
    presence: Arc<PresenceManager>,
    connections: ConnectionRegistry,
) {
    let authenticated = match auth::certification(socket, config.clone()).await {
        Ok(Some(authenticated)) => authenticated,
        Ok(None) => return,
        Err(error) => {
            tracing::warn!(%error, "websocket authentication failed");
            return;
        }
    };
    let user_id = authenticated.user_id;
    let connection_id = authenticated.connection_id.clone();
    let access_token_expires_at = authenticated.access_token_expires_at;
    let (socket_write, socket_read) = authenticated.socket.split();
    let (write_tx, writer_done) = spawn_socket_writer(socket_write, &connection_id);

    let replaced_connection = register_connection(
        &connections,
        user_id,
        &connection_id,
        access_token_expires_at,
        write_tx,
    );

    if let Err(error) = presence
        .register_presence(
            user_id,
            &connection_id,
            &config.node_config.node_id,
            &access_token_expires_at.to_string(),
        )
        .await
    {
        tracing::warn!(%error, user_id, "failed to register presence");
        // TODO: 后续补充单用户重连时的踢人逻辑，显式通知或关闭被替换的旧连接。
        if let Some(replaced_connection) = replaced_connection {
            if !connections.replace_if_match(user_id, &connection_id, replaced_connection) {
                tracing::debug!(
                    user_id,
                    %connection_id,
                    "skip restoring previous connection: current connection changed"
                );
            }
        } else {
            connections.remove_if_match(user_id, &connection_id);
        }
        return;
    }

    run_connection_loop(
        socket_read,
        writer_done,
        user_id,
        &connection_id,
        access_token_expires_at,
        presence.clone(),
    )
    .await;
    cleanup_connection(&connections, presence, user_id, &connection_id).await;
}

fn spawn_socket_writer(
    mut socket_write: SplitSink<WebSocket, Message>,
    connection_id: &str,
) -> (mpsc::Sender<Message>, oneshot::Receiver<()>) {
    let (write_tx, mut write_rx) = mpsc::channel::<Message>(SOCKET_WRITE_QUEUE_BUFFER_SIZE);
    let (writer_done_tx, writer_done_rx) = oneshot::channel();
    let connection_id = connection_id.to_owned();

    tokio::spawn(async move {
        while let Some(message) = write_rx.recv().await {
            if let Err(error) = socket_write.send(message).await {
                tracing::debug!(
                    %error,
                    %connection_id,
                    "websocket writer stopped after send failure"
                );
                break;
            }
        }
        let _ = writer_done_tx.send(());
    });

    (write_tx, writer_done_rx)
}

fn register_connection(
    connections: &ConnectionRegistry,
    user_id: u64,
    connection_id: &str,
    access_token_expires_at: OffsetDateTime,
    write_tx: mpsc::Sender<Message>,
) -> Option<ActiveConnection> {
    let replaced = connections.insert(ActiveConnection {
        user_id,
        connection_id: connection_id.to_string(),
        connected_at: OffsetDateTime::now_utc(),
        access_token_expires_at,
        sender: write_tx,
    });
    if let Some(replaced) = &replaced {
        tracing::debug!(
            user_id,
            old_connection_id = %replaced.connection_id,
            new_connection_id = %connection_id,
            "replaced existing websocket connection"
        );
    }
    if let Some(current) = connections.get(user_id) {
        tracing::debug!(
            user_id,
            connection_id = %current.connection_id,
            connected_at = %current.connected_at,
            access_token_expires_at = %current.access_token_expires_at,
            write_queue_capacity = current.sender.capacity(),
            "registered websocket connection"
        );
    }

    replaced
}

async fn run_connection_loop(
    mut socket_read: SplitStream<WebSocket>,
    mut writer_done: oneshot::Receiver<()>,
    user_id: u64,
    connection_id: &str,
    access_token_expires_at: OffsetDateTime,
    presence: Arc<PresenceManager>,
) {
    // TODO: 当前循环先搭建连接生命周期骨架，后续补充 token 刷新通知、客户端消息分发和关闭原因。
    let mut presence_refresh = tokio::time::interval(PRESENCE_REFRESH_INTERVAL);
    presence_refresh.tick().await;
    loop {
        tokio::select! {
            _ = presence_refresh.tick() => {
                match presence.refresh_presence(user_id, connection_id).await {
                    Ok(true) => {
                        tracing::debug!(user_id, %connection_id, "presence refreshed");
                    }
                    Ok(false) => {
                        tracing::debug!(
                            user_id,
                            %connection_id,
                            "stop websocket connection: presence connection_id mismatch or key missing"
                        );
                        break;
                    }
                    Err(error) => {
                        tracing::warn!(%error, user_id, %connection_id, "failed to refresh presence");
                        break;
                    }
                }
            }
            _ = sleep_until(access_token_expires_at) => {
                tracing::debug!(user_id, %connection_id, "stop websocket connection: access token expired");
                break;
            }
            _ = &mut writer_done => {
                tracing::debug!(user_id, %connection_id, "stop websocket connection: writer stopped");
                break;
            }
            maybe_message = socket_read.next() => {
                let Some(result) = maybe_message else {
                    break;
                };
                match result {
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Text(_)) | Ok(Message::Binary(_)) => {
                        tracing::debug!(user_id, %connection_id, "received websocket frame after authentication");
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                    Err(error) => {
                        tracing::debug!(%error, user_id, %connection_id, "websocket reader stopped after receive failure");
                        break;
                    }
                }
            }
        }
    }
}

async fn cleanup_connection(
    connections: &ConnectionRegistry,
    presence: Arc<PresenceManager>,
    user_id: u64,
    connection_id: &str,
) {
    if connections
        .remove_if_match(user_id, connection_id)
        .is_some()
    {
        if let Err(error) = presence.leave_presence(user_id, connection_id).await {
            tracing::warn!(%error, user_id, %connection_id, "failed to leave presence");
        }
    } else {
        tracing::debug!(
            user_id,
            %connection_id,
            "skip connection cleanup: connection_id mismatch or already removed"
        );
    }
}

async fn sleep_until(deadline: OffsetDateTime) {
    let now = OffsetDateTime::now_utc();
    if deadline <= now {
        return;
    }
    let duration = match (deadline - now).try_into() {
        Ok(duration) => duration,
        Err(_) => return,
    };
    tokio::time::sleep(duration).await;
}
