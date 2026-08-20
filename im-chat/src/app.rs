use std::sync::Arc;
use axum::extract::{State, ws::WebSocketUpgrade};
use axum::response::Response;
use axum::Router;
use axum::routing::get;
use tokio::net::TcpListener;
use crate::{config, handle};
use crate::error::{Error, Result};

#[derive(Clone)]
pub(crate) struct AppState {
    pub config: Arc<config::Config>,
}

pub async fn run() -> Result<()> {
    let config = config::load_config()?;
    tracing_subscriber::fmt()
        .with_env_filter(config.logging_config.level.as_str())
        .init();
    let state = AppState{config: Arc::new(config)};
    let listen_addr = format!("{}:{}", state.config.server_config.ip, state.config.server_config.port);
    let app = Router::new().route("/ws", get(ws_handler)).with_state(state);
    let listener =
        TcpListener::bind(&listen_addr).await.map_err(|source| Error::BindListener {
            addr: listen_addr,
            source,
        })?;
    axum::serve(listener, app).await.map_err(|source| Error::Serve { source })?;
    Ok(())
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    let config = state.config.clone();
    ws.on_upgrade(|socket| handle::handle_socket(socket, config))
}
