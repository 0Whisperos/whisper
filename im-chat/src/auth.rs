use crate::config::Config;
use crate::error::{Error, Result};
use crate::frame;
use axum::extract::ws::{Message, WebSocket, close_code};
use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use time::OffsetDateTime;

type AuthFrame = frame::Frame<AuthPayload>;
const AUTH_FAILED: &str = "auth_failed";
const AUTH_OK: &str = "auth_ok";

#[derive(Debug, Deserialize)]
struct AuthPayload {
    access_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthOkPayload {
    user_id: u64,
    connection_id: String,
    access_token_expires_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct AccessTokenClaims {
    sub: String,
    typ: String,
    #[serde(rename = "iat")]
    _iat: u64,
    exp: u64,
}

#[derive(Debug)]
struct VerifiedAccessToken {
    user_id: u64,
    expires_at: OffsetDateTime,
}

pub(crate) struct AuthenticatedConnection {
    pub(crate) socket: WebSocket,
    pub(crate) user_id: u64,
    pub(crate) connection_id: String,
    pub(crate) access_token_expires_at: OffsetDateTime,
}

pub(crate) async fn certification(
    mut socket: WebSocket,
    config: Arc<Config>,
) -> Result<Option<AuthenticatedConnection>> {
    let Some(result) = socket.recv().await else {
        return Ok(None);
    };
    let message = result?;
    let text = match message {
        Message::Text(text) => text,
        Message::Close(_) => return Ok(None),
        Message::Binary(_) | Message::Ping(_) | Message::Pong(_) => {
            frame::close(&mut socket, close_code::POLICY, "invalid auth frame").await;
            return Err(Error::InvalidAuthFrame);
        }
    };
    let frame: AuthFrame =
        serde_json::from_str(text.as_str()).map_err(|_| Error::InvalidAuthFrame)?;
    if frame.frame_type != "auth" {
        let response = frame::Frame::new(
            AUTH_FAILED.to_string(),
            frame.request_id,
            frame::FailedPayload {
                error_code: "invalid_request",
                message: "invalid auth frame",
            },
        );
        frame::send(&mut socket, &response).await?;
        frame::close(&mut socket, close_code::POLICY, "invalid auth frame").await;
        return Err(Error::InvalidAuthFrame);
    }
    let verified =
        match verify_access_token(&frame.payload.access_token, &config.auth_config.jwt_secret) {
            Ok(verified) => verified,
            Err(error) => {
                let (error_code, message) = match &error {
                    Error::AccessTokenExpired => ("token_expired", "access token expired"),
                    Error::InvalidAccessToken => ("invalid_token", "invalid access token"),
                    Error::InvalidAuthFrame => ("invalid_request", "invalid auth frame"),
                    _ => ("internal_error", "internal error"),
                };
                let response = frame::Frame::new(
                    AUTH_FAILED.to_string(),
                    frame.request_id,
                    frame::FailedPayload {
                        error_code,
                        message,
                    },
                );
                frame::send(&mut socket, &response).await?;
                frame::close(&mut socket, close_code::POLICY, message).await;
                return Err(error);
            }
        };
    let connection_id = uuid::Uuid::new_v4().to_string();
    let response = frame::Frame::new(
        AUTH_OK.to_string(),
        frame.request_id,
        AuthOkPayload {
            user_id: verified.user_id,
            connection_id: connection_id.clone(),
            access_token_expires_at: verified.expires_at.to_string(),
        },
    );
    frame::send(&mut socket, &response).await?;
    tracing::debug!(
        request_id = %response.request_id,
        user_id = verified.user_id,
        access_token_expires_at = %verified.expires_at,
        "websocket authentication succeeded"
    );
    Ok(Some(AuthenticatedConnection {
        socket,
        user_id: verified.user_id,
        connection_id,
        access_token_expires_at: verified.expires_at,
    }))
}

fn verify_access_token(token: &str, jwt_secret: &str) -> Result<VerifiedAccessToken> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["sub", "iat", "exp"]);
    let data = decode::<AccessTokenClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|err| match err.kind() {
        ErrorKind::ExpiredSignature => Error::AccessTokenExpired,
        _ => Error::InvalidAccessToken,
    })?;
    let claims = data.claims;
    if claims.typ != "access" {
        return Err(Error::InvalidAccessToken);
    }
    let user_id = claims
        .sub
        .parse::<u64>()
        .map_err(|_| Error::InvalidAccessToken)?;
    let expires_at = OffsetDateTime::from_unix_timestamp(claims.exp as i64)
        .map_err(|_| Error::InvalidAccessToken)?;
    Ok(VerifiedAccessToken {
        user_id,
        expires_at,
    })
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
