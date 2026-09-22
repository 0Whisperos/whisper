#[path = "consumer_tests_broker.rs"]
mod broker;
#[path = "consumer_tests_protocol.rs"]
mod protocol;
#[path = "consumer_tests_support.rs"]
mod support;

use std::sync::Mutex;

use super::*;
use support::{Effects, Source, record};

#[tokio::test]
async fn new_event_delivers_marks_then_commits_only_its_partition() {
    // 测试目标：验证未处理事件严格按投递、标记、提交的顺序完成。
    // 构造方法：使用合法record和记录副作用顺序的内存依赖执行真实处理函数。
    // 输入数据：分区2、offset=41的message_created v1，Redis没有完成记录。
    // 预期行为：调用顺序check→deliver→mark→commit，仅提交分区2的offset=42。
    let (_sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Complete
    );
    let state = effects.0.lock().unwrap();
    assert_eq!(state.calls, ["check", "deliver", "mark", "commit"]);
    assert_eq!(state.committed, [(2, 42)]);
}

#[tokio::test]
async fn completed_event_skips_delivery_without_refreshing_its_ttl() {
    // 测试目标：验证重复事件只查询完成记录并提交，不再次投递或刷新去重窗口。
    // 构造方法：预先将合法record的event_id放入内存完成集合。
    // 输入数据：已标记完成的同一事件。
    // 预期行为：只执行check和commit，已完成状态保持不变。
    let record = record();
    let (_sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects
        .0
        .lock()
        .unwrap()
        .completed
        .insert(record.parse().unwrap().event_id);
    assert_eq!(
        handle_record(&record, &effects, &mut shutdown).await,
        HandleOutcome::Complete
    );
    assert_eq!(effects.0.lock().unwrap().calls, ["check", "commit"]);
}

#[tokio::test(start_paused = true)]
async fn completion_write_retries_do_not_repeat_delivery() {
    // 测试目标：验证推送决策成功后Redis写入失败只重试完成标记。
    // 构造方法：让mark前两次失败、第三次成功，使用暂停时钟观察退避。
    // 输入数据：未处理事件，两次模拟Redis写入故障。
    // 预期行为：仅投递一次，分别等待1秒和2秒后标记成功，再提交offset。
    let (_sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects.0.lock().unwrap().failures.insert("mark", 2);
    let start = tokio::time::Instant::now();
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Complete
    );
    assert_eq!(tokio::time::Instant::now() - start, Duration::from_secs(3));
    assert_eq!(
        effects.0.lock().unwrap().calls,
        ["check", "deliver", "mark", "mark", "mark", "commit"]
    );
}

#[tokio::test(start_paused = true)]
async fn dependency_failures_exhaust_budget_without_committing() {
    // 测试目标：验证Redis查询、投递准备或完成标记持续失败都不提前提交。
    // 构造方法：分别使check/deliver/mark一直失败，调用真实60秒重试状态机。
    // 输入数据：同一合法事件，指定阶段连续模拟100次依赖故障。
    // 预期行为：60秒后要求重建；没有commit；进入mark后不会再次deliver。
    for stage in ["check", "deliver", "mark"] {
        let (_sender, mut shutdown) = watch::channel(false);
        let effects = Effects::default();
        effects.0.lock().unwrap().failures.insert(stage, 100);
        let start = tokio::time::Instant::now();
        assert_eq!(
            handle_record(&record(), &effects, &mut shutdown).await,
            HandleOutcome::Rebuild
        );
        assert_eq!(tokio::time::Instant::now() - start, Duration::from_secs(60));
        let state = effects.0.lock().unwrap();
        assert!(state.committed.is_empty());
        assert!(!state.calls.contains(&"commit"));
        assert_eq!(state.calls.iter().filter(|call| **call == stage).count(), 6);
        if stage == "mark" {
            assert_eq!(
                state
                    .calls
                    .iter()
                    .filter(|call| **call == "deliver")
                    .count(),
                1
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn stalled_dependency_is_cancelled_at_processing_deadline() {
    // 测试目标：验证没有返回错误但一直挂起的依赖也受处理预算约束。
    // 构造方法：令投递准备Future永不完成，暂停时钟驱动超时。
    // 输入数据：合法事件，deliver阶段永久挂起。
    // 预期行为：60秒后返回Rebuild，不标记、不提交。
    let (_sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects.0.lock().unwrap().hang = Some("deliver");
    let start = tokio::time::Instant::now();
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Rebuild
    );
    assert_eq!(tokio::time::Instant::now() - start, Duration::from_secs(60));
    assert_eq!(effects.0.lock().unwrap().calls, ["check", "deliver"]);
}

#[tokio::test]
async fn committed_marker_survives_commit_failure_and_prevents_replay_delivery() {
    // 测试目标：验证写入完成标记后Kafka提交失败，恢复读取不会重新投递。
    // 构造方法：第一次commit模拟失败，随后使用同一Redis完成集合重新处理该record。
    // 输入数据：相同event_id、分区和offset连续处理两次。
    // 预期行为：第一次要求重建，第二次仅查询并提交；整个过程只投递一次且不删除标记。
    let (_sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects.0.lock().unwrap().failures.insert("commit", 1);
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Rebuild
    );
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Complete
    );
    let state = effects.0.lock().unwrap();
    assert_eq!(
        state.calls,
        ["check", "deliver", "mark", "commit", "check", "commit"]
    );
    assert_eq!(state.completed.len(), 1);
    assert_eq!(state.committed, [(2, 42)]);
}

#[tokio::test(start_paused = true)]
async fn failed_record_stops_consumption_before_the_next_offset() {
    // 测试目标：验证消费循环遇到未完成记录后不会读取或提交更高位置。
    // 构造方法：将offset41和42放入输入源，令第一个事件投递准备持续失败。
    // 输入数据：同分区两条record，deliver依赖持续失败。
    // 预期行为：循环返回Rebuild，第二条record仍在输入源中，没有任何offset提交。
    let (_sender, mut shutdown) = watch::channel(false);
    let mut second = record();
    second.position.offset = 42;
    let source = Source(Mutex::new([record(), second].into()));
    let effects = Effects::default();
    effects.0.lock().unwrap().failures.insert("deliver", 100);
    assert_eq!(
        consume(&source, &effects, &mut shutdown).await,
        HandleOutcome::Rebuild
    );
    assert_eq!(source.0.lock().unwrap().len(), 1);
    assert!(effects.0.lock().unwrap().committed.is_empty());
}

#[tokio::test(start_paused = true)]
async fn commit_failure_stops_consumption_before_the_next_record() {
    // 测试目标：验证同步提交失败后立即结束当前消费循环。
    // 构造方法：输入源包含两条record，将第一个commit设置为失败。
    // 输入数据：两个合法事件和一次模拟Kafka提交失败。
    // 预期行为：第二条未被读取，第一个事件保留完成标记供重启去重。
    let (_sender, mut shutdown) = watch::channel(false);
    let source = Source(Mutex::new([record(), record()].into()));
    let effects = Effects::default();
    effects.0.lock().unwrap().failures.insert("commit", 1);
    assert_eq!(
        consume(&source, &effects, &mut shutdown).await,
        HandleOutcome::Rebuild
    );
    assert_eq!(source.0.lock().unwrap().len(), 1);
    assert_eq!(effects.0.lock().unwrap().completed.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn shutdown_cancels_unfinished_processing_without_commit() {
    // 测试目标：验证停机信号可以结束正在等待的业务依赖且不提交未完成事件。
    // 构造方法：使deliver一直挂起，另一任务在1秒后发出shutdown。
    // 输入数据：合法事件及处理中到达的停机信号。
    // 预期行为：返回Shutdown，仅发生check和deliver尝试，没有完成标记或offset提交。
    let (sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects.0.lock().unwrap().hang = Some("deliver");
    let signal = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        sender.send(true).unwrap();
    });
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Shutdown
    );
    signal.await.unwrap();
    assert_eq!(effects.0.lock().unwrap().calls, ["check", "deliver"]);
}

#[tokio::test(start_paused = true)]
async fn shutdown_during_commit_waits_for_the_single_commit_to_finish() {
    // 测试目标：验证已经开始的同步提交不会被60秒预算或停机信号遗弃。
    // 构造方法：将commit延迟120秒，在1秒时发送停机信号，使用暂停时钟。
    // 输入数据：正常事件、进行中的长时间commit和停机信号。
    // 预期行为：等待完整120秒才返回，提交仅执行一次且结果可观察。
    let (sender, mut shutdown) = watch::channel(false);
    let effects = Effects::default();
    effects.0.lock().unwrap().commit_delay = Duration::from_secs(120);
    let signal = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        sender.send(true).unwrap();
    });
    let start = tokio::time::Instant::now();
    assert_eq!(
        handle_record(&record(), &effects, &mut shutdown).await,
        HandleOutcome::Complete
    );
    signal.await.unwrap();
    assert_eq!(
        tokio::time::Instant::now() - start,
        Duration::from_secs(120)
    );
    assert_eq!(effects.0.lock().unwrap().committed, [(2, 42)]);
}
