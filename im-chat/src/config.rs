use std::fs;
use serde::Deserialize;
use crate::error::{Error, Result};

#[derive(Debug, Deserialize)]
pub(crate) struct Config {
    pub(crate) server_config: ServerConfig,
    pub(crate) auth_config: AuthConfig,
    pub(crate) logging_config: LoggingConfig
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
