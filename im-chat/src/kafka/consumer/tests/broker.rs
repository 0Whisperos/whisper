use std::collections::BTreeSet;

use rdkafka::config::ClientConfig;
use rdkafka::message::{Header, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use tokio::time::Instant;

use super::super::*;
use super::support::record;

const TOPIC: &str = "whisper.chat.message-events.v1";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires isolated TEST_KAFKA_BOOTSTRAP_SERVERS, TEST_KAFKA_USERNAME and TEST_KAFKA_PASSWORD; existing three-partition event topic"]
async fn real_broker_rebalances_partitions_and_resumes_committed_offsets() {
    // 测试目标：验证共享组分区独占、节点离开后的接管，以及真实提交后重建消费者的恢复位置。
    // 构造方法：使用生产create_consumer创建随机组中的两个消费者并驱动poll；依次加入、退出和重建。
    // 输入数据：已有三个分区的聊天topic，随机event_id的合法事件及随后发送到迁移分区的屏障事件。
    // 预期行为：一节点占三分区、两节点不重叠、退出后接管全部；提交后重建只能读取更高offset。
    // 所有接收和分配等待共用180秒截止时间；同步提交/关闭按生产语义完整等待，不丢弃阻塞任务。
    let config = test_config();
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &config.bootstrap_servers)
        .set("security.protocol", "SASL_PLAINTEXT")
        .set("sasl.mechanism", "PLAIN")
        .set("sasl.username", &config.username)
        .set("sasl.password", &config.password)
        .set("message.timeout.ms", "10000")
        .set("socket.timeout.ms", "10000")
        .create()
        .map_err(|error| safe_kafka_error(&error))
        .expect("initialize isolated test producer");
    let mut peers = TestPeers::default();
    let deadline = Instant::now() + Duration::from_secs(180);
    let result = exercise_group(&config, &producer, &mut peers, deadline).await;
    // Cleanup also runs when a timed receive or assertion returns an error.
    let cleanup = peers.close_all().await;
    tokio::task::spawn_blocking(move || drop(producer))
        .await
        .unwrap();
    result.expect("Kafka rebalance and restart scenario failed");
    cleanup.expect("close test consumers");
}

#[derive(Default)]
struct TestPeers {
    first: Option<Arc<StreamConsumer>>,
    second: Option<Arc<StreamConsumer>>,
    restarted: Option<Arc<StreamConsumer>>,
}

impl TestPeers {
    async fn close_all(&mut self) -> Result<(), String> {
        let mut error = None;
        for peer in [&mut self.first, &mut self.second, &mut self.restarted] {
            if let Err(failure) = close_peer(peer).await {
                error.get_or_insert(failure);
            }
        }
        error.map_or(Ok(()), Err)
    }
}

fn test_config() -> crate::config::KafkaConfig {
    let required = |name| {
        std::env::var(name).unwrap_or_else(|_| panic!("set {name} for isolated Kafka testing"))
    };
    crate::config::KafkaConfig {
        bootstrap_servers: required("TEST_KAFKA_BOOTSTRAP_SERVERS"),
        topic: TOPIC.to_owned(),
        group_id: format!("test-im-chat-rebalance-{}", uuid::Uuid::new_v4()),
        username: required("TEST_KAFKA_USERNAME"),
        password: required("TEST_KAFKA_PASSWORD"),
    }
}

async fn exercise_group(
    config: &crate::config::KafkaConfig,
    producer: &FutureProducer,
    peers: &mut TestPeers,
    deadline: Instant,
) -> Result<(), String> {
    peers.first = Some(create_consumer(config, "test-rebalance-a").map_err(|e| e.to_string())?);
    wait_assignment(peers.first.as_ref().unwrap(), None, None, deadline).await?;
    peers.second = Some(create_consumer(config, "test-rebalance-b").map_err(|e| e.to_string())?);
    let (first_partitions, _) = wait_assignment(
        peers.first.as_ref().unwrap(),
        peers.second.as_ref(),
        None,
        deadline,
    )
    .await?;
    let transferred_partition = *first_partitions
        .first()
        .ok_or("first consumer has no partition")?;
    close_peer(&mut peers.first).await?;
    wait_assignment(peers.second.as_ref().unwrap(), None, None, deadline).await?;

    let mut event = unique_event();
    let offset = publish(producer, &event, transferred_partition).await?;
    let received = receive_event(
        peers.second.as_ref().unwrap(),
        &event.event_id,
        None,
        deadline,
    )
    .await?;
    if received.position.partition != transferred_partition || received.position.offset != offset {
        return Err("transferred event was received at an unexpected position".to_owned());
    }
    commit_position(peers.second.as_ref().unwrap(), &received.position)
        .await
        .map_err(|e| e.to_string())?;
    close_peer(&mut peers.second).await?;

    peers.restarted =
        Some(create_consumer(config, "test-rebalance-restarted").map_err(|e| e.to_string())?);
    let floor = Some((transferred_partition, offset));
    wait_assignment(peers.restarted.as_ref().unwrap(), None, floor, deadline).await?;
    event.event_id = uuid::Uuid::new_v4().to_string();
    event.message.message_id = uuid::Uuid::new_v4().to_string();
    event.message.client_message_id = uuid::Uuid::new_v4().to_string();
    event.message.conversation_seq += 1;
    let barrier_offset = publish(producer, &event, transferred_partition).await?;
    let barrier = receive_event(
        peers.restarted.as_ref().unwrap(),
        &event.event_id,
        floor,
        deadline,
    )
    .await?;
    if barrier.position.partition != transferred_partition
        || barrier.position.offset != barrier_offset
        || barrier_offset <= offset
    {
        return Err("restarted consumer did not reach the subsequent barrier".to_owned());
    }
    commit_position(peers.restarted.as_ref().unwrap(), &barrier.position)
        .await
        .map_err(|e| e.to_string())
}

async fn wait_assignment(
    first: &StreamConsumer,
    second: Option<&Arc<StreamConsumer>>,
    floor: Option<(i32, i64)>,
    deadline: Instant,
) -> Result<(BTreeSet<i32>, BTreeSet<i32>), String> {
    let all = BTreeSet::from([0, 1, 2]);
    loop {
        if Instant::now() >= deadline {
            return Err("timed out waiting for three-partition group assignment".to_owned());
        }
        let first_set = partitions(first)?;
        let second_set = second.map_or_else(|| Ok(BTreeSet::new()), |peer| partitions(peer))?;
        let stable = if second.is_some() {
            !first_set.is_empty()
                && !second_set.is_empty()
                && first_set.is_disjoint(&second_set)
                && first_set
                    .union(&second_set)
                    .copied()
                    .collect::<BTreeSet<_>>()
                    == all
        } else {
            first_set == all
        };
        if stable {
            return Ok((first_set, second_set));
        }
        // Both streams must be polled so their rebalance callbacks apply the assignments.
        tokio::select! {
            result = first.receive() => ensure_after_commit(&result.map_err(|e| safe_kafka_error(&e))?, floor)?,
            result = async {
                match second {
                    Some(peer) => peer.receive().await,
                    None => std::future::pending().await,
                }
            } => ensure_after_commit(&result.map_err(|e| safe_kafka_error(&e))?, floor)?,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}

fn partitions(consumer: &StreamConsumer) -> Result<BTreeSet<i32>, String> {
    let assignment = consumer.assignment().map_err(|e| safe_kafka_error(&e))?;
    if assignment
        .elements()
        .iter()
        .any(|element| element.topic() != TOPIC)
    {
        return Err("test consumer was assigned an unexpected topic".to_owned());
    }
    Ok(assignment
        .elements()
        .iter()
        .map(|element| element.partition())
        .collect())
}

async fn receive_event(
    consumer: &StreamConsumer,
    event_id: &str,
    floor: Option<(i32, i64)>,
    deadline: Instant,
) -> Result<EventRecord, String> {
    loop {
        let record = tokio::time::timeout_at(deadline, consumer.receive())
            .await
            .map_err(|_| "timed out waiting for unique test event".to_owned())?
            .map_err(|e| safe_kafka_error(&e))?;
        ensure_after_commit(&record, floor)?;
        if record.event_id_for_log().as_deref() == Some(event_id) {
            record.parse().map_err(|e| e.to_string())?;
            return Ok(record);
        }
    }
}

fn ensure_after_commit(record: &EventRecord, floor: Option<(i32, i64)>) -> Result<(), String> {
    if let Some((partition, committed)) = floor
        && record.position.partition == partition
        && record.position.offset <= committed
    {
        return Err(format!(
            "restarted consumer replayed partition {partition} offset {} at/before committed {committed}",
            record.position.offset
        ));
    }
    Ok(())
}

fn unique_event() -> MessageCreatedEvent {
    let mut event = record().parse().unwrap();
    event.event_id = uuid::Uuid::new_v4().to_string();
    event.message.message_id = uuid::Uuid::new_v4().to_string();
    event.message.client_message_id = uuid::Uuid::new_v4().to_string();
    // A random conversation prevents synthetic broker events from targeting an existing test chat.
    event.message.conversation_id = (uuid::Uuid::new_v4().as_u128() as u64 % (1 << 50)) + 1;
    event.aggregate_id = event.message.conversation_id.to_string();
    event
}

async fn publish(
    producer: &FutureProducer,
    event: &MessageCreatedEvent,
    partition: i32,
) -> Result<i64, String> {
    event.validate().map_err(|e| e.to_string())?;
    let payload = serde_json::to_vec(event).map_err(|e| e.to_string())?;
    let headers = OwnedHeaders::new()
        .insert(Header {
            key: "event_id",
            value: Some(event.event_id.as_str()),
        })
        .insert(Header {
            key: "event_type",
            value: Some(event.event_type.as_str()),
        })
        .insert(Header {
            key: "aggregate_type",
            value: Some(event.aggregate_type.as_str()),
        });
    let (_, offset) = producer
        .send(
            FutureRecord::to(TOPIC)
                .partition(partition)
                .key(event.aggregate_id.as_str())
                .payload(payload.as_slice())
                .headers(headers),
            Duration::from_secs(10),
        )
        .await
        .map_err(|(error, _)| safe_kafka_error(&error))?;
    Ok(offset)
}

async fn close_peer(peer: &mut Option<Arc<StreamConsumer>>) -> Result<(), String> {
    if let Some(consumer) = peer.take() {
        tokio::task::spawn_blocking(move || {
            consumer.unsubscribe();
            drop(consumer);
        })
        .await
        .map_err(|_| "test consumer close task failed".to_owned())?;
    }
    Ok(())
}
