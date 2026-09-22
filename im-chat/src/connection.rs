use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use axum::extract::ws::Message;
use time::OffsetDateTime;
use tokio::sync::mpsc;

pub(crate) type SocketWriteSender = mpsc::Sender<Message>;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SendToConnectionResult {
    Sent,
    NoSuchConnection,
    ConnectionIdMismatch,
    Closed,
    Full,
}

#[derive(Clone)]
pub(crate) struct ActiveConnection {
    pub(crate) user_id: u64,
    pub(crate) connection_id: String,
    pub(crate) connected_at: OffsetDateTime,
    pub(crate) access_token_expires_at: OffsetDateTime,
    pub(crate) sender: SocketWriteSender,
}

#[derive(Clone, Default)]
pub(crate) struct ConnectionRegistry {
    connections: Arc<RwLock<HashMap<u64, ActiveConnection>>>,
}

impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn insert(&self, connection: ActiveConnection) -> Option<ActiveConnection> {
        self.connections
            .write()
            .expect("connection registry lock poisoned")
            .insert(connection.user_id, connection)
    }

    pub(crate) fn get(&self, user_id: u64) -> Option<ActiveConnection> {
        self.connections
            .read()
            .expect("connection registry lock poisoned")
            .get(&user_id)
            .cloned()
    }

    pub(crate) fn remove_if_match(
        &self,
        user_id: u64,
        connection_id: &str,
    ) -> Option<ActiveConnection> {
        let mut connections = self
            .connections
            .write()
            .expect("connection registry lock poisoned");
        let should_remove = connections
            .get(&user_id)
            .is_some_and(|connection| connection.connection_id == connection_id);
        if should_remove {
            connections.remove(&user_id)
        } else {
            None
        }
    }

    pub(crate) fn replace_if_match(
        &self,
        user_id: u64,
        connection_id: &str,
        replacement: ActiveConnection,
    ) -> bool {
        if replacement.user_id != user_id {
            return false;
        }

        let mut connections = self
            .connections
            .write()
            .expect("connection registry lock poisoned");
        let should_replace = connections
            .get(&user_id)
            .is_some_and(|connection| connection.connection_id == connection_id);
        if should_replace {
            connections.insert(user_id, replacement);
            true
        } else {
            false
        }
    }

    pub(crate) fn send_to_connection(
        &self,
        user_id: u64,
        connection_id: &str,
        message: Message,
    ) -> SendToConnectionResult {
        let connections = self
            .connections
            .read()
            .expect("connection registry lock poisoned");
        let Some(connection) = connections.get(&user_id) else {
            return SendToConnectionResult::NoSuchConnection;
        };
        if connection.connection_id != connection_id {
            return SendToConnectionResult::ConnectionIdMismatch;
        }
        // Keep the read lock through the nonblocking enqueue so a reconnect cannot
        // replace this connection between checking its identifier and enqueueing.
        match connection.sender.try_send(message) {
            Ok(()) => SendToConnectionResult::Sent,
            Err(mpsc::error::TrySendError::Closed(_)) => SendToConnectionResult::Closed,
            Err(mpsc::error::TrySendError::Full(_)) => SendToConnectionResult::Full,
        }
    }
}

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;
