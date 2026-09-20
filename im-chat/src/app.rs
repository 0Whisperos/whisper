mod bootstrap;
mod lifecycle;
mod server;

use std::sync::Arc;

use sqlx::MySqlPool;

use crate::config;
use crate::connection::ConnectionRegistry;
use crate::error::Result;
use crate::presence::PresenceManager;

#[derive(Clone)]
struct AppState {
    config: Arc<config::Config>,
    presence: Arc<PresenceManager>,
    connections: ConnectionRegistry,
    mysql_pool: MySqlPool,
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
