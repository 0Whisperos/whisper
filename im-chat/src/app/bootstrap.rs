use std::sync::Arc;

use redis::IntoConnectionInfo;
use sqlx::MySqlPool;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio::net::TcpListener;

use crate::config::{Config, MysqlConfig, RedisConfig, ServerConfig};
use crate::connection::ConnectionRegistry;
use crate::delivery::DeliveryService;
use crate::error::{Error, Result};
use crate::kafka::ConsumerService;
use crate::presence::PresenceManager;

use super::AppState;

pub(super) struct PreparedApp {
    pub(super) state: AppState,
    pub(super) listener: TcpListener,
    pub(super) consumer: ConsumerService,
}

pub(super) async fn prepare(config: Arc<Config>) -> Result<PreparedApp> {
    let mysql_pool = connect_mysql(&config.mysql_config).await?;
    let redis_client = create_redis_client(&config.redis_config)?;
    let state = AppState {
        config,
        presence: Arc::new(PresenceManager::new(redis_client.clone())),
        connections: ConnectionRegistry::new(),
        mysql_pool,
    };
    let listener = bind_listener(&state.config.server_config).await?;
    let consumer = create_consumer(&state, redis_client)?;
    register_node(&state).await?;

    Ok(PreparedApp {
        state,
        listener,
        consumer,
    })
}

async fn connect_mysql(config: &MysqlConfig) -> Result<MySqlPool> {
    let options = MySqlConnectOptions::new()
        .username(&config.username)
        .password(&config.password)
        .host(&config.ip)
        .port(config.port)
        .database(&config.db);
    MySqlPoolOptions::new()
        .max_connections(config.max_connections)
        .connect_with(options)
        .await
        .map_err(|source| Error::MySql { source })
}

fn create_redis_client(config: &RedisConfig) -> Result<redis::Client> {
    let settings = redis::RedisConnectionInfo::default()
        .set_db(i64::from(config.db))
        .set_username(&config.username)
        .set_password(&config.password);
    let info = (config.ip.as_str(), config.port)
        .into_connection_info()
        .map_err(|source| Error::Redis { source })?
        .set_redis_settings(settings);
    redis::Client::open(info).map_err(|source| Error::Redis { source })
}

async fn bind_listener(config: &ServerConfig) -> Result<TcpListener> {
    let addr = format!("{}:{}", config.ip, config.port);
    TcpListener::bind(&addr)
        .await
        .map_err(|source| Error::BindListener { addr, source })
}

fn create_consumer(state: &AppState, redis_client: redis::Client) -> Result<ConsumerService> {
    let config = &state.config;
    let delivery = DeliveryService::new(
        state.mysql_pool.clone(),
        state.presence.clone(),
        state.connections.clone(),
        config.node_config.node_id.clone(),
    );
    ConsumerService::new(
        config.kafka_config.clone(),
        &config.node_config.node_id,
        redis_client,
        delivery,
    )
    .map_err(|error| {
        tracing::error!(%error, "failed to initialize kafka consumer");
        Error::KafkaInitialization
    })
}

async fn register_node(state: &AppState) -> Result<()> {
    let node = &state.config.node_config;
    state
        .presence
        .register_node(&node.node_id, &node.public_ws_url, &node.rpc_addr)
        .await
        .map_err(|source| Error::Redis { source })
}
