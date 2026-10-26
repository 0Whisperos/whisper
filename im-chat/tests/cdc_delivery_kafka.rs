use super::environment::Kafka;
use anyhow::{Context, Result, ensure};
use rdkafka::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer, StreamConsumer};
use rdkafka::message::{Header, Headers, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::{Offset, TopicPartitionList};
use serde_json::Value;
use std::time::Duration;
use tokio::time::{Instant, timeout_at};
use uuid::Uuid;

pub(super) struct Observer {
    consumer: StreamConsumer,
}

pub(super) struct Position {
    pub(super) partition: i32,
    offset: i64,
}

impl Observer {
    pub(super) fn new(config: &Kafka) -> Result<Self> {
        let consumer: StreamConsumer = ClientConfig::new()
            .set("bootstrap.servers", &config.bootstrap_servers)
            .set("group.id", format!("cdc-observer-{}", Uuid::new_v4()))
            .set("security.protocol", "SASL_PLAINTEXT")
            .set("sasl.mechanism", "PLAIN")
            .set("sasl.username", &config.username)
            .set("sasl.password", &config.password)
            .set("enable.auto.commit", "false")
            .set("enable.auto.offset.store", "false")
            .create()?;
        let metadata = consumer.fetch_metadata(Some(&config.topic), Duration::from_secs(10))?;
        let topic = metadata
            .topics()
            .iter()
            .find(|topic| topic.name() == config.topic)
            .context("CDC topic must already exist")?;
        ensure!(
            topic.error().is_none(),
            "CDC topic metadata returned an error"
        );
        ensure!(
            topic.partitions().len() == 3,
            "CDC acceptance environment requires the existing three partitions"
        );
        let mut assignment = TopicPartitionList::new();
        for partition in topic.partitions() {
            let (_, high) = consumer.fetch_watermarks(
                &config.topic,
                partition.id(),
                Duration::from_secs(10),
            )?;
            assignment.add_partition_offset(&config.topic, partition.id(), Offset::Offset(high))?;
        }
        consumer.assign(&assignment)?;
        Ok(Self { consumer })
    }

    pub(super) async fn expect_event(
        &self,
        expected: &Value,
        forbidden_id: Option<&str>,
    ) -> Result<Position> {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let record = timeout_at(deadline, self.consumer.recv())
                .await
                .context("CDC did not publish the committed outbox event")??;
            let mut payload: Value =
                serde_json::from_slice(record.payload().context("CDC record has no payload")?)?;
            if let Some(forbidden) = forbidden_id {
                ensure!(
                    payload["event_id"] != forbidden,
                    "CDC published a rolled-back outbox event"
                );
            }
            if payload["event_id"] != expected["event_id"] {
                continue;
            }
            let mut expected_payload = expected.clone();
            normalize_optional_reply(&mut payload);
            normalize_optional_reply(&mut expected_payload);
            ensure!(
                payload == expected_payload,
                "Kafka value differs from the actual outbox payload; differing fields: {:?}",
                differing_paths(&payload, &expected_payload, "")
            );
            let key = expected["aggregate_id"]
                .as_str()
                .context("aggregate id must be a string")?;
            ensure!(
                record.key() == Some(key.as_bytes()),
                "Kafka key is not conversation_id"
            );
            let headers = record
                .headers()
                .context("Kafka event headers are missing")?;
            for name in ["event_id", "event_type", "aggregate_type"] {
                let values: Vec<_> = headers.iter().filter(|header| header.key == name).collect();
                ensure!(
                    values.len() == 1,
                    "Kafka header {name} must occur exactly once"
                );
                ensure!(
                    values[0].value == expected[name].as_str().map(str::as_bytes),
                    "Kafka header {name} conflicts with the envelope"
                );
            }
            return Ok(Position {
                partition: record.partition(),
                offset: record.offset(),
            });
        }
    }
}

pub(super) async fn replay(config: &Kafka, event: &Value, position: &Position) -> Result<()> {
    let producer: FutureProducer = client_config(config)
        .set("message.timeout.ms", "10000")
        .create()?;
    let key = event["aggregate_id"]
        .as_str()
        .context("aggregate id missing")?;
    let value = event.to_string();
    let mut headers = OwnedHeaders::new();
    for name in ["event_id", "event_type", "aggregate_type"] {
        headers = headers.insert(Header {
            key: name,
            value: event[name].as_str(),
        });
    }
    // Preserve the observed Java producer partition instead of assuming that
    // librdkafka's default key partitioner matches Kafka Connect's partitioner.
    producer
        .send(
            FutureRecord::to(&config.topic)
                .partition(position.partition)
                .key(key)
                .payload(&value)
                .headers(headers),
            Duration::from_secs(10),
        )
        .await
        .map_err(|(error, _)| error)?;
    Ok(())
}

pub(super) async fn expect_committed(config: &Kafka, position: &Position) -> Result<()> {
    let consumer: BaseConsumer = client_config(config)
        .set("group.id", &config.group_id)
        .set("enable.auto.commit", "false")
        .create()?;
    let mut partitions = TopicPartitionList::new();
    partitions.add_partition(&config.topic, position.partition);
    // This client never subscribes or joins the delivery group; it only queries
    // that group's broker-persisted offsets as an external observer.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let offsets = consumer.committed_offsets(partitions.clone(), Duration::from_secs(2))?;
        let offset = offsets
            .find_partition(&config.topic, position.partition)
            .context("committed partition missing")?
            .offset();
        if matches!(offset, Offset::Offset(value) if value > position.offset) {
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "completed event did not advance Kafka offset"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn client_config(config: &Kafka) -> ClientConfig {
    let mut client = ClientConfig::new();
    client
        .set("bootstrap.servers", &config.bootstrap_servers)
        .set("security.protocol", "SASL_PLAINTEXT")
        .set("sasl.mechanism", "PLAIN")
        .set("sasl.username", &config.username)
        .set("sasl.password", &config.password);
    client
}

fn differing_paths(actual: &Value, expected: &Value, path: &str) -> Vec<String> {
    if actual == expected {
        return Vec::new();
    }
    if let (Some(actual), Some(expected)) = (actual.as_object(), expected.as_object()) {
        let keys: std::collections::BTreeSet<_> = actual.keys().chain(expected.keys()).collect();
        return keys
            .into_iter()
            .flat_map(|key| {
                let next = format!("{path}/{key}");
                match (actual.get(key), expected.get(key)) {
                    (Some(actual), Some(expected)) => differing_paths(actual, expected, &next),
                    (None, Some(_)) => vec![format!("{next} (missing from Kafka)")],
                    (Some(_), None) => vec![format!("{next} (missing from outbox)")],
                    _ => Vec::new(),
                }
            })
            .collect();
    }
    vec![path.to_owned()]
}

fn normalize_optional_reply(event: &mut Value) {
    // EventRouter JSON expansion defaults to omitting nulls. The existing wire contract
    // treats an omitted nullable reply ID exactly like null, while nonnull IDs stay strict.
    // Source: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
    // Configuration: table.json.payload.null.behavior defaults to ignore.
    if event["event_type"] == "message_created"
        && let Some(message) = event.get_mut("message").and_then(Value::as_object_mut)
    {
        message.entry("reply_to_message_id").or_insert(Value::Null);
    }
}

#[test]
fn nullable_reply_normalization_only_equates_omitted_and_null_creation_reference() {
    // 测试目标：验证 CDC 比较仅容忍 nullable 引用字段缺失与 null 的既有兼容。
    // 构造方法：分别归一缺字段、显式 null、有效引用 ID 的创建事件及撤回事件。
    // 输入数据：reply_to_message_id 缺失/null/target-id，以及无 message 的 message_recalled。
    // 预期行为：只有缺失与 null 等价；非空引用差异仍保留，撤回事件不新增 message。
    let mut omitted = serde_json::json!({"event_type":"message_created","message":{}});
    let mut null =
        serde_json::json!({"event_type":"message_created","message":{"reply_to_message_id":null}});
    let mut nonnull = serde_json::json!({"event_type":"message_created","message":{"reply_to_message_id":"target-id"}});
    for event in [&mut omitted, &mut null, &mut nonnull] {
        normalize_optional_reply(event);
    }
    assert_eq!(omitted, null);
    assert_ne!(omitted, nonnull);
    let mut recall = serde_json::json!({"event_type":"message_recalled","recalled_message":{}});
    let original = recall.clone();
    normalize_optional_reply(&mut recall);
    assert_eq!(recall, original);
}
