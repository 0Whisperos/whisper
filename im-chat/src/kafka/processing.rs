use std::future::Future;
use std::time::Duration;

use tokio::sync::watch;
use tokio::time::{Instant, sleep, timeout_at};

use crate::delivery::DeliveryError;
use crate::message::MessageCreatedEvent;

use super::KafkaServiceError;
use super::record::{EventRecord, RecordPosition};

const PROCESSING_BUDGET: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub(super) enum OperationError {
    #[error("Redis event completion operation failed: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("message delivery preparation failed: {0}")]
    Delivery(#[from] DeliveryError),
}

/// Only abstracts external effects; the same ordering and retry code runs in tests and production.
pub(super) trait RecordEffects: Sync {
    fn contains(&self, event_id: &str)
    -> impl Future<Output = Result<bool, OperationError>> + Send;
    fn deliver(
        &self,
        event: &MessageCreatedEvent,
    ) -> impl Future<Output = Result<(), OperationError>> + Send;
    fn complete(&self, event_id: &str) -> impl Future<Output = Result<(), OperationError>> + Send;
    fn commit(
        &self,
        position: &RecordPosition,
    ) -> impl Future<Output = Result<(), KafkaServiceError>> + Send;
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum HandleOutcome {
    Complete,
    Rebuild,
    Shutdown,
}

pub(super) async fn handle_record(
    record: &EventRecord,
    effects: &impl RecordEffects,
    shutdown: &mut watch::Receiver<bool>,
) -> HandleOutcome {
    if is_stopping(shutdown) {
        return HandleOutcome::Shutdown;
    }
    let event = match record.parse() {
        Ok(event) => event,
        Err(error) => {
            tracing::error!(
                topic = %record.position.topic,
                partition = record.position.partition,
                offset = record.position.offset,
                event_id = ?record.event_id_for_log(),
                %error,
                "skip invalid Kafka message event"
            );
            return commit_record(record, effects, shutdown).await;
        }
    };
    let mut retry = RetryContext {
        position: &record.position,
        event_id: &event.event_id,
        deadline: Instant::now() + PROCESSING_BUDGET,
        delay: Duration::from_secs(1),
    };
    let completed = match retry
        .attempt("check_completed", shutdown, || {
            effects.contains(&event.event_id)
        })
        .await
    {
        Ok(completed) => completed,
        Err(outcome) => return outcome,
    };
    if !completed {
        if let Err(outcome) = retry
            .attempt("deliver", shutdown, || effects.deliver(&event))
            .await
        {
            return outcome;
        }
        // Once delivery decisions finish, retries stay in this stage. They never resend locally.
        if let Err(outcome) = retry
            .attempt("mark_completed", shutdown, || {
                effects.complete(&event.event_id)
            })
            .await
        {
            return outcome;
        }
    }
    commit_record(record, effects, shutdown).await
}

async fn commit_record(
    record: &EventRecord,
    effects: &impl RecordEffects,
    shutdown: &watch::Receiver<bool>,
) -> HandleOutcome {
    if is_stopping(shutdown) {
        return HandleOutcome::Shutdown;
    }
    // Never race a synchronous commit against timeout/shutdown: its blocking task must finish.
    if let Err(error) = effects.commit(&record.position).await {
        tracing::error!(
            topic = %record.position.topic,
            partition = record.position.partition,
            offset = record.position.offset,
            event_id = ?record.event_id_for_log(),
            %error,
            "offset commit failed; close consumer before retrying"
        );
        return HandleOutcome::Rebuild;
    }
    HandleOutcome::Complete
}

struct RetryContext<'a> {
    position: &'a RecordPosition,
    event_id: &'a str,
    deadline: Instant,
    delay: Duration,
}

impl RetryContext<'_> {
    async fn attempt<T, F, Fut>(
        &mut self,
        stage: &'static str,
        shutdown: &mut watch::Receiver<bool>,
        mut operation: F,
    ) -> Result<T, HandleOutcome>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<T, OperationError>>,
    {
        loop {
            if Instant::now() >= self.deadline {
                return Err(self.expired(stage));
            }
            let result = tokio::select! {
                biased;
                _ = cancelled(shutdown) => return Err(HandleOutcome::Shutdown),
                result = timeout_at(self.deadline, operation()) => result,
            };
            match result {
                Ok(Ok(value)) => return Ok(value),
                Ok(Err(error)) => {
                    tracing::warn!(
                        topic = %self.position.topic,
                        partition = self.position.partition,
                        offset = self.position.offset,
                        event_id = self.event_id,
                        stage,
                        %error,
                        "retry message event operation without advancing offset"
                    );
                }
                Err(_) => return Err(self.expired(stage)),
            }
            tokio::select! {
                biased;
                _ = cancelled(shutdown) => return Err(HandleOutcome::Shutdown),
                result = timeout_at(self.deadline, sleep(self.delay)) => {
                    if result.is_err() {
                        return Err(self.expired(stage));
                    }
                }
            }
            self.delay = (self.delay * 2).min(Duration::from_secs(30));
        }
    }

    fn expired(&self, stage: &'static str) -> HandleOutcome {
        tracing::error!(
            topic = %self.position.topic,
            partition = self.position.partition,
            offset = self.position.offset,
            event_id = self.event_id,
            stage,
            "message event processing exceeded 60 second budget; rebuild consumer"
        );
        HandleOutcome::Rebuild
    }
}

pub(super) fn is_stopping(shutdown: &watch::Receiver<bool>) -> bool {
    *shutdown.borrow() || shutdown.has_changed().is_err()
}

pub(super) async fn cancelled(shutdown: &mut watch::Receiver<bool>) {
    loop {
        let stopping = *shutdown.borrow_and_update();
        if stopping || shutdown.changed().await.is_err() {
            return;
        }
    }
}
