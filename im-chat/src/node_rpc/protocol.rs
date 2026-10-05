//! Shared request and response shapes for the internal HTTP endpoints.

use crate::connection::SendToConnectionResult;
use crate::message::AcceptedMessage;
use serde::{Deserialize, Serialize};

pub(crate) const MESSAGE_PATH: &str = "/internal/v1/messages/forward";
pub(crate) const CURSOR_PATH: &str = "/internal/v1/cursors/notify";
pub(crate) const FRIEND_REQUEST_PATH: &str = "/internal/v1/friend-requests/notify";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ForwardMessageRequest {
    pub(crate) target_user_id: u64,
    pub(crate) connection_id: String,
    pub(crate) event_id: String,
    pub(crate) message: AcceptedMessage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NotifyCursorRequest {
    pub(crate) target_user_id: u64,
    pub(crate) connection_id: String,
    pub(crate) conversation_id: u64,
    pub(crate) user_id: u64,
    pub(crate) delivered_seq: u64,
    pub(crate) read_seq: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NotifyFriendRequest {
    pub(crate) target_user_id: u64,
    pub(crate) connection_id: String,
    pub(crate) request_id: u64,
    pub(crate) status: FriendRequestStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FriendRequestStatus {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EnqueueStatus {
    Queued,
    NoSuchConnection,
    ConnectionIdMismatch,
    Closed,
    Full,
}

impl From<SendToConnectionResult> for EnqueueStatus {
    fn from(result: SendToConnectionResult) -> Self {
        match result {
            SendToConnectionResult::Sent => Self::Queued,
            SendToConnectionResult::NoSuchConnection => Self::NoSuchConnection,
            SendToConnectionResult::ConnectionIdMismatch => Self::ConnectionIdMismatch,
            SendToConnectionResult::Closed => Self::Closed,
            SendToConnectionResult::Full => Self::Full,
        }
    }
}
