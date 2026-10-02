use super::*;
use crate::node_rpc::{CURSOR_PATH, MESSAGE_PATH};
use time::OffsetDateTime;

#[tokio::test]
async fn middleware_authenticates_raw_body_and_is_scoped_to_internal_route() {
    // 测试目标：验证内部路由鉴权中间件校验原始正文，且不影响普通路由。
    // 构造方法：为内部路由挂载签名中间件，与无签名公开路由合并后逐次请求。
    // 输入数据：合法签名正文 {"value":1}、篡改正文 {"value":2} 和无签名请求。
    // 预期行为：合法请求到达处理器；篡改请求 401；公开路由无签名仍可访问。
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::middleware;
    use axum::routing::post;
    use axum::{Json, Router};
    use tower::ServiceExt;

    let internal = Router::new()
        .route(
            MESSAGE_PATH,
            post(|Json(value): Json<serde_json::Value>| async move { Json(value) }),
        )
        .route_layer(middleware::from_fn_with_state(
            "secret".to_owned(),
            verify_signature,
        ));
    let router = Router::new()
        .route("/public", post(|| async { StatusCode::NO_CONTENT }))
        .merge(internal);
    let timestamp = OffsetDateTime::now_utc().unix_timestamp().to_string();
    let signature = sign(
        "secret",
        "node-a",
        "POST",
        MESSAGE_PATH,
        &timestamp,
        br#"{"value":1}"#,
    );
    let signed_request = |body: &'static str| {
        Request::builder()
            .method("POST")
            .uri(MESSAGE_PATH)
            .header(NODE_ID_HEADER, "node-a")
            .header(TIMESTAMP_HEADER, &timestamp)
            .header(SIGNATURE_HEADER, &signature)
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    let response = router
        .clone()
        .oneshot(signed_request(r#"{"value":1}"#))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = router
        .clone()
        .oneshot(signed_request(r#"{"value":2}"#))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let public_request = Request::builder()
        .method("POST")
        .uri("/public")
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(public_request).await.unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn middleware_rejects_oversized_body_before_handler() {
    // 测试目标：验证内部接口的正文大小上限。
    // 构造方法：建立有签名中间件的单路由，向它发送超过 64 KiB 的请求。
    // 输入数据：65537 字节正文、任意签名头。
    // 预期行为：中间件返回 413，处理器不被调用。
    use axum::Router;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::middleware;
    use axum::routing::post;
    use tower::ServiceExt;

    let router = Router::new()
        .route(MESSAGE_PATH, post(|| async { StatusCode::NO_CONTENT }))
        .route_layer(middleware::from_fn_with_state(
            "secret".to_owned(),
            verify_signature,
        ));
    let request = Request::builder()
        .method("POST")
        .uri(MESSAGE_PATH)
        .body(Body::from(vec![b'x'; MAX_BODY_BYTES + 1]))
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[test]
fn signature_binds_sender_path_timestamp_and_body() {
    // 测试目标：验证内部请求的节点、路径、时间戳和原始正文均受 HMAC 保护。
    // 构造方法：先签署一个有效请求，再逐一替换签名输入或接收时间。
    // 输入数据：node-a、消息接口、Unix 秒 1000、正文 {"id":1}。
    // 预期行为：原请求通过；被修改、过期或未来超过 30 秒的请求被拒绝。
    let body = br#"{"id":1}"#;
    let signature = sign(
        "shared-secret",
        "node-a",
        "POST",
        MESSAGE_PATH,
        "1000",
        body,
    );
    assert_eq!(
        verify_at(
            "shared-secret",
            "node-a",
            "POST",
            MESSAGE_PATH,
            "1000",
            body,
            &signature,
            1030
        ),
        Ok(())
    );
    for (node_id, path, timestamp, changed_body, now) in [
        ("node-b", MESSAGE_PATH, "1000", body.as_slice(), 1000),
        ("node-a", CURSOR_PATH, "1000", body.as_slice(), 1000),
        ("node-a", MESSAGE_PATH, "1001", body.as_slice(), 1000),
        (
            "node-a",
            MESSAGE_PATH,
            "1000",
            br#"{"id":2}"#.as_slice(),
            1000,
        ),
        ("node-a", MESSAGE_PATH, "1000", body.as_slice(), 1031),
        ("node-a", MESSAGE_PATH, "1000", body.as_slice(), 969),
    ] {
        assert_eq!(
            verify_at(
                "shared-secret",
                node_id,
                "POST",
                path,
                timestamp,
                changed_body,
                &signature,
                now
            ),
            Err(StatusCode::UNAUTHORIZED)
        );
    }
}
