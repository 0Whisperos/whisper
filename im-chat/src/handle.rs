use std::sync::Arc;
use axum::extract::ws::WebSocket;
use crate::auth;
use crate::config::Config;

pub(crate) async fn handle_socket(socket: WebSocket, config: Arc<Config>) {
    if let Err(error) = auth::certification(socket, config).await {
        tracing::warn!(%error, "websocket authentication failed");
    }
}
