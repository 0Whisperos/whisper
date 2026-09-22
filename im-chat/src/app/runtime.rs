use std::sync::Arc;

use sqlx::MySqlPool;

use crate::config;
use crate::connection::ConnectionRegistry;
use crate::error::Result;
use crate::presence::PresenceManager;

use super::{bootstrap, lifecycle};

#[derive(Clone)]
pub(super) struct AppState {
    pub(super) config: Arc<config::Config>,
    pub(super) presence: Arc<PresenceManager>,
    pub(super) connections: ConnectionRegistry,
    pub(super) mysql_pool: MySqlPool,
}

pub async fn run() -> Result<()> {
    let config = Arc::new(config::load_config()?);
    init_logging(&config);

    let prepared = bootstrap::prepare(config).await?;
    lifecycle::run(prepared).await
}

fn init_logging(config: &config::Config) {
    tracing_subscriber::fmt()
        .with_env_filter(config.logging_config.level.as_str())
        .init();
}
