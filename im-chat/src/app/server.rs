use axum::Router;
use axum::extract::{Json, State, ws::WebSocketUpgrade};
use axum::http::StatusCode;
use axum::middleware;
use axum::response::Response;
use axum::routing::{get, post};

use crate::handle;
use crate::node_rpc::{self, EnqueueStatus, ForwardMessageRequest, NotifyCursorRequest};

use super::AppState;

pub(super) fn build_router(state: AppState) -> Router {
    let internal = Router::new()
        .route(node_rpc::MESSAGE_PATH, post(forward_message))
        .route(node_rpc::CURSOR_PATH, post(notify_cursor))
        .route_layer(middleware::from_fn_with_state(
            state.config.node_config.rpc_secret.clone(),
            node_rpc::verify_signature,
        ));
    Router::new()
        .route("/ws", get(ws_handler))
        .merge(internal)
        .with_state(state)
}

async fn forward_message(
    State(state): State<AppState>,
    Json(request): Json<ForwardMessageRequest>,
) -> Result<Json<EnqueueStatus>, StatusCode> {
    node_rpc::forward_message(&state.connections, request)
        .map(Json)
        .map_err(|error| {
            tracing::warn!(%error, "failed to serialize forwarded message frame");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn notify_cursor(
    State(state): State<AppState>,
    Json(request): Json<NotifyCursorRequest>,
) -> Result<Json<EnqueueStatus>, StatusCode> {
    node_rpc::notify_cursor(&state.connections, request)
        .map(Json)
        .map_err(|error| {
            tracing::warn!(%error, "failed to serialize cursor notification frame");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(|socket| {
        handle::handle_socket(
            socket,
            state.config,
            state.presence,
            state.connections,
            state.mysql_pool,
            state.rpc_client,
        )
    })
}
