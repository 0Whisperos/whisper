use super::*;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;

#[tokio::test]
async fn malformed_recall_echoes_request_without_database_access() {
    // 测试目标：验证非法撤回请求返回稳定错误并回显请求 ID。
    // 构造方法：使用不可连接的 lazy pool 和内存写队列依次提交错误 payload。
    // 输入数据：缺少 message_id、数值 ID、错误 UUID，以及带多余字段的请求。
    // 预期行为：全部返回 invalid_message_id，保持连接且不访问数据库。
    let pool = MySqlPoolOptions::new()
        .connect_lazy("mysql://localhost/unused")
        .unwrap();
    for payload in [
        json!({}),
        json!({"message_id":1}),
        json!({"message_id":"bad"}),
        json!({"message_id":uuid::Uuid::new_v4().to_string(),"extra":true}),
    ] {
        let (tx, mut rx) = mpsc::channel(1);
        let expected_id = payload
            .get("message_id")
            .and_then(|id| id.as_str())
            .map(str::to_owned);
        assert!(
            handle_frame(
                Frame::new(RECALL_MESSAGE.to_owned(), "request-1".to_owned(), payload),
                &pool,
                tx,
                1,
                "connection"
            )
            .await
        );
        let Message::Text(text) = rx.recv().await.unwrap() else {
            panic!("text response required")
        };
        let response: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(response["type"], "recall_message_rejected");
        assert_eq!(response["request_id"], "request-1");
        assert_eq!(response["payload"]["error_code"], "invalid_message_id");
        assert_eq!(
            response["payload"]["message_id"].as_str(),
            expected_id.as_deref()
        );
    }
}
