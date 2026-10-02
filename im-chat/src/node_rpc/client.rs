//! Outbound authenticated HTTP calls to another im-chat node.

use super::{
    CURSOR_PATH, EnqueueStatus, ForwardMessageRequest, MESSAGE_PATH, NotifyCursorRequest, sign,
};
use crate::presence::PresenceManager;
use bytes::Bytes;
use http::{Request, StatusCode, Uri};
use http_body_util::{BodyExt, Full};
use hyper_util::client::legacy::{Client, connect::HttpConnector};
use hyper_util::rt::TokioExecutor;
use serde::Serialize;
use std::{sync::Arc, time::Duration};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
const RETRY_DELAY: Duration = Duration::from_millis(100);

#[derive(Clone)]
pub(crate) struct NodeRpcClient {
    presence: Arc<PresenceManager>,
    node_id: String,
    rpc_secret: String,
    client: Client<HttpConnector, Full<Bytes>>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum NodeRpcClientError {
    #[error("node address lookup failed")]
    AddressLookup(#[source] redis::RedisError),
    #[error("target node address is unavailable")]
    MissingAddress,
    #[error("target node address is invalid")]
    InvalidAddress,
    #[error("node request serialization failed")]
    Serialize(#[source] serde_json::Error),
    #[error("node response is invalid")]
    InvalidResponse,
    #[error("node request timed out")]
    Timeout,
    #[error("node transport failed")]
    Transport,
    #[error("node returned HTTP {0}")]
    Http(u16),
}

impl NodeRpcClient {
    pub(crate) fn new(presence: Arc<PresenceManager>, node_id: String, rpc_secret: String) -> Self {
        Self {
            presence,
            node_id,
            rpc_secret,
            client: Client::builder(TokioExecutor::new()).build(HttpConnector::new()),
        }
    }

    pub(crate) async fn forward_message(
        &self,
        target_node_id: &str,
        request: ForwardMessageRequest,
    ) -> Result<EnqueueStatus, NodeRpcClientError> {
        self.send(target_node_id, MESSAGE_PATH, &request).await
    }

    pub(crate) async fn notify_cursor(
        &self,
        target_node_id: &str,
        request: NotifyCursorRequest,
    ) -> Result<EnqueueStatus, NodeRpcClientError> {
        self.send(target_node_id, CURSOR_PATH, &request).await
    }

    async fn send<T: Serialize>(
        &self,
        target_node_id: &str,
        path: &str,
        payload: &T,
    ) -> Result<EnqueueStatus, NodeRpcClientError> {
        let addr = self
            .presence
            .read_node_rpc_addr(target_node_id)
            .await
            .map_err(NodeRpcClientError::AddressLookup)?
            .ok_or(NodeRpcClientError::MissingAddress)?;
        self.send_to_addr(&addr, path, payload).await
    }

    async fn send_to_addr<T: Serialize>(
        &self,
        rpc_addr: &str,
        path: &str,
        payload: &T,
    ) -> Result<EnqueueStatus, NodeRpcClientError> {
        let uri = remote_uri(rpc_addr, path).ok_or(NodeRpcClientError::InvalidAddress)?;
        let body = serde_json::to_vec(payload).map_err(NodeRpcClientError::Serialize)?;
        for attempt in 0..2 {
            let timestamp = time::OffsetDateTime::now_utc().unix_timestamp().to_string();
            let signature = sign(
                &self.rpc_secret,
                &self.node_id,
                "POST",
                path,
                &timestamp,
                &body,
            );
            let request = Request::builder()
                .method("POST")
                .uri(uri.clone())
                .header("content-type", "application/json")
                .header("X-Whisper-Node-Id", &self.node_id)
                .header("X-Whisper-Timestamp", timestamp)
                .header("X-Whisper-Signature", signature)
                .body(Full::new(Bytes::copy_from_slice(&body)))
                .map_err(|_| NodeRpcClientError::InvalidAddress)?;
            let deadline = tokio::time::Instant::now() + REQUEST_TIMEOUT;
            match tokio::time::timeout_at(deadline, self.client.request(request)).await {
                Ok(Ok(response)) if response.status() == StatusCode::OK => {
                    match tokio::time::timeout_at(deadline, response.into_body().collect()).await {
                        Ok(Ok(body)) => {
                            return serde_json::from_slice(&body.to_bytes())
                                .map_err(|_| NodeRpcClientError::InvalidResponse);
                        }
                        Ok(Err(_)) if attempt == 0 => {}
                        Ok(Err(_)) => return Err(NodeRpcClientError::Transport),
                        Err(_) if attempt == 0 => {}
                        Err(_) => return Err(NodeRpcClientError::Timeout),
                    }
                }
                Ok(Ok(response)) if response.status().is_server_error() && attempt == 0 => {}
                Ok(Ok(response)) => {
                    return Err(NodeRpcClientError::Http(response.status().as_u16()));
                }
                Ok(Err(_)) | Err(_) if attempt == 0 => {}
                Ok(Err(_)) => return Err(NodeRpcClientError::Transport),
                Err(_) => return Err(NodeRpcClientError::Timeout),
            }
            tokio::time::sleep(RETRY_DELAY).await;
        }
        Err(NodeRpcClientError::Transport)
    }
}

fn remote_uri(rpc_addr: &str, path: &str) -> Option<Uri> {
    let addr = rpc_addr.trim_end_matches('/');
    let url = if addr.starts_with("http://") {
        format!("{addr}{path}")
    } else if !addr.contains("://") {
        format!("http://{addr}{path}")
    } else {
        return None;
    };
    let uri: Uri = url.parse().ok()?;
    if uri.scheme_str() != Some("http") || uri.authority().is_none() || uri.path() != path {
        return None;
    }
    Some(uri)
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
