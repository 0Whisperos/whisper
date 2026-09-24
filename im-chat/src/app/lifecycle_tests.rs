use std::future::{pending, ready};
use std::io;
use std::sync::Arc;
use std::time::Duration;

use sqlx::MySqlPool;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

use super::RunningTasks;
use crate::error::Error;
use crate::kafka::KafkaServiceError;
use crate::presence::PresenceManager;

#[derive(Clone, Copy)]
enum Completion {
    Success,
    Error,
    Panic,
}

enum Behavior {
    Immediately(Completion),
    OnShutdown(Completion),
}

impl Behavior {
    async fn complete(self, mut shutdown: watch::Receiver<bool>) -> Completion {
        match self {
            Self::Immediately(completion) => completion,
            Self::OnShutdown(completion) => {
                shutdown.wait_for(|stopping| *stopping).await.unwrap();
                completion
            }
        }
    }
}

fn lazy_pool() -> MySqlPool {
    MySqlPoolOptions::new().connect_lazy_with(MySqlConnectOptions::new())
}

fn lifecycle_presence() -> Arc<PresenceManager> {
    Arc::new(PresenceManager::new(
        redis::Client::open("redis://127.0.0.1:0").expect("valid Redis URL"),
    ))
}

fn lifecycle_node_id() -> String {
    "lifecycle-test-node".to_owned()
}

fn tasks(server: Behavior, consumer: Behavior) -> RunningTasks {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_shutdown = shutdown_rx.clone();
    RunningTasks {
        shutdown_tx,
        server_task: tokio::spawn(async move {
            match server.complete(server_shutdown).await {
                Completion::Success => Ok(()),
                Completion::Error => Err(io::Error::other("server failure")),
                Completion::Panic => panic!("server panic fixture"),
            }
        }),
        consumer_task: tokio::spawn(async move {
            match consumer.complete(shutdown_rx).await {
                Completion::Success => Ok(()),
                Completion::Error => Err(KafkaServiceError::InvalidOffset),
                Completion::Panic => panic!("consumer panic fixture"),
            }
        }),
        heartbeat_task: tokio::spawn(pending()),
        server_finished: false,
        consumer_finished: false,
    }
}

struct ReclaimedBeforePoolClose {
    pool: MySqlPool,
    reclaimed: Option<oneshot::Sender<bool>>,
}

impl Drop for ReclaimedBeforePoolClose {
    fn drop(&mut self) {
        if let Some(reclaimed) = self.reclaimed.take() {
            let _ = reclaimed.send(!self.pool.is_closed());
        }
    }
}

fn pending_task<T: Send + 'static>(pool: &MySqlPool) -> (JoinHandle<T>, oneshot::Receiver<bool>) {
    let (reclaimed, receiver) = oneshot::channel();
    let guard = ReclaimedBeforePoolClose {
        pool: pool.clone(),
        reclaimed: Some(reclaimed),
    };
    let task = tokio::spawn(async move {
        let _guard = guard;
        pending().await
    });
    (task, receiver)
}

#[tokio::test]
async fn server_exit_is_reported_once_and_remaining_tasks_are_reclaimed() {
    // 测试目标：服务提前成功、报错或 panic 后，监督结果正确且停机不再次等待已完成的句柄。
    // 构造方法：逐项创建立即退出的服务及等待停机的消费者，再执行监督与完整清理。
    // 输入数据：成功、I/O 错误、panic 三种服务退出结果；永不触发的外部停机信号。
    // 预期行为：分别返回成功、Serve、服务 BackgroundTask，清理无二次 await panic 且关闭池。
    for completion in [Completion::Success, Completion::Error, Completion::Panic] {
        let pool = lazy_pool();
        let mut tasks = tasks(
            Behavior::Immediately(completion),
            Behavior::OnShutdown(Completion::Success),
        );
        let outcome = tasks.wait_for_exit(pending()).await;
        match completion {
            Completion::Success => assert!(outcome.is_ok()),
            Completion::Error => assert!(matches!(&outcome, Err(Error::Serve { .. }))),
            Completion::Panic => assert!(matches!(
                &outcome,
                Err(Error::BackgroundTask {
                    task: "websocket server"
                })
            )),
        }
        let failed = outcome.is_err();
        assert_eq!(
            tasks
                .shutdown(outcome, &pool, lifecycle_presence(), lifecycle_node_id())
                .await
                .is_err(),
            failed
        );
        assert!(pool.is_closed());
    }
}

#[tokio::test]
async fn every_unexpected_consumer_exit_is_reported_once() {
    // 测试目标：Kafka 消费者任何提前退出均为运行错误，已监督的句柄不会在清理时重复等待。
    // 构造方法：服务等待停机，消费者逐项立即退出；先监督再回收全部任务。
    // 输入数据：消费者成功、InvalidOffset 和 panic；永不触发的外部停机信号。
    // 预期行为：三种情况都保留 kafka consumer BackgroundTask，服务可退出且池最终关闭。
    for completion in [Completion::Success, Completion::Error, Completion::Panic] {
        let pool = lazy_pool();
        let mut tasks = tasks(
            Behavior::OnShutdown(Completion::Success),
            Behavior::Immediately(completion),
        );
        let outcome = tasks.wait_for_exit(pending()).await;
        assert!(matches!(
            &outcome,
            Err(Error::BackgroundTask {
                task: "kafka consumer"
            })
        ));
        assert!(matches!(
            tasks
                .shutdown(outcome, &pool, lifecycle_presence(), lifecycle_node_id())
                .await,
            Err(Error::BackgroundTask {
                task: "kafka consumer"
            })
        ));
        assert!(pool.is_closed());
    }
}

#[tokio::test]
async fn shutdown_signal_success_and_failure_both_reclaim_running_tasks() {
    // 测试目标：外部停机和停机信号读取失败都能进入清理，并保留原始信号结果。
    // 构造方法：让服务和消费者等待 watch 停机；向监督器注入立即完成的信号 future。
    // 输入数据：成功信号和 PermissionDenied 信号错误，搭配正常退出的后台任务。
    // 预期行为：成功信号返回成功，信号错误保留 Serve 及错误种类；两者都关闭数据库池。
    for signal in [
        Ok(()),
        Err(io::Error::from(io::ErrorKind::PermissionDenied)),
    ] {
        let failed = signal.is_err();
        let pool = lazy_pool();
        let mut tasks = tasks(
            Behavior::OnShutdown(Completion::Success),
            Behavior::OnShutdown(Completion::Success),
        );
        let outcome = tasks.wait_for_exit(ready(signal)).await;
        let result = tasks
            .shutdown(outcome, &pool, lifecycle_presence(), lifecycle_node_id())
            .await;
        if failed {
            assert!(
                matches!(result, Err(Error::Serve { source }) if source.kind() == io::ErrorKind::PermissionDenied)
            );
        } else {
            assert!(result.is_ok());
        }
        assert!(pool.is_closed());
    }
}

#[tokio::test(start_paused = true)]
async fn shutdown_reclaims_heartbeat_then_waits_for_consumer_completion_before_closing_pool() {
    // 测试目标：停机先回收心跳，Kafka 完成中的提交可超过 HTTP 宽限时间，数据库最后关闭。
    // 构造方法：用 oneshot 阻塞消费者完成，用析构探针观察心跳回收；暂停时间后推进三十秒。
    // 输入数据：停机信号、三十秒未完成的模拟提交，以及随后释放的完成门闩。
    // 预期行为：心跳已回收但消费者不被 abort，池持续可用；门闩释放后完成清理并关闭池。
    let pool = lazy_pool();
    let (shutdown_tx, mut consumer_shutdown) = watch::channel(false);
    let mut server_shutdown = consumer_shutdown.clone();
    let (commit_tx, commit_rx) = oneshot::channel();
    let (stopping_tx, stopping_rx) = oneshot::channel();
    let (completed_tx, completed_rx) = oneshot::channel();
    let consumer_pool = pool.clone();
    let consumer_task = tokio::spawn(async move {
        consumer_shutdown
            .wait_for(|stopping| *stopping)
            .await
            .unwrap();
        stopping_tx.send(()).unwrap();
        commit_rx.await.unwrap();
        completed_tx.send(!consumer_pool.is_closed()).unwrap();
        Ok(())
    });
    let server_task = tokio::spawn(async move {
        server_shutdown
            .wait_for(|stopping| *stopping)
            .await
            .unwrap();
        Ok(())
    });
    let (heartbeat_task, heartbeat_reclaimed) = pending_task(&pool);
    let tasks = RunningTasks {
        shutdown_tx,
        server_task,
        consumer_task,
        heartbeat_task,
        server_finished: false,
        consumer_finished: false,
    };
    let shutdown_pool = pool.clone();
    let shutdown = tokio::spawn(async move {
        tasks
            .shutdown(
                Ok(()),
                &shutdown_pool,
                lifecycle_presence(),
                lifecycle_node_id(),
            )
            .await
    });
    stopping_rx.await.unwrap();
    assert!(heartbeat_reclaimed.await.unwrap());
    tokio::time::advance(Duration::from_secs(30)).await;
    assert!(!shutdown.is_finished());
    assert!(!pool.is_closed());
    commit_tx.send(()).unwrap();
    assert!(completed_rx.await.unwrap());
    assert!(shutdown.await.unwrap().is_ok());
    assert!(pool.is_closed());
}

#[tokio::test(start_paused = true)]
async fn stalled_server_is_aborted_and_reclaimed_only_after_five_seconds() {
    // 测试目标：不退出的 WebSocket 服务拥有五秒宽限期，超时后回收任务才关闭数据库池。
    // 构造方法：消费者在停机后立刻完成，服务永久 pending 并持有析构探针；使用暂停时间。
    // 输入数据：正常停机以及累计 4.999 秒、5 秒两个时间边界。
    // 预期行为：五秒前服务仍存活且池未关闭；五秒后服务已析构，随后池关闭并返回成功。
    let pool = lazy_pool();
    let (shutdown_tx, mut consumer_shutdown) = watch::channel(false);
    let (consumer_done_tx, consumer_done_rx) = oneshot::channel();
    let consumer_task = tokio::spawn(async move {
        consumer_shutdown
            .wait_for(|stopping| *stopping)
            .await
            .unwrap();
        consumer_done_tx.send(()).unwrap();
        Ok(())
    });
    let (server_task, mut server_reclaimed) = pending_task(&pool);
    let (heartbeat_task, heartbeat_reclaimed) = pending_task(&pool);
    let tasks = RunningTasks {
        shutdown_tx,
        server_task,
        consumer_task,
        heartbeat_task,
        server_finished: false,
        consumer_finished: false,
    };
    let shutdown_pool = pool.clone();
    let shutdown = tokio::spawn(async move {
        tasks
            .shutdown(
                Ok(()),
                &shutdown_pool,
                lifecycle_presence(),
                lifecycle_node_id(),
            )
            .await
    });
    assert!(heartbeat_reclaimed.await.unwrap());
    consumer_done_rx.await.unwrap();
    tokio::task::yield_now().await;
    let grace_period_started = tokio::time::Instant::now();
    tokio::time::advance(Duration::from_millis(4_999)).await;
    assert!(!shutdown.is_finished());
    assert!(!pool.is_closed());
    assert!(matches!(
        server_reclaimed.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(shutdown.await.unwrap().is_ok());
    assert_eq!(grace_period_started.elapsed(), Duration::from_secs(5));
    assert!(server_reclaimed.await.unwrap());
    assert!(pool.is_closed());
}

#[tokio::test]
async fn running_error_takes_precedence_over_consumer_cleanup_error() {
    // 测试目标：清理阶段消费者失败不会覆盖原始运行错误；没有运行错误时返回清理错误。
    // 构造方法：消费者收到停机后返回 InvalidOffset，分别注入成功及指定 I/O 运行结果。
    // 输入数据：Ok(()) 或 NotConnected 的 Serve 错误，搭配 Kafka 清理失败。
    // 预期行为：分别返回 kafka consumer BackgroundTask 或保留原始 Serve，均完整关闭池。
    for outcome in [
        Ok(()),
        Err(Error::Serve {
            source: io::Error::from(io::ErrorKind::NotConnected),
        }),
    ] {
        let originally_failed = outcome.is_err();
        let pool = lazy_pool();
        let tasks = tasks(
            Behavior::OnShutdown(Completion::Success),
            Behavior::OnShutdown(Completion::Error),
        );
        let result = tasks
            .shutdown(outcome, &pool, lifecycle_presence(), lifecycle_node_id())
            .await;
        if originally_failed {
            assert!(
                matches!(result, Err(Error::Serve { source }) if source.kind() == io::ErrorKind::NotConnected)
            );
        } else {
            assert!(matches!(
                result,
                Err(Error::BackgroundTask {
                    task: "kafka consumer"
                })
            ));
        }
        assert!(pool.is_closed());
    }
}

#[tokio::test]
async fn server_cleanup_failures_preserve_existing_successful_shutdown_behavior() {
    // 测试目标：仅 HTTP 清理阶段失败保持既有警告语义，不改变正常停机的返回结果。
    // 构造方法：监督阶段通过成功信号结束，再让服务在收到停机后报错或 panic。
    // 输入数据：服务 I/O 错误及 panic；正常完成的 Kafka 消费者。
    // 预期行为：HTTP 失败不会阻止资源回收，两种情况均返回成功且关闭数据库池。
    for completion in [Completion::Error, Completion::Panic] {
        let pool = lazy_pool();
        let mut tasks = tasks(
            Behavior::OnShutdown(completion),
            Behavior::OnShutdown(Completion::Success),
        );
        let outcome = tasks.wait_for_exit(ready(Ok(()))).await;
        assert!(
            tasks
                .shutdown(outcome, &pool, lifecycle_presence(), lifecycle_node_id())
                .await
                .is_ok()
        );
        assert!(pool.is_closed());
    }
}
