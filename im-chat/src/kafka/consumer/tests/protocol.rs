use super::super::*;
use super::support::{Effects, record};

#[test]
fn kafka_diagnostics_include_codes_and_parameter_names_without_secrets() {
    // 测试目标：验证Kafka错误诊断保留可定位的错误码和参数名，同时隐藏配置值及描述中的密码。
    // 构造方法：构造含敏感值的ClientConfig错误，以及真实类型的提交超时错误。
    // 输入数据：参数sasl.password、敏感字符串test-sensitive-password、RequestTimedOut错误码。
    // 预期行为：Display/Debug包含参数名或超时原因，任何格式都不包含敏感原文。
    use rdkafka::error::RDKafkaErrorCode;
    use rdkafka::types::RDKafkaConfRes;
    let config_error = KafkaServiceError::Initialize(KafkaError::ClientConfig(
        RDKafkaConfRes::RD_KAFKA_CONF_INVALID,
        "invalid value test-sensitive-password".to_owned(),
        "sasl.password".to_owned(),
        "test-sensitive-password".to_owned(),
    ));
    for diagnostic in [config_error.to_string(), format!("{config_error:?}")] {
        assert!(diagnostic.contains("sasl.password"));
        assert!(diagnostic.contains("INVALID"));
        assert!(!diagnostic.contains("test-sensitive-password"));
    }
    let commit_error = KafkaServiceError::Commit(KafkaError::ConsumerCommit(
        RDKafkaErrorCode::RequestTimedOut,
    ));
    assert!(commit_error.to_string().contains("RequestTimedOut"));
}

#[test]
fn configuration_uses_shared_group_and_explicit_offset_control() {
    // 测试目标：验证消费者共享消费组，且消费进度不会由后台自动推进。
    // 构造方法：通过实际配置构建函数生成两个不同client.id的客户端设置。
    // 输入数据：相同Kafka配置及node-a/node-b客户端ID。
    // 预期行为：消费组相同、client.id不同，自动提交和自动存储均false，新组earliest。
    let config = crate::config::KafkaConfig {
        bootstrap_servers: "127.0.0.1:9092".to_owned(),
        topic: "whisper.chat.message-events.v1".to_owned(),
        group_id: "whisper-im-chat-message-delivery-v1".to_owned(),
        username: "whisper".to_owned(),
        password: "test-password".to_owned(),
    };
    let first = super::super::super::consumer_config(&config, "node-a");
    let second = super::super::super::consumer_config(&config, "node-b");
    assert_eq!(first.get("group.id"), second.get("group.id"));
    assert_ne!(first.get("client.id"), second.get("client.id"));
    for (key, value) in [
        ("enable.auto.commit", "false"),
        ("enable.auto.offset.store", "false"),
        ("auto.offset.reset", "earliest"),
        ("max.poll.interval.ms", "300000"),
        ("security.protocol", "SASL_PLAINTEXT"),
        ("sasl.mechanism", "PLAIN"),
    ] {
        assert_eq!(first.get(key), Some(value));
    }
}

#[test]
fn commit_offsets_contains_only_the_processed_partition_and_next_position() {
    // 测试目标：验证提交集合只覆盖当前record所属分区，避免提交其他预取消息。
    // 构造方法：对合法位置生成TopicPartitionList，并检查边界位置拒绝情况。
    // 输入数据：分区2、offset41；额外输入负offset和i64最大值。
    // 预期行为：仅含分区2的Offset(42)，负数和溢出均返回明确错误。
    let mut record = record();
    let offsets = commit_offsets(&record.position).unwrap();
    assert_eq!(offsets.count(), 1);
    assert_eq!(
        offsets
            .find_partition(&record.position.topic, 2)
            .unwrap()
            .offset(),
        Offset::Offset(42)
    );
    for offset in [-1, i64::MAX] {
        record.position.offset = offset;
        assert!(matches!(
            commit_offsets(&record.position),
            Err(KafkaServiceError::InvalidOffset)
        ));
    }
}

#[tokio::test]
async fn invalid_records_skip_all_delivery_effects_and_commit_their_position() {
    // 测试目标：验证不符合事件契约的record不会访问Redis或投递，但能够跳过推进消费。
    // 构造方法：逐一破坏合法record的payload、key、headers、类型和版本并调用实际处理函数。
    // 输入数据：空/坏JSON、缺字段、缺key/头、冲突或重复头、非法UTF8头、未知类型/版本。
    // 预期行为：每个坏record只调用commit且返回Complete，不执行check、deliver或mark。
    let mut cases = Vec::new();
    let mut missing_payload = record();
    missing_payload.payload = None;
    cases.push(missing_payload);
    let mut bad_json = record();
    bad_json.payload = Some(b"{not-json".to_vec());
    cases.push(bad_json);
    for key in [None, Some(b"different-conversation".to_vec())] {
        let mut invalid = record();
        invalid.key = key;
        cases.push(invalid);
    }
    for index in 0..3 {
        let mut missing = record();
        missing.headers.remove(index);
        cases.push(missing);
        let mut conflicting = record();
        conflicting.headers[index].1 = Some(b"conflicting-value".to_vec());
        cases.push(conflicting);
        let mut null = record();
        null.headers[index].1 = None;
        cases.push(null);
    }
    let mut duplicate = record();
    duplicate.headers.push(duplicate.headers[0].clone());
    cases.push(duplicate);
    let mut invalid_utf8 = record();
    invalid_utf8.headers[0].1 = Some(vec![0xff]);
    cases.push(invalid_utf8);
    for (field, value) in [
        ("event_type", serde_json::json!("future_event")),
        ("event_version", serde_json::json!(2)),
        ("aggregate_id", serde_json::json!("999")),
        ("aggregate_type", serde_json::json!("unknown")),
    ] {
        let mut invalid = record();
        let mut payload: serde_json::Value =
            serde_json::from_slice(invalid.payload.as_ref().unwrap()).unwrap();
        payload[field] = value;
        invalid.payload = Some(serde_json::to_vec(&payload).unwrap());
        cases.push(invalid);
    }
    let mut missing_field = record();
    let mut payload: serde_json::Value =
        serde_json::from_slice(missing_field.payload.as_ref().unwrap()).unwrap();
    payload.as_object_mut().unwrap().remove("message");
    missing_field.payload = Some(serde_json::to_vec(&payload).unwrap());
    cases.push(missing_field);
    for (index, record) in cases.into_iter().enumerate() {
        let (_sender, mut shutdown) = watch::channel(false);
        let effects = Effects::default();
        assert!(record.parse().is_err(), "case {index}");
        assert_eq!(
            handle_record(&record, &effects, &mut shutdown).await,
            HandleOutcome::Complete,
            "case {index}"
        );
        assert_eq!(effects.0.lock().unwrap().calls, ["commit"], "case {index}");
    }
}

#[test]
fn malformed_json_diagnostics_preserve_identity_without_echoing_chat_content() {
    // 测试目标：验证格式错误诊断只包含位置与可解析事件ID，不输出输入字段原文。
    // 构造方法：将event_version替换为敏感字符串，并在另一record使用损坏JSON保留header。
    // 输入数据：event_version="private-message-body"和损坏的JSON字节。
    // 预期行为：错误文本不包含敏感字符串，两种情况下都能取得event_id用于定位。
    let mut record = record();
    let expected_id = record.parse().unwrap().event_id;
    let mut payload: serde_json::Value =
        serde_json::from_slice(record.payload.as_ref().unwrap()).unwrap();
    payload["event_version"] = serde_json::json!("private-message-body");
    record.payload = Some(serde_json::to_vec(&payload).unwrap());
    assert!(
        !record
            .parse()
            .unwrap_err()
            .to_string()
            .contains("private-message-body")
    );
    assert_eq!(record.event_id_for_log(), Some(expected_id.clone()));
    record.payload = Some(b"{".to_vec());
    assert_eq!(record.event_id_for_log(), Some(expected_id));
}
