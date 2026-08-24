use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("read config file {path}: {source}")]
    ReadConfig {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("parse config file {path}: {source}")]
    ParseConfig {
        path: String,
        #[source]
        source: toml::de::Error,
    },

    #[error("bind listener {addr}: {source}")]
    BindListener {
        addr: String,
        #[source]
        source: std::io::Error,
    },

    #[error("serve application: {source}")]
    Serve {
        #[source]
        source: std::io::Error,
    },

    #[error("read websocket frame: {0}")]
    WebSocketReceive(#[from] axum::Error),

    #[error("invalid auth frame")]
    InvalidAuthFrame,

    #[error("access token expired")]
    AccessTokenExpired,

    #[error("invalid access token")]
    InvalidAccessToken,

    #[error("serialize: {source}")]
    Serialize {
        #[source]
        source: serde_json::Error,
    },

    #[error("send websocket frame: {source}")]
    WebSocketSend {
        #[source]
        source: axum::Error,
    },

    #[error("redis error: {source}")]
    Redis {
        #[source]
        source: redis::RedisError,
    },
}
