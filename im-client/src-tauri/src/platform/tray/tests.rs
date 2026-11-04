use std::sync::mpsc;

use super::*;

#[test]
fn watchdog_exits_without_frontend_acknowledgement() {
    // 测试目标：验证前端没有确认时，原生 watchdog 仍会触发退出。
    // 构造方法：创建退出状态及通道，启动短超时 watchdog 并等待其线程完成。
    // 输入数据：1 毫秒超时，不调用主窗口确认。
    // 预期行为：退出回调恰好发送一次通知，之后不能再次确认退出。
    let state = ExitState::default();
    let (sender, receiver) = mpsc::channel();
    state
        .request(Duration::from_millis(1), move || sender.send(()).unwrap())
        .unwrap()
        .join()
        .unwrap();
    assert_eq!(receiver.try_recv(), Ok(()));
    assert!(receiver.try_recv().is_err());
    assert_eq!(
        state.complete(MAIN_WINDOW),
        Err(ExitError::ExitNotRequested)
    );
}

#[test]
fn main_acknowledgement_prevents_second_watchdog_exit() {
    // 测试目标：验证主窗口完成清理后，watchdog 不会再次退出。
    // 构造方法：用通道替代 watchdog 等待时钟；先由主窗口确认，再释放等待并结束线程。
    // 输入数据：主窗口标签 main 及受通道控制的等待函数。
    // 预期行为：确认成功，watchdog 完成但不调用退出回调，重复确认失败。
    let state = ExitState::default();
    let (sender, receiver) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let watchdog = state
        .request_after(
            move || wait.recv().unwrap(),
            move || sender.send(()).unwrap(),
        )
        .unwrap();
    assert_eq!(state.complete(MAIN_WINDOW), Ok(()));
    release.send(()).unwrap();
    watchdog.join().unwrap();
    assert!(receiver.try_recv().is_err());
    assert_eq!(
        state.complete(MAIN_WINDOW),
        Err(ExitError::ExitNotRequested)
    );
}

#[test]
fn duplicate_exit_requests_do_not_restart_watchdog() {
    // 测试目标：验证多个退出请求共享状态，仅第一个请求能启动退出流程。
    // 构造方法：克隆共享状态，用通道暂停第一次 watchdog，尝试重复请求后释放线程。
    // 输入数据：首次受通道控制的等待函数；重复请求超时 30 秒且回调会 panic。
    // 预期行为：第二次请求被忽略，第一次照常退出，已完成状态不能重新发起请求。
    let state = ExitState::default();
    let other = state.clone();
    let (sender, receiver) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let watchdog = state
        .request_after(
            move || wait.recv().unwrap(),
            move || sender.send(()).unwrap(),
        )
        .unwrap();
    assert!(other
        .request(Duration::from_secs(30), || panic!("duplicate exit"))
        .is_none());
    release.send(()).unwrap();
    watchdog.join().unwrap();
    assert_eq!(receiver.try_recv(), Ok(()));
    assert!(state.request(Duration::ZERO, || {}).is_none());
}

#[test]
fn only_main_can_acknowledge_an_existing_exit_request() {
    // 测试目标：验证窗口身份及已请求退出的前置条件均不可绕过。
    // 构造方法：先验证空闲状态，再发起请求；受通道控制的 watchdog 在主窗口确认后释放。
    // 输入数据：main、image-viewer 及受通道控制的等待函数。
    // 预期行为：未请求时拒绝；查看器被拒绝且不消耗请求；主窗口最终确认成功。
    let state = ExitState::default();
    assert_eq!(
        state.complete(MAIN_WINDOW),
        Err(ExitError::ExitNotRequested)
    );
    let (release, wait) = mpsc::channel();
    let watchdog = state
        .request_after(
            move || wait.recv().unwrap(),
            || panic!("main should confirm"),
        )
        .unwrap();
    assert_eq!(
        state.complete("image-viewer"),
        Err(ExitError::OperationNotAllowed)
    );
    assert_eq!(state.complete(MAIN_WINDOW), Ok(()));
    release.send(()).unwrap();
    watchdog.join().unwrap();
}
