use super::*;
use jsonwebtoken::{EncodingKey, Header, encode};

const SECRET: &str = "test-secret";

#[test]
fn verifies_valid_access_token() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 测试目标：验证合法 HS256 access token 能解析成业务可用的用户 ID 和过期时间。
    // 构造方法：使用与 im-api 相同的 sub/typ/iat/exp claims 结构签发测试 token，再调用 verify_access_token。
    // 输入数据：sub="20001"，typ="access"，exp 为当前时间后一小时。
    // 预期行为：返回 user_id=20001，expires_at 等于 JWT exp 对应的 Unix 时间。
    let exp = (OffsetDateTime::now_utc() + time::Duration::hours(1)).unix_timestamp() as u64;
    let token = sign_test_token("20001", "access", exp)?;

    let verified = verify_access_token(&token, SECRET)?;

    assert_eq!(verified.user_id, 20001);
    assert_eq!(
        verified.expires_at,
        OffsetDateTime::from_unix_timestamp(exp as i64)?
    );
    Ok(())
}

#[test]
fn rejects_expired_access_token() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 测试目标：验证 exp 已经过期的 access token 会映射成稳定的 AccessTokenExpired 错误。
    // 构造方法：签发 exp 为当前时间前一小时的 HS256 token，然后调用 verify_access_token。
    // 输入数据：sub="20001"，typ="access"，exp 为过去时间。
    // 预期行为：返回 Error::AccessTokenExpired，而不是 InvalidAccessToken。
    let exp = (OffsetDateTime::now_utc() - time::Duration::hours(1)).unix_timestamp() as u64;
    let token = sign_test_token("20001", "access", exp)?;

    let err = verify_access_token(&token, SECRET).unwrap_err();

    assert!(matches!(err, Error::AccessTokenExpired));
    Ok(())
}

#[test]
fn rejects_non_access_token_type() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 测试目标：验证 typ 不是 access 的 JWT 不会被当作 WebSocket access token 接受。
    // 构造方法：签发签名和 exp 都合法、但 typ="refresh" 的 token，然后调用 verify_access_token。
    // 输入数据：sub="20001"，typ="refresh"，exp 为当前时间后一小时。
    // 预期行为：返回 Error::InvalidAccessToken。
    let exp = (OffsetDateTime::now_utc() + time::Duration::hours(1)).unix_timestamp() as u64;
    let token = sign_test_token("20001", "refresh", exp)?;

    let err = verify_access_token(&token, SECRET).unwrap_err();

    assert!(matches!(err, Error::InvalidAccessToken));
    Ok(())
}

#[test]
fn rejects_non_numeric_subject() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 测试目标：验证 sub 不能解析为用户 ID 时会被视为无效 access token。
    // 构造方法：签发签名、typ 和 exp 都合法、但 sub 非数字的 token，然后调用 verify_access_token。
    // 输入数据：sub="not-a-user-id"，typ="access"，exp 为当前时间后一小时。
    // 预期行为：返回 Error::InvalidAccessToken。
    let exp = (OffsetDateTime::now_utc() + time::Duration::hours(1)).unix_timestamp() as u64;
    let token = sign_test_token("not-a-user-id", "access", exp)?;

    let err = verify_access_token(&token, SECRET).unwrap_err();

    assert!(matches!(err, Error::InvalidAccessToken));
    Ok(())
}

fn sign_test_token(
    subject: &str,
    token_type: &str,
    expires_at: u64,
) -> std::result::Result<String, jsonwebtoken::errors::Error> {
    let claims = AccessTokenClaims {
        sub: subject.to_string(),
        typ: token_type.to_string(),
        _iat: OffsetDateTime::now_utc().unix_timestamp() as u64,
        exp: expires_at,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(SECRET.as_bytes()),
    )
}
