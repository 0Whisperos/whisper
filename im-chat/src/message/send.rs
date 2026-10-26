//! Message sending, creation events, and current creation-message snapshots.

mod content;
mod event;
mod handler;
mod reply;
mod snapshot;
mod store;

pub(crate) use event::MessageCreatedEvent;
pub(crate) use handler::ServerAcceptedPayload;
pub(crate) use handler::{
    ATTACHMENT_FORBIDDEN, ATTACHMENT_NOT_READY, CONVERSATION_NOT_FOUND,
    DUPLICATE_CLIENT_MESSAGE_CONFLICT, INTERNAL_ERROR, INVALID_MESSAGE, NOT_CONVERSATION_MEMBER,
    RICH, TEXT,
};
pub(crate) use handler::{
    AcceptedMessage, SEND_MESSAGE, SendMessagePayload, SendMessageReject, handle_frame,
};
pub(crate) use reply::{ReplyTarget, populate_reply};
pub(crate) use snapshot::refresh_message;

#[cfg(test)]
pub(in crate::message) mod test_support {
    pub(in crate::message) use super::store::tests::{
        TestFixture, ensure_schema, insert_uploaded_attachment, test_pool, valid_payload,
    };

    pub(in crate::message) async fn accept_message(
        pool: &sqlx::MySqlPool,
        sender_user_id: u64,
        payload: super::SendMessagePayload,
    ) -> super::AcceptedMessage {
        super::store::accept_message(pool, sender_user_id, payload)
            .await
            .expect("accept fixture message")
    }
}
