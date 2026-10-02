use super::*;
use axum::{Json, Router, body::Bytes as AxumBytes, http::HeaderMap, routing::post};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::net::TcpListener;

fn client() -> NodeRpcClient {
    NodeRpcClient::new(
        Arc::new(PresenceManager::new(
            redis::Client::open("redis://localhost/").unwrap(),
        )),
        "node-a".to_owned(),
        "test-secret".to_owned(),
    )
}

fn message_request() -> ForwardMessageRequest {
    ForwardMessageRequest {
        target_user_id: 20002,
        connection_id: "remote".to_owned(),
        event_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
        message: serde_json::from_value(json!({
            "message_id": "550e8400-e29b-41d4-a716-446655440001",
            "conversation_id": 10001, "conversation_seq": 42, "sender_user_id": 20001,
            "client_message_id": "550e8400-e29b-41d4-a716-446655440002",
            "message_type": "text", "content": { "text": "private message" },
            "created_at": "2026-09-20T12:00:00+08:00"
        }))
        .unwrap(),
    }
}

#[tokio::test]
async fn signed_message_retries_once_after_server_error() {
    // 测试目标：确认消息请求签名覆盖原始请求体，服务端临时错误仅重试一次。
    // 构造方法：本地 Axum 首次返回 503，第二次返回已入队，并逐次检查签名。
    // 输入数据：用户 20002、连接 remote、含 private message 的消息事件。
    // 预期行为：两次 POST 的签名都正确，最终返回 Queued。
    let hits = Arc::new(AtomicUsize::new(0));
    let handler_hits = hits.clone();
    let app = Router::new().route(
        MESSAGE_PATH,
        post(move |headers: HeaderMap, body: AxumBytes| {
            let hits = handler_hits.clone();
            async move {
                let request: ForwardMessageRequest = serde_json::from_slice(&body).unwrap();
                assert_eq!(request.target_user_id, 20002);
                assert_eq!(request.connection_id, "remote");
                assert_eq!(request.message.content, json!({"text":"private message"}));
                let timestamp = headers["X-Whisper-Timestamp"].to_str().unwrap();
                let expected = sign(
                    "test-secret",
                    "node-a",
                    "POST",
                    MESSAGE_PATH,
                    timestamp,
                    &body,
                );
                assert_eq!(headers["X-Whisper-Node-Id"].to_str().unwrap(), "node-a");
                assert_eq!(headers["X-Whisper-Signature"].to_str().unwrap(), expected);
                if hits.fetch_add(1, Ordering::SeqCst) == 0 {
                    (StatusCode::SERVICE_UNAVAILABLE, Json(EnqueueStatus::Queued))
                } else {
                    (StatusCode::OK, Json(EnqueueStatus::Queued))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let result = client()
        .send_to_addr(&addr.to_string(), MESSAGE_PATH, &message_request())
        .await;
    assert_eq!(result.unwrap(), EnqueueStatus::Queued);
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    server.abort();
}

#[tokio::test]
async fn cursor_response_preserves_connection_mismatch_status() {
    // 测试目标：区分目标连接变化和 HTTP 调用失败。
    // 构造方法：本地游标接口直接返回 ConnectionIdMismatch。
    // 输入数据：会话 10001、目标用户 20002、连接 remote、游标 42/40。
    // 预期行为：客户端返回状态而不是错误，且请求体包含完整游标。
    let app = Router::new().route(
        CURSOR_PATH,
        post(|Json(request): Json<NotifyCursorRequest>| async move {
            assert_eq!(request.target_user_id, 20002);
            assert_eq!(request.connection_id, "remote");
            assert_eq!((request.conversation_id, request.user_id), (10001, 20001));
            assert_eq!((request.delivered_seq, request.read_seq), (42, 40));
            Json(EnqueueStatus::ConnectionIdMismatch)
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let result = client()
        .send_to_addr(
            &addr.to_string(),
            CURSOR_PATH,
            &NotifyCursorRequest {
                target_user_id: 20002,
                connection_id: "remote".into(),
                conversation_id: 10001,
                user_id: 20001,
                delivered_seq: 42,
                read_seq: 40,
            },
        )
        .await;
    assert_eq!(result.unwrap(), EnqueueStatus::ConnectionIdMismatch);
    server.abort();
}

#[tokio::test]
async fn timeout_stops_after_two_attempts() {
    // 测试目标：避免远端超时导致无限重试或重试整条 Kafka 事件。
    // 构造方法：本地接口收到请求后等待两秒，并用原子计数器记录请求数。
    // 输入数据：发给 remote 连接的消息事件，单次请求截止时间为一秒。
    // 预期行为：返回 Timeout，两次请求后停止。
    let hits = Arc::new(AtomicUsize::new(0));
    let handler_hits = hits.clone();
    let app = Router::new().route(
        MESSAGE_PATH,
        post(move || {
            let hits = handler_hits.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_secs(2)).await;
                Json(EnqueueStatus::Queued)
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let result = client()
        .send_to_addr(&addr.to_string(), MESSAGE_PATH, &message_request())
        .await;
    assert!(matches!(result, Err(NodeRpcClientError::Timeout)));
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    server.abort();
}

#[tokio::test]
async fn queue_full_and_invalid_response_are_distinct() {
    // 测试目标：队列满属于有效入队状态，损坏的成功响应属于协议错误。
    // 构造方法：本地接口依次返回 Full 和不可解析的 JSON 值。
    // 输入数据：两次相同的消息转发请求。
    // 预期行为：第一次返回 Full，第二次返回 InvalidResponse，不重试。
    let hits = Arc::new(AtomicUsize::new(0));
    let handler_hits = hits.clone();
    let app = Router::new().route(
        MESSAGE_PATH,
        post(move || {
            let hits = handler_hits.clone();
            async move {
                if hits.fetch_add(1, Ordering::SeqCst) == 0 {
                    (StatusCode::OK, Json(json!("full")))
                } else {
                    (StatusCode::OK, Json(json!({"unexpected":"value"})))
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = client();
    assert_eq!(
        client
            .send_to_addr(&addr.to_string(), MESSAGE_PATH, &message_request())
            .await
            .unwrap(),
        EnqueueStatus::Full
    );
    assert!(matches!(
        client
            .send_to_addr(&addr.to_string(), MESSAGE_PATH, &message_request())
            .await,
        Err(NodeRpcClientError::InvalidResponse)
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    server.abort();
}

#[test]
fn invalid_node_address_and_error_format_do_not_expose_message_body() {
    // 测试目标：拒绝意外路径或非 HTTP 协议，并保证错误文本不包含消息正文。
    // 构造方法：直接检查地址解析和客户端错误格式，不进行网络请求。
    // 输入数据：HTTPS 地址、带路径地址、合法主机端口和私密消息正文。
    // 预期行为：仅合法主机端口可生成 URI，错误 Display 与 Debug 均不含正文。
    assert!(remote_uri("https://example.test", MESSAGE_PATH).is_none());
    assert!(remote_uri("127.0.0.1:9000/other", MESSAGE_PATH).is_none());
    assert!(remote_uri("127.0.0.1:9000", MESSAGE_PATH).is_some());
    let error = NodeRpcClientError::InvalidResponse;
    assert!(!error.to_string().contains("private message"));
    assert!(!format!("{error:?}").contains("private message"));
}
