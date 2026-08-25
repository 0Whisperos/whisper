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

    #[allow(dead_code)]
    pub(crate) async fn send_to_connection(
        &self,
        user_id: u64,
        connection_id: &str,
        message: Message,
    ) -> SendToConnectionResult {
        let Some(connection) = self.get(user_id) else {
            return SendToConnectionResult::NoSuchConnection;
        };
        if connection.connection_id != connection_id {
            return SendToConnectionResult::ConnectionIdMismatch;
        }
        match connection.sender.send(message).await {
            Ok(()) => SendToConnectionResult::Sent,
            Err(_) => SendToConnectionResult::Closed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_get_returns_registered_connection() {
        // 测试目标：验证认证后的连接会被注册到本机连接表，并可按用户 ID 读取。
        // 构造方法：创建 ConnectionRegistry 和一条测试 ActiveConnection，然后调用 insert 与 get。
        // 输入数据：user_id=20001，connection_id="connection-1"。
        // 预期行为：get(20001) 返回同一条连接的 connection_id 和 sender。
        let registry = ConnectionRegistry::new();
        let connection = test_connection(20001, "connection-1");

        registry.insert(connection);
        let stored = registry.get(20001).expect("connection should exist");

        assert_eq!(stored.user_id, 20001);
        assert_eq!(stored.connection_id, "connection-1");
    }

    #[test]
    fn insert_replaces_existing_connection_for_same_user() {
        // 测试目标：验证单用户单连接语义下，同一用户的新连接会覆盖旧连接。
        // 构造方法：向同一个 ConnectionRegistry 连续插入同一 user_id 的两条连接。
        // 输入数据：user_id=20001，旧 connection_id="old"，新 connection_id="new"。
        // 预期行为：第二次 insert 返回旧连接，随后 get 只能读取到新连接。
        let registry = ConnectionRegistry::new();

        registry.insert(test_connection(20001, "old"));
        let replaced = registry
            .insert(test_connection(20001, "new"))
            .expect("old connection should be replaced");
        let stored = registry.get(20001).expect("new connection should exist");

        assert_eq!(replaced.connection_id, "old");
        assert_eq!(stored.connection_id, "new");
    }

    #[test]
    fn remove_if_match_removes_matching_connection() {
        // 测试目标：验证断开清理时，connection_id 匹配会移除当前连接。
        // 构造方法：注册一条连接后使用相同 connection_id 调用 remove_if_match。
        // 输入数据：user_id=20001，connection_id="connection-1"。
        // 预期行为：remove_if_match 返回被移除连接，后续 get 返回 None。
        let registry = ConnectionRegistry::new();

        registry.insert(test_connection(20001, "connection-1"));
        let removed = registry
            .remove_if_match(20001, "connection-1")
            .expect("matching connection should be removed");

        assert_eq!(removed.connection_id, "connection-1");
        assert!(registry.get(20001).is_none());
    }

    #[test]
    fn remove_if_match_skips_mismatched_connection() {
        // 测试目标：验证旧连接迟到断开时，不能删除同一用户的新连接。
        // 构造方法：注册新连接后，使用旧 connection_id 调用 remove_if_match。
        // 输入数据：当前 connection_id="new"，待清理 connection_id="old"。
        // 预期行为：remove_if_match 返回 None，registry 中仍保留新连接。
        let registry = ConnectionRegistry::new();

        registry.insert(test_connection(20001, "new"));
        let removed = registry.remove_if_match(20001, "old");
        let stored = registry.get(20001).expect("new connection should remain");

        assert!(removed.is_none());
        assert_eq!(stored.connection_id, "new");
    }

    #[test]
    fn replace_if_match_restores_connection_when_expected_connection_is_current() {
        // 测试目标：验证新连接初始化失败时，可以在 connection_id 仍匹配的前提下恢复旧连接。
        // 构造方法：先注册 current 连接，再用 replace_if_match 条件替换成 replacement。
        // 输入数据：user_id=20001，当前 connection_id="current"，恢复 connection_id="replacement"。
        // 预期行为：replace_if_match 返回 true，registry 中保存 replacement 连接。
        let registry = ConnectionRegistry::new();

        registry.insert(test_connection(20001, "current"));
        let replaced = registry.replace_if_match(
            20001,
            "current",
            test_connection(20001, "replacement"),
        );
        let stored = registry.get(20001).expect("replacement should exist");

        assert!(replaced);
        assert_eq!(stored.connection_id, "replacement");
    }

    #[test]
    fn replace_if_match_skips_when_expected_connection_is_stale() {
        // 测试目标：验证条件恢复不会覆盖同一用户已经建立的更新连接。
        // 构造方法：registry 中保存 newer 连接，然后用 stale connection_id 尝试恢复 replacement。
        // 输入数据：当前 connection_id="newer"，待匹配 connection_id="stale"。
        // 预期行为：replace_if_match 返回 false，registry 中仍保存 newer 连接。
        let registry = ConnectionRegistry::new();

        registry.insert(test_connection(20001, "newer"));
        let replaced = registry.replace_if_match(
            20001,
            "stale",
            test_connection(20001, "replacement"),
        );
        let stored = registry.get(20001).expect("newer connection should remain");

        assert!(!replaced);
        assert_eq!(stored.connection_id, "newer");
    }

    #[tokio::test]
    async fn send_to_connection_delivers_message_when_connection_id_matches() {
        // 测试目标：验证业务路径可以通过 registry 中保存的 sender 向连接投递消息。
        // 构造方法：注册一条携带 mpsc sender 的连接，然后使用匹配的 connection_id 投递消息。
        // 输入数据：user_id=20001，connection_id="connection-1"，Message::Text("hello")。
        // 预期行为：投递结果为 Sent，且对应 receiver 收到同一条文本消息。
        let registry = ConnectionRegistry::new();
        let (sender, mut receiver) = mpsc::channel(1);
        registry.insert(ActiveConnection {
            user_id: 20001,
            connection_id: "connection-1".to_string(),
            connected_at: OffsetDateTime::now_utc(),
            access_token_expires_at: OffsetDateTime::now_utc(),
            sender,
        });

        let result = registry
            .send_to_connection(20001, "connection-1", Message::Text("hello".into()))
            .await;

        assert_eq!(result, SendToConnectionResult::Sent);
        assert_eq!(receiver.recv().await, Some(Message::Text("hello".into())));
    }

    #[tokio::test]
    async fn send_to_connection_rejects_mismatched_connection_id() {
        // 测试目标：验证投递时必须匹配 connection_id，避免快速重连窗口误投给新连接。
        // 构造方法：注册当前连接后，使用旧 connection_id 调用 send_to_connection。
        // 输入数据：当前 connection_id="new"，待投递 connection_id="old"。
        // 预期行为：返回 ConnectionIdMismatch，receiver 不会收到消息。
        let registry = ConnectionRegistry::new();
        let (sender, mut receiver) = mpsc::channel(1);
        registry.insert(ActiveConnection {
            user_id: 20001,
            connection_id: "new".to_string(),
            connected_at: OffsetDateTime::now_utc(),
            access_token_expires_at: OffsetDateTime::now_utc(),
            sender,
        });

        let result = registry
            .send_to_connection(20001, "old", Message::Text("hello".into()))
            .await;

        assert_eq!(result, SendToConnectionResult::ConnectionIdMismatch);
        assert!(receiver.try_recv().is_err());
    }

    #[tokio::test]
    async fn send_to_connection_reports_missing_connection() {
        // 测试目标：验证没有本机连接时，投递入口不会把缺失连接伪装成成功。
        // 构造方法：创建空的 ConnectionRegistry，直接调用 send_to_connection。
        // 输入数据：user_id=20001，connection_id="connection-1"。
        // 预期行为：返回 NoSuchConnection。
        let registry = ConnectionRegistry::new();

        let result = registry
            .send_to_connection(20001, "connection-1", Message::Text("hello".into()))
            .await;

        assert_eq!(result, SendToConnectionResult::NoSuchConnection);
    }

    fn test_connection(user_id: u64, connection_id: &str) -> ActiveConnection {
        let (sender, _receiver) = mpsc::channel(1);
        ActiveConnection {
            user_id,
            connection_id: connection_id.to_string(),
            connected_at: OffsetDateTime::now_utc(),
            access_token_expires_at: OffsetDateTime::now_utc(),
            sender,
        }
    }
}
