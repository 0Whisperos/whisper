use std::sync::Arc;
use axum::extract::ws::WebSocket;
use crate::auth;
use crate::config::Config;
use crate::presence::PresenceManager;

pub(crate) async fn handle_socket(socket: WebSocket, config: Arc<Config>, presence: Arc<PresenceManager>) {
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
    let mut _socket = authenticated.socket;
    if let Err(error) = presence.update_presence(
            user_id,
            &connection_id,
            &config.node_config.node_id,
            &authenticated.access_token_expires_at.to_string(),
        )
        .await
    {
        tracing::warn!(%error, user_id, "failed to update presence");
    }
    //TODO 管理连接
}
