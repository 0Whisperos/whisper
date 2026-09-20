use axum::Router;
use axum::extract::{State, ws::WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;

use crate::handle;

use super::AppState;

pub(super) fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state)
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(|socket| {
        handle::handle_socket(
            socket,
            state.config,
            state.presence,
            state.connections,
            state.mysql_pool,
        )
    })
}
