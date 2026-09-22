use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

use super::super::*;

pub(super) fn record() -> EventRecord {
    let event_id = "550e8400-e29b-41d4-a716-446655440001";
    EventRecord {
        position: RecordPosition {
            topic: "whisper.chat.message-events.v1".to_owned(),
            partition: 2,
            offset: 41,
        },
        key: Some(b"10001".to_vec()),
        payload: Some(
            serde_json::to_vec(&serde_json::json!({
                "event_id": event_id,
                "event_type": "message_created",
                "aggregate_type": "chat_message",
                "aggregate_id": "10001",
                "event_version": 1,
                "occurred_at": "2026-09-20T12:00:00+08:00",
                "message": {
                    "message_id": "550e8400-e29b-41d4-a716-446655440002",
                    "conversation_id": 10001,
                    "conversation_seq": 42,
                    "sender_user_id": 20001,
                    "client_message_id": "550e8400-e29b-41d4-a716-446655440003",
                    "message_type": "text",
                    "content": { "text": "hello" },
                    "created_at": "2026-09-20T12:00:00+08:00"
                }
            }))
            .unwrap(),
        ),
        headers: [
            ("event_id", event_id),
            ("event_type", "message_created"),
            ("aggregate_type", "chat_message"),
        ]
        .into_iter()
        .map(|(name, value)| (name.to_owned(), Some(value.as_bytes().to_vec())))
        .collect(),
    }
}

#[derive(Default)]
pub(super) struct State {
    pub(super) calls: Vec<&'static str>,
    pub(super) completed: HashSet<String>,
    pub(super) failures: HashMap<&'static str, usize>,
    pub(super) hang: Option<&'static str>,
    pub(super) commit_delay: Duration,
    pub(super) committed: Vec<(i32, i64)>,
}

#[derive(Default)]
pub(super) struct Effects(pub(super) Mutex<State>);

impl Effects {
    async fn operation(&self, stage: &'static str) -> Result<(), OperationError> {
        let (hang, fail) = {
            let mut state = self.0.lock().unwrap();
            state.calls.push(stage);
            let remaining = state.failures.entry(stage).or_default();
            let fail = *remaining > 0;
            *remaining = remaining.saturating_sub(1);
            (state.hang == Some(stage), fail)
        };
        if hang {
            std::future::pending::<()>().await;
        }
        if fail {
            return Err(OperationError::Redis(
                std::io::Error::other("simulated dependency outage").into(),
            ));
        }
        Ok(())
    }
}

impl RecordEffects for Effects {
    async fn contains(&self, event_id: &str) -> Result<bool, OperationError> {
        self.operation("check").await?;
        Ok(self.0.lock().unwrap().completed.contains(event_id))
    }

    async fn deliver(&self, _: &MessageCreatedEvent) -> Result<(), OperationError> {
        self.operation("deliver").await
    }

    async fn complete(&self, event_id: &str) -> Result<(), OperationError> {
        self.operation("mark").await?;
        self.0.lock().unwrap().completed.insert(event_id.to_owned());
        Ok(())
    }

    async fn commit(&self, position: &RecordPosition) -> Result<(), KafkaServiceError> {
        let delay = self.0.lock().unwrap().commit_delay;
        self.operation("commit")
            .await
            .map_err(|_| KafkaServiceError::InvalidOffset)?;
        tokio::time::sleep(delay).await;
        let offsets = commit_offsets(position)?;
        let element = offsets
            .find_partition(&position.topic, position.partition)
            .unwrap();
        let Offset::Offset(next) = element.offset() else {
            panic!("expected concrete offset")
        };
        self.0
            .lock()
            .unwrap()
            .committed
            .push((position.partition, next));
        Ok(())
    }
}

pub(super) struct Source(pub(super) Mutex<VecDeque<EventRecord>>);

impl RecordSource for Source {
    async fn receive(&self) -> Result<EventRecord, KafkaError> {
        let record = self.0.lock().unwrap().pop_front();
        if let Some(record) = record {
            Ok(record)
        } else {
            std::future::pending().await
        }
    }
}
