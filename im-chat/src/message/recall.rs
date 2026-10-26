//! Message recall commands and their durable notification event.

pub(crate) mod event;
mod handler;
mod store;

pub(crate) use handler::{RECALL_MESSAGE, handle_frame};
