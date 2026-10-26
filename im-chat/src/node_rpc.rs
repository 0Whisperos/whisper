//! Authenticated node-to-node HTTP push protocol.

mod auth;
pub(crate) mod client;
mod protocol;
mod receiver;

pub(crate) use auth::{sign, verify_signature};
pub(crate) use protocol::{
    CURSOR_PATH, EnqueueStatus, FRIEND_REQUEST_PATH, ForwardMessageRequest, ForwardRecallRequest,
    MESSAGE_PATH, NotifyCursorRequest, NotifyFriendRequest, RECALL_PATH,
};
pub(crate) use receiver::{forward_message, forward_recall, notify_cursor, notify_friend_request};
