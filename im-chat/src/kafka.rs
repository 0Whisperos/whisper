mod consumer;
mod dedup;
mod processing;
mod record;
mod service;

pub(crate) use service::{ConsumerService, KafkaServiceError};
use service::{create_consumer, safe_kafka_error};

#[cfg(test)]
use service::consumer_config;
