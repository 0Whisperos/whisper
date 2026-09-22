use super::*;

#[test]
fn reads_online_route_and_absence() {
    // 测试目标：验证路由解析能够区分在线和离线。
    // 构造方法：直接解析完整 Hash 和空 Hash，不依赖 Redis 服务。
    // 输入数据：user_id=20001、node-a、connection-a；另一输入为空。
    // 预期行为：完整输入产生对应在线路由，空输入为 Offline。
    assert_eq!(parse_route(20001, HashMap::new()), RouteState::Offline);
    let fields = HashMap::from([
        ("user_id".to_owned(), "20001".to_owned()),
        ("node_id".to_owned(), "node-a".to_owned()),
        ("connection_id".to_owned(), "connection-a".to_owned()),
    ]);
    assert_eq!(
        parse_route(20001, fields),
        RouteState::Online(PresenceRoute {
            node_id: "node-a".to_owned(),
            connection_id: "connection-a".to_owned(),
        })
    );
}

#[test]
fn rejects_missing_blank_and_mismatched_routing_fields() {
    // 测试目标：验证损坏的 presence 不会成为可投递路由。
    // 构造方法：从合法 Hash 分别删除或损坏一个必需字段。
    // 输入数据：缺失/空 node_id、缺失/空 connection_id、错误/非数字 user_id。
    // 预期行为：每一种损坏均返回 Invalid。
    for (field, value) in [
        ("node_id", None),
        ("node_id", Some(" ")),
        ("connection_id", None),
        ("connection_id", Some("")),
        ("user_id", None),
        ("user_id", Some("20002")),
        ("user_id", Some("abc")),
    ] {
        let mut fields = HashMap::from([
            ("user_id".to_owned(), "20001".to_owned()),
            ("node_id".to_owned(), "node-a".to_owned()),
            ("connection_id".to_owned(), "connection-a".to_owned()),
        ]);
        match value {
            Some(value) => {
                fields.insert(field.to_owned(), value.to_owned());
            }
            None => {
                fields.remove(field);
            }
        }
        assert_eq!(parse_route(20001, fields), RouteState::Invalid);
    }
}

#[tokio::test]
#[ignore = "requires TEST_REDIS_URL pointing to a dedicated Redis database"]
async fn reads_redis_and_classifies_damaged_values_without_hiding_outages() {
    // 测试目标：验证实际 Redis 的不存在、合法路由、错误值类型和非 UTF-8 数据均正确分类。
    // 构造方法：使用随机用户键，依次创建合法 Hash、二进制字段、字符串值，最后删除键。
    // 输入数据：随机 user_id、node-a/connection-a、0xff 字节、错误字符串类型。
    // 预期行为：分别为 Offline、Online、Invalid、Invalid，测试结束无残留键。
    let url = std::env::var("TEST_REDIS_URL").expect("TEST_REDIS_URL is required");
    let client = redis::Client::open(url).expect("Redis URL");
    let manager = PresenceManager::new(client.clone());
    let user_id = (uuid::Uuid::new_v4().as_u128() as u64) | (1 << 63);
    let key = format!("presence:user:{user_id}");
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("Redis connection");
    assert_eq!(
        manager.read_route(user_id).await.expect("absent route"),
        RouteState::Offline
    );
    manager
        .register_presence(user_id, "connection-a", "node-a", "2026-09-20T12:00:00Z")
        .await
        .expect("register route");
    let online = manager.read_route(user_id).await;
    let _: () = redis::cmd("HSET")
        .arg(&key)
        .arg("node_id")
        .arg(vec![0xff_u8])
        .query_async(&mut connection)
        .await
        .expect("damage UTF-8");
    let invalid_utf8 = manager.read_route(user_id).await;
    let _: () = redis::cmd("SET")
        .arg(&key)
        .arg("wrong-type")
        .arg("EX")
        .arg(30)
        .query_async(&mut connection)
        .await
        .expect("replace with wrong type");
    let invalid_type = manager.read_route(user_id).await;
    let _: () = redis::cmd("DEL")
        .arg(&key)
        .query_async(&mut connection)
        .await
        .expect("cleanup route");
    assert_eq!(
        online.expect("online lookup"),
        RouteState::Online(PresenceRoute {
            node_id: "node-a".to_owned(),
            connection_id: "connection-a".to_owned(),
        })
    );
    assert_eq!(invalid_utf8.expect("UTF-8 lookup"), RouteState::Invalid);
    assert_eq!(invalid_type.expect("type lookup"), RouteState::Invalid);
}
