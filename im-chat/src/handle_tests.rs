use super::*;

#[tokio::test]
async fn token_expiration_notifies_client_before_closing_socket() {
    // 测试目标：验证已认证连接因 access token 到期关闭时，服务端先发送过期认证帧，再发送 WebSocket close 帧。
    // 构造方法：创建容量为二的写队列，调用 token 到期通知函数，并按队列顺序读取两条消息。
    // 输入数据：user_id=20001、connection_id="connection-1"，到期错误码 token_expired。
    // 预期行为：第一条消息是无 request_id 的 auth_failed(token_expired)，第二条消息以策略关闭码关闭连接。
    let (write_tx, mut write_rx) = mpsc::channel(2);

    notify_token_expired(&write_tx, 20001, "connection-1").await;

    let Some(Message::Text(text)) = write_rx.recv().await else {
        panic!("expected token expiration text frame first");
    };
    let frame: serde_json::Value = serde_json::from_str(text.as_str()).expect("valid JSON frame");
    assert_eq!(frame["type"], "auth_failed");
    assert_eq!(frame["payload"]["error_code"], "token_expired");
    assert_eq!(frame["payload"]["message"], "access token expired");
    assert!(frame.get("request_id").is_none());

    let Some(Message::Close(Some(close_frame))) = write_rx.recv().await else {
        panic!("expected close frame after token expiration notification");
    };
    assert_eq!(close_frame.code, close_code::POLICY);
    assert_eq!(close_frame.reason, "access token expired");
}
