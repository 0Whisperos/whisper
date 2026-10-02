//! HMAC signing and verification for the internal HTTP endpoints.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const NODE_ID_HEADER: &str = "X-Whisper-Node-Id";
const TIMESTAMP_HEADER: &str = "X-Whisper-Timestamp";
const SIGNATURE_HEADER: &str = "X-Whisper-Signature";
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_CLOCK_SKEW_SECS: u64 = 30;

/// The node ID is signed along with the routing fields, so logs can attribute
/// authenticated requests without trusting an unsigned header.
pub(crate) fn sign(
    secret: &str,
    node_id: &str,
    method: &str,
    path: &str,
    timestamp: &str,
    body: &[u8],
) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    update_mac(&mut mac, node_id, method, path, timestamp, body);
    let bytes = mac.finalize().into_bytes();
    let mut signature = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(&mut signature, "{byte:02x}").expect("writing to a String cannot fail");
    }
    signature
}

fn update_mac(
    mac: &mut Hmac<Sha256>,
    node_id: &str,
    method: &str,
    path: &str,
    timestamp: &str,
    body: &[u8],
) {
    // Length-prefix each text field to avoid ambiguous concatenations.
    for field in [node_id, method, path, timestamp] {
        mac.update(&(field.len() as u64).to_be_bytes());
        mac.update(field.as_bytes());
    }
    mac.update(&(body.len() as u64).to_be_bytes());
    mac.update(body);
}

pub(crate) async fn verify_signature(
    axum::extract::State(secret): axum::extract::State<String>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let (parts, body) = request.into_parts();
    let body = to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE)?;
    let node_id = header(&parts.headers, NODE_ID_HEADER)?;
    let timestamp = header(&parts.headers, TIMESTAMP_HEADER)?;
    let signature = header(&parts.headers, SIGNATURE_HEADER)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StatusCode::UNAUTHORIZED)?
        .as_secs();
    verify_at(
        &secret,
        node_id,
        parts.method.as_str(),
        parts.uri.path(),
        timestamp,
        &body,
        signature,
        now,
    )?;
    Ok(next.run(Request::from_parts(parts, Body::from(body))).await)
}

fn header<'a>(headers: &'a axum::http::HeaderMap, name: &str) -> Result<&'a str, StatusCode> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or(StatusCode::UNAUTHORIZED)
}

#[allow(clippy::too_many_arguments)]
fn verify_at(
    secret: &str,
    node_id: &str,
    method: &str,
    path: &str,
    timestamp: &str,
    body: &[u8],
    signature: &str,
    now: u64,
) -> Result<(), StatusCode> {
    let sent_at: u64 = timestamp.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    if now.abs_diff(sent_at) > MAX_CLOCK_SKEW_SECS {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let raw_signature = decode_signature(signature).ok_or(StatusCode::UNAUTHORIZED)?;
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    update_mac(&mut mac, node_id, method, path, timestamp, body);
    mac.verify_slice(&raw_signature)
        .map_err(|_| StatusCode::UNAUTHORIZED)
}

fn decode_signature(signature: &str) -> Option<[u8; 32]> {
    if signature.len() != 64 {
        return None;
    }
    let mut result = [0u8; 32];
    for (index, pair) in signature.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char).to_digit(16)?;
        let low = (pair[1] as char).to_digit(16)?;
        result[index] = ((high << 4) | low) as u8;
    }
    Some(result)
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
