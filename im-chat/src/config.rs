use std::fs;
use serde::Deserialize;
use crate::error::{Error, Result};

#[derive(Debug, Deserialize)]
pub(crate) struct Config {
    #[serde(rename = "server")]
    pub(crate) server_config: ServerConfig,
    #[serde(rename = "auth")]
    pub(crate) auth_config: AuthConfig,
    #[serde(rename = "logging")]
    pub(crate) logging_config: LoggingConfig,
    #[serde(rename = "redis")]
    pub(crate) redis_config: RedisConfig,
    #[serde(rename = "node")]
    pub(crate) node_config: NodeConfig,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServerConfig {
    pub(crate) ip: String,
    pub(crate) port: u16,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthConfig {
    pub(crate) jwt_secret: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LoggingConfig {
    pub(crate) level: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RedisConfig {
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) ip: String,
    pub(crate) port: u16,
    pub(crate) db: u16,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NodeConfig {
    pub(crate) node_id: String,
    pub(crate) public_ws_url: String,
    pub(crate) rpc_addr: String,
}

pub(crate) fn load_config() -> Result<Config> {
    let path = "config.toml";
    let content = fs::read_to_string(path).map_err(|source| Error::ReadConfig {
        path: path.to_string(),
        source,
    })?;
    let config = toml::from_str(content.as_str()).map_err(|source| Error::ParseConfig {
        path: path.to_string(),
        source,
    })?;
    Ok(config)
}
