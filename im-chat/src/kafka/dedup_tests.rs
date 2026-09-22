use super::*;

#[test]
fn completion_command_stores_marker_and_seven_day_expiration_together() {
    // 测试目标：验证完成标记与七天TTL通过同一条SET命令写入，且消费组隔离事件键。
    // 构造方法：创建不连接网络的Redis client，检查实际提交的RESP命令参数。
    // 输入数据：group_id="group-a"、event_id="event-1"。
    // 预期行为：命令仅为SET对应键1 EX 604800，不包含领取、租约或token操作。
    let completed = CompletedEvents::new(
        redis::Client::open("redis://127.0.0.1/").unwrap(),
        "group-a".to_owned(),
    );
    let command = completed.complete_command("event-1");
    assert_eq!(
        command.get_packed_command(),
        b"*5\r\n$3\r\nSET\r\n$34\r\nchat:delivery:done:group-a:event-1\r\n$1\r\n1\r\n$2\r\nEX\r\n$6\r\n604800\r\n"
    );
    let other_group = CompletedEvents::new(
        redis::Client::open("redis://127.0.0.1/").unwrap(),
        "group-b".to_owned(),
    );
    assert_ne!(completed.key("event-1"), other_group.key("event-1"));
}

#[tokio::test]
#[ignore = "requires TEST_REDIS_URL pointing to an isolated Redis test database"]
async fn real_redis_retains_completed_event_for_seven_days() {
    // 测试目标：验证真实Redis的完成记录能被再次识别，并实际具有七天TTL。
    // 构造方法：连接显式测试Redis，为本用例创建随机消费组；写入后读取值和TTL，最后清理自身键。
    // 输入数据：唯一group_id、event_id="event-1"，SET值为1，过期秒数604800。
    // 预期行为：写前不存在、写后存在且值为1，TTL接近604800；不影响其他测试或业务键。
    let url = std::env::var("TEST_REDIS_URL")
        .expect("set TEST_REDIS_URL to an isolated Redis test database");
    let client = redis::Client::open(url).unwrap();
    let completed = CompletedEvents::new(client.clone(), format!("test-{}", uuid::Uuid::new_v4()));
    assert!(!completed.contains("event-1").await.unwrap());
    completed.complete("event-1").await.unwrap();
    assert!(completed.contains("event-1").await.unwrap());
    let mut connection = client.get_multiplexed_async_connection().await.unwrap();
    let key = completed.key("event-1");
    let (value, ttl): (String, i64) = redis::pipe()
        .cmd("GET")
        .arg(&key)
        .cmd("TTL")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .unwrap();
    let _: () = redis::cmd("DEL")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .unwrap();
    assert_eq!(value, "1");
    assert!((604_790..=604_800).contains(&ttl), "unexpected TTL: {ttl}");
}
