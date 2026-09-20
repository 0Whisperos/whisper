use crate::error::{Error, Result};
use serde::Deserialize;
use std::fs;

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
    #[serde(rename = "mysql")]
    pub(crate) mysql_config: MysqlConfig,
    #[serde(rename = "kafka")]
    pub(crate) kafka_config: KafkaConfig,
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

#[derive(Debug, Deserialize)]
pub(crate) struct MysqlConfig {
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) ip: String,
    pub(crate) port: u16,
    pub(crate) db: String,
    pub(crate) max_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct KafkaConfig {
    pub(crate) bootstrap_servers: String,
    pub(crate) topic: String,
    pub(crate) group_id: String,
    pub(crate) username: String,
    pub(crate) password: String,
}

pub(crate) fn load_config() -> Result<Config> {
    let path = "config.toml";
    let content = fs::read_to_string(path).map_err(|source| Error::ReadConfig {
        path: path.to_string(),
        source,
    })?;
    let config: Config = toml::from_str(content.as_str()).map_err(|source| Error::ParseConfig {
        path: path.to_string(),
        source,
    })?;
    Ok(config)
}
