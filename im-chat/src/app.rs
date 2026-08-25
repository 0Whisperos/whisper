use std::sync::Arc;
use axum::extract::{State, ws::WebSocketUpgrade};
use axum::response::Response;
use axum::Router;
use axum::routing::get;
use tokio::net::TcpListener;
use crate::{config, handle, heartbeat};
use crate::connection::ConnectionRegistry;
use crate::error::{Error, Result};
use crate::presence::PresenceManager;

#[derive(Clone)]
pub(crate) struct AppState {
    pub config: Arc<config::Config>,
    pub presence: Arc<PresenceManager>,
    pub connections: ConnectionRegistry,
}

pub async fn run() -> Result<()> {
    let config = Arc::new(config::load_config()?);
    let presence = Arc::new(PresenceManager::new(&config.redis_config).map_err(|source| Error::Redis { source })?);
    let connections = ConnectionRegistry::new();
    tracing_subscriber::fmt()
        .with_env_filter(config.logging_config.level.as_str())
        .init();
    let state = AppState{
        config: config.clone(),
        presence: presence.clone(),
        connections: connections.clone(),
    };
    let listen_addr = format!("{}:{}", state.config.server_config.ip, state.config.server_config.port);
    let app = Router::new().route("/ws", get(ws_handler)).with_state(state);
    let listener =
        TcpListener::bind(&listen_addr).await.map_err(|source| Error::BindListener {
            addr: listen_addr,
            source,
        })?;
    presence.register_node(
        &config.node_config.node_id,
        &config.node_config.public_ws_url,
        &config.node_config.rpc_addr,
    )
    .await
    .map_err(|source| Error::Redis { source })?;
    let _heartbeat_handle = heartbeat::spawn(presence.clone(), config.node_config.node_id.clone()).await;
    axum::serve(listener, app).await.map_err(|source| Error::Serve { source })?;
    Ok(())
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    let config = state.config.clone();
    let presence = state.presence.clone();
    let connections = state.connections.clone();
    ws.on_upgrade(|socket| handle::handle_socket(socket, config, presence, connections))
}
