use anyhow::{Context, Result, ensure};
use serde_json::Value;
use sqlx::MySqlPool;
use uuid::Uuid;

pub(super) struct Fixture {
    pub(super) pool: MySqlPool,
    pub(super) conversation: u64,
    pub(super) alice: u64,
    pub(super) bob: u64,
}

impl Fixture {
    pub(super) async fn create(pool: MySqlPool) -> Result<Self> {
        let mut tx = pool.begin().await?;
        let mut users = Vec::new();
        for nickname in ["cdc-alice", "cdc-bob"] {
            let account = format!("{:012}", Uuid::new_v4().as_u128() % 1_000_000_000_000);
            let row = sqlx::query(
                "INSERT INTO users (account, password_hash, nickname, created_at, updated_at) \
                 VALUES (?, 'cdc-test-not-a-login-password', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
            ).bind(account).bind(nickname).execute(&mut *tx).await?;
            users.push(row.last_insert_id());
        }
        let conversation = sqlx::query(
            "INSERT INTO conversations (conversation_type, last_seq, created_at, updated_at) \
             VALUES ('direct', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        )
        .execute(&mut *tx)
        .await?
        .last_insert_id();
        for &user in &users {
            sqlx::query(
                "INSERT INTO conversation_members (conversation_id, user_id, member_state, joined_at) \
                 VALUES (?, ?, 'active', UTC_TIMESTAMP(6))",
            ).bind(conversation).bind(user).execute(&mut *tx).await?;
            sqlx::query(
                "INSERT INTO conversation_member_cursors (conversation_id, user_id) VALUES (?, ?)",
            )
            .bind(conversation)
            .bind(user)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(Self {
            pool,
            conversation,
            alice: users[0],
            bob: users[1],
        })
    }

    pub(super) async fn stored_event(&self, message_id: &str) -> Result<Value> {
        let (event_id, payload): (String, String) = sqlx::query_as(
            "SELECT id, CAST(payload AS CHAR) FROM outbox_events \
             WHERE aggregateid = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message.message_id')) = ?",
        ).bind(self.conversation.to_string()).bind(message_id).fetch_one(&self.pool).await?;
        let event: Value = serde_json::from_str(&payload)?;
        ensure!(
            event["event_id"] == event_id,
            "outbox id and envelope event_id differ"
        );
        let stored: (String, u64, u64, String, String) = sqlx::query_as(
            "SELECT message_id, conversation_seq, sender_user_id, client_message_id, CAST(content AS CHAR) \
             FROM messages WHERE message_id = ?",
        ).bind(message_id).fetch_one(&self.pool).await?;
        ensure!(
            event["message"]["message_id"] == stored.0,
            "message id differs from stored fact"
        );
        ensure!(
            event["message"]["conversation_seq"] == stored.1,
            "message sequence differs from stored fact"
        );
        ensure!(
            event["message"]["sender_user_id"] == stored.2,
            "message sender differs from stored fact"
        );
        ensure!(
            event["message"]["client_message_id"] == stored.3,
            "client id differs from stored fact"
        );
        ensure!(
            event["message"]["content"] == serde_json::from_str::<Value>(&stored.4)?,
            "message content differs from stored fact"
        );
        Ok(event)
    }

    pub(super) async fn rollback_event(&self, template: &Value) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let mut event = template.clone();
        event["event_id"] = id.clone().into();
        event["message"]["message_id"] = Uuid::new_v4().to_string().into();
        event["message"]["client_message_id"] = Uuid::new_v4().to_string().into();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO outbox_events (id, aggregatetype, aggregateid, type, payload, created_at) \
             VALUES (?, 'chat_message', ?, 'message_created', CAST(? AS JSON), UTC_TIMESTAMP(6))",
        )
        .bind(&id)
        .bind(self.conversation.to_string())
        .bind(event.to_string())
        .execute(&mut *tx)
        .await?;
        tx.rollback().await?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM outbox_events WHERE id = ?")
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;
        ensure!(count == 0, "rolled-back outbox event remained in MySQL");
        Ok(id)
    }

    pub(super) async fn check_cursors_unchanged(&self) -> Result<()> {
        let cursors: Vec<(u64, u64)> = sqlx::query_as(
            "SELECT delivered_seq, read_seq FROM conversation_member_cursors WHERE conversation_id = ?",
        ).bind(self.conversation).fetch_all(&self.pool).await?;
        ensure!(
            cursors == vec![(0, 0), (0, 0)],
            "online delivery must not advance delivery/read cursors"
        );
        Ok(())
    }

    pub(super) async fn cleanup(self) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM outbox_events WHERE aggregateid = ?")
            .bind(self.conversation.to_string())
            .execute(&mut *tx)
            .await?;
        for statement in [
            "DELETE FROM messages WHERE conversation_id = ?",
            "DELETE FROM conversation_member_cursors WHERE conversation_id = ?",
            "DELETE FROM conversation_members WHERE conversation_id = ?",
        ] {
            sqlx::query(statement)
                .bind(self.conversation)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(self.conversation)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM users WHERE id IN (?, ?)")
            .bind(self.alice)
            .bind(self.bob)
            .execute(&mut *tx)
            .await?;
        tx.commit()
            .await
            .context("clean up only this test's fixture rows")?;
        self.pool.close().await;
        Ok(())
    }
}
