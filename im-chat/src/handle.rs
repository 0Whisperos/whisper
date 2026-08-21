use std::sync::Arc;
use axum::extract::ws::WebSocket;
use crate::auth;
use crate::config::Config;

pub(crate) async fn handle_socket(socket: WebSocket, config: Arc<Config>) {
    let authenticated = match auth::certification(socket, config).await {
        Ok(Some(authenticated)) => authenticated,
        Ok(None) => return,
        Err(error) => {
            tracing::warn!(%error, "websocket authentication failed");
            return;
        }
    };
    //TODO 处理连接
}
