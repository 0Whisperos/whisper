//! Authenticated node-to-node HTTP push protocol.

mod auth;
pub(crate) mod client;
mod protocol;
mod receiver;

pub(crate) use auth::{sign, verify_signature};
pub(crate) use protocol::{
    CURSOR_PATH, EnqueueStatus, FRIEND_REQUEST_PATH, ForwardMessageRequest,
    MESSAGE_PATH, NotifyCursorRequest, NotifyFriendRequest,
};
pub(crate) use receiver::{forward_message, notify_cursor, notify_friend_request};
