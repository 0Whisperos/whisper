use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::error::KafkaError;
use rdkafka::{Offset, TopicPartitionList};
use tokio::sync::watch;

use crate::delivery::DeliveryService;
use crate::message::MessageCreatedEvent;

use super::dedup::CompletedEvents;
use super::processing::{
    HandleOutcome, OperationError, RecordEffects, cancelled, handle_record, is_stopping,
};
use super::record::{EventRecord, RecordPosition};
use super::{ConsumerService, KafkaServiceError, create_consumer, safe_kafka_error};

impl ConsumerService {
    pub(crate) async fn run(
        self,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), KafkaServiceError> {
        let Self {
            config,
            client_id,
            mut consumer,
            completed,
            delivery,
        } = self;
        loop {
            let effects = ConsumerEffects {
                consumer: &consumer,
                completed: &completed,
                delivery: &delivery,
            };
            let outcome = consume(consumer.as_ref(), &effects, &mut shutdown).await;
            // Drop can block while librdkafka leaves the group. Await it before constructing a peer.
            tokio::task::spawn_blocking(move || {
                consumer.unsubscribe();
                drop(consumer);
            })
            .await
            .map_err(KafkaServiceError::BlockingTask)?;
            if outcome == HandleOutcome::Shutdown || is_stopping(&shutdown) {
                return Ok(());
            }
            let mut delay = Duration::from_secs(1);
            loop {
                tokio::select! {
                    biased;
                    _ = cancelled(&mut shutdown) => return Ok(()),
                    _ = tokio::time::sleep(delay) => {}
                }
                let config = config.clone();
                let client_id = client_id.clone();
                let rebuilt =
                    tokio::task::spawn_blocking(move || create_consumer(&config, &client_id))
                        .await
                        .map_err(KafkaServiceError::BlockingTask)?;
                match rebuilt {
                    Ok(rebuilt) => {
                        consumer = rebuilt;
                        break;
                    }
                    Err(error) => {
                        tracing::error!(%error, "failed to rebuild message event consumer");
                        delay = (delay * 2).min(Duration::from_secs(30));
                    }
                }
            }
        }
    }
}

trait RecordSource: Sync {
    fn receive(&self) -> impl Future<Output = Result<EventRecord, KafkaError>> + Send;
}

impl RecordSource for StreamConsumer {
    async fn receive(&self) -> Result<EventRecord, KafkaError> {
        self.recv()
            .await
            .map(|message| EventRecord::from_message(&message))
    }
}

async fn consume(
    source: &impl RecordSource,
    effects: &impl RecordEffects,
    shutdown: &mut watch::Receiver<bool>,
) -> HandleOutcome {
    loop {
        let record = tokio::select! {
            biased;
            _ = cancelled(shutdown) => return HandleOutcome::Shutdown,
            record = source.receive() => match record {
                Ok(record) => record,
                Err(error) => {
                    tracing::error!(error = %safe_kafka_error(&error), "Kafka receive failed; rebuild message event consumer");
                    return HandleOutcome::Rebuild;
                }
            }
        };
        match handle_record(&record, effects, shutdown).await {
            HandleOutcome::Complete => {}
            outcome => return outcome,
        }
    }
}

struct ConsumerEffects<'a> {
    consumer: &'a Arc<StreamConsumer>,
    completed: &'a CompletedEvents,
    delivery: &'a DeliveryService,
}

impl RecordEffects for ConsumerEffects<'_> {
    async fn contains(&self, event_id: &str) -> Result<bool, OperationError> {
        Ok(self.completed.contains(event_id).await?)
    }

    async fn deliver(&self, event: &MessageCreatedEvent) -> Result<(), OperationError> {
        Ok(self.delivery.deliver(event).await?)
    }

    async fn complete(&self, event_id: &str) -> Result<(), OperationError> {
        Ok(self.completed.complete(event_id).await?)
    }

    async fn commit(&self, position: &RecordPosition) -> Result<(), KafkaServiceError> {
        commit_position(self.consumer, position).await
    }
}

async fn commit_position(
    consumer: &Arc<StreamConsumer>,
    position: &RecordPosition,
) -> Result<(), KafkaServiceError> {
    let offsets = commit_offsets(position)?;
    let consumer = Arc::clone(consumer);
    tokio::task::spawn_blocking(move || consumer.commit(&offsets, CommitMode::Sync))
        .await
        .map_err(KafkaServiceError::BlockingTask)?
        .map_err(KafkaServiceError::Commit)
}

fn commit_offsets(position: &RecordPosition) -> Result<TopicPartitionList, KafkaServiceError> {
    let next_offset = position
        .offset
        .checked_add(1)
        .filter(|_| position.offset >= 0)
        .ok_or(KafkaServiceError::InvalidOffset)?;
    let mut offsets = TopicPartitionList::new();
    offsets
        .add_partition_offset(
            &position.topic,
            position.partition,
            Offset::Offset(next_offset),
        )
        .map_err(KafkaServiceError::Commit)?;
    Ok(offsets)
}

#[cfg(test)]
#[path = "consumer_tests.rs"]
mod tests;
