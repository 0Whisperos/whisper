use std::future::Future;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use sqlx::MySqlPool;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::error::{Error, Result};
use crate::presence::PresenceManager;
use crate::heartbeat;
use crate::kafka::KafkaServiceError;

use super::bootstrap::PreparedApp;
use super::server;

const SERVER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

struct RunningTasks {
    shutdown_tx: watch::Sender<bool>,
    server_task: JoinHandle<io::Result<()>>,
    consumer_task: JoinHandle<std::result::Result<(), KafkaServiceError>>,
    heartbeat_task: JoinHandle<()>,
    server_finished: bool,
    consumer_finished: bool,
}

pub(super) async fn run(prepared: PreparedApp) -> Result<()> {
    let mysql_pool = prepared.state.mysql_pool.clone();
    let presence = prepared.state.presence.clone();
    let node_id = prepared.state.config.node_config.node_id.clone();
    let mut tasks = RunningTasks::start(prepared).await;
    let outcome = tasks.wait_for_exit(tokio::signal::ctrl_c()).await;
    tasks.shutdown(outcome, &mysql_pool, presence.clone(), node_id).await
}

impl RunningTasks {
    async fn start(prepared: PreparedApp) -> Self {
        let PreparedApp {
            state,
            listener,
            consumer,
        } = prepared;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let mut server_shutdown = shutdown_rx.clone();
        let app = server::build_router(state.clone());
        let server_task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = server_shutdown.wait_for(|stopping| *stopping).await;
                })
                .await
        });
        let consumer_task = tokio::spawn(consumer.run(shutdown_rx));
        let heartbeat_task =
            heartbeat::node::spawn(state.presence, state.config.node_config.node_id.clone()).await;
        tracing::info!(node_id = %state.config.node_config.node_id, "chat server and kafka consumer started");
        Self {
            shutdown_tx,
            server_task,
            consumer_task,
            heartbeat_task,
            server_finished: false,
            consumer_finished: false,
        }
    }

    async fn wait_for_exit(
        &mut self,
        shutdown_signal: impl Future<Output = io::Result<()>>,
    ) -> Result<()> {
        tokio::select! {
            signal = shutdown_signal => signal.map_err(|source| Error::Serve { source }),
            result = &mut self.server_task => {
                self.server_finished = true;
                match result {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(source)) => Err(Error::Serve { source }),
                    Err(error) => {
                        tracing::error!(%error, "websocket server task failed");
                        Err(Error::BackgroundTask { task: "websocket server" })
                    }
                }
            }
            result = &mut self.consumer_task => {
                self.consumer_finished = true;
                tracing::error!(?result, "kafka consumer stopped unexpectedly");
                Err(Error::BackgroundTask { task: "kafka consumer" })
            }
        }
    }

    async fn shutdown(mut self, outcome: Result<()>, mysql_pool: &MySqlPool, presence: Arc<PresenceManager>, node_id: String) -> Result<()> {
        let _ = self.shutdown_tx.send(true);
        self.heartbeat_task.abort();
        let _ = self.heartbeat_task.await;
        let _ = presence.remove_node(&node_id).await;
        // 同步 offset 提交开始后必须等待结束，不能丢弃仍持有消费者的阻塞任务。
        let mut cleanup_error = None;
        if !self.consumer_finished {
            match self.consumer_task.await {
                Ok(Ok(())) => {}
                result => {
                    tracing::error!(?result, "kafka consumer shutdown failed");
                    cleanup_error = Some(Error::BackgroundTask {
                        task: "kafka consumer",
                    });
                }
            }
        }
        if !self.server_finished {
            match tokio::time::timeout(SERVER_SHUTDOWN_TIMEOUT, &mut self.server_task).await {
                Ok(Ok(Ok(()))) => {}
                Ok(result) => tracing::warn!(?result, "websocket server shutdown failed"),
                Err(_) => {
                    tracing::debug!("stop waiting for websocket connections during shutdown");
                    self.server_task.abort();
                    let _ = self.server_task.await;
                }
            }
        }
        mysql_pool.close().await;
        outcome.and(match cleanup_error {
            Some(error) => Err(error),
            None => Ok(()),
        })
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
