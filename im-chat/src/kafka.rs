mod consumer;
mod dedup;
mod processing;
mod record;

use std::sync::Arc;

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::error::KafkaError;

use crate::config::KafkaConfig;
use crate::delivery::DeliveryService;

use dedup::CompletedEvents;

/// One sequential consumer per node; Kafka assigns partitions within the shared group.
pub(crate) struct ConsumerService {
    config: KafkaConfig,
    client_id: String,
    consumer: Arc<StreamConsumer>,
    completed: CompletedEvents,
    delivery: DeliveryService,
}

#[derive(thiserror::Error)]
pub(crate) enum KafkaServiceError {
    #[error("failed to initialize Kafka consumer: {}", safe_kafka_error(.0))]
    Initialize(#[source] KafkaError),
    #[error("failed to subscribe to message events: {}", safe_kafka_error(.0))]
    Subscribe(#[source] KafkaError),
    #[error("failed to commit message event offset: {}", safe_kafka_error(.0))]
    Commit(#[source] KafkaError),
    #[error("message event offset cannot be advanced")]
    InvalidOffset,
    #[error("Kafka blocking task failed: {}", if .0.is_panic() { "panic" } else { "cancelled" })]
    BlockingTask(#[source] tokio::task::JoinError),
}

impl std::fmt::Debug for KafkaServiceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Application supervision logs Result with Debug; never expose raw configuration values.
        std::fmt::Display::fmt(self, formatter)
    }
}

fn safe_kafka_error(error: &KafkaError) -> String {
    if let Some(code) = error.rdkafka_error_code() {
        return format!("{code:?}: {code}");
    }
    match error {
        KafkaError::ClientConfig(status, _, parameter, _) => {
            format!("client configuration parameter {parameter}: {status:?}")
        }
        KafkaError::ClientCreation(_) => "client creation failed".to_owned(),
        KafkaError::Subscription(_) => "invalid topic subscription".to_owned(),
        KafkaError::Nul(_) => "configuration contains a NUL byte".to_owned(),
        KafkaError::Canceled => "client was dropped".to_owned(),
        KafkaError::NoMessageReceived => "no message received".to_owned(),
        KafkaError::PartitionEOF(partition) => format!("end of partition {partition}"),
        _ => "Kafka operation failed without a broker error code".to_owned(),
    }
}

impl ConsumerService {
    pub(crate) fn new(
        config: KafkaConfig,
        node_id: &str,
        redis: redis::Client,
        delivery: DeliveryService,
    ) -> Result<Self, KafkaServiceError> {
        let client_id = format!("whisper-im-chat-{node_id}");
        let consumer = create_consumer(&config, &client_id)?;
        let completed = CompletedEvents::new(redis, config.group_id.clone());
        Ok(Self {
            config,
            client_id,
            consumer,
            completed,
            delivery,
        })
    }
}

fn consumer_config(config: &KafkaConfig, client_id: &str) -> ClientConfig {
    let mut client = ClientConfig::new();
    client
        .set("bootstrap.servers", &config.bootstrap_servers)
        .set("group.id", &config.group_id)
        .set("client.id", client_id)
        .set("security.protocol", "SASL_PLAINTEXT")
        .set("sasl.mechanism", "PLAIN")
        .set("sasl.username", &config.username)
        .set("sasl.password", &config.password)
        .set("enable.auto.commit", "false")
        .set("enable.auto.offset.store", "false")
        .set("auto.offset.reset", "earliest")
        .set("max.poll.interval.ms", "300000")
        .set("socket.timeout.ms", "10000");
    client
}

fn create_consumer(
    config: &KafkaConfig,
    client_id: &str,
) -> Result<Arc<StreamConsumer>, KafkaServiceError> {
    let consumer: StreamConsumer = consumer_config(config, client_id)
        .create()
        .map_err(KafkaServiceError::Initialize)?;
    consumer
        .subscribe(&[&config.topic])
        .map_err(KafkaServiceError::Subscribe)?;
    Ok(Arc::new(consumer))
}
