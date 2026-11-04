use std::cell::RefCell;

use super::*;

#[test]
fn login_logout_and_relogin_change_residency_without_repeating_native_actions() {
    // 测试目标：验证登录才启用驻留，退出登录先恢复窗口再移除托盘，重复通知幂等。
    // 构造方法：创建默认状态，用回调记录原生动作，依次模拟启动、登录、退出登录和重新登录。
    // 输入数据：main 的 false、true、true、false、false、true、true 登录状态通知。
    // 预期行为：默认和退出登录后不驻留；每次登录后驻留；创建两次，恢复和移除各一次。
    let state = ResidencyState::default();
    let actions = RefCell::new(Vec::new());
    let update = |authenticated| {
        state.update(
            MAIN_WINDOW,
            authenticated,
            |present| {
                actions
                    .borrow_mut()
                    .push(if present { "create" } else { "remove" });
                Ok(())
            },
            || {
                assert!(!state.enabled());
                actions.borrow_mut().push("restore");
                Ok(())
            },
        )
    };
    assert!(!state.enabled());
    update(false).unwrap();
    update(true).unwrap();
    assert!(state.enabled());
    update(true).unwrap();
    update(false).unwrap();
    assert!(!state.enabled());
    update(false).unwrap();
    update(true).unwrap();
    assert!(state.enabled());
    update(true).unwrap();
    assert_eq!(*actions.borrow(), ["create", "restore", "remove", "create"]);
}

#[test]
fn unavailable_tray_never_enables_residency_and_can_be_retried() {
    // 测试目标：验证托盘显示失败时不会拦截关闭，重试成功后才允许驻留。
    // 构造方法：首次模拟托盘不可用，随后提供成功的托盘回调重新提交登录状态。
    // 输入数据：main、true；首次 TrayUnavailable，第二次成功。
    // 预期行为：首次返回稳定错误且未启用驻留，第二次成功并启用；登录不恢复窗口。
    let state = ResidencyState::default();
    assert_eq!(
        state.update(
            MAIN_WINDOW,
            true,
            |_| Err(AuthenticationStateError::TrayUnavailable),
            || panic!("login must not restore the window"),
        ),
        Err(AuthenticationStateError::TrayUnavailable)
    );
    assert!(!state.enabled());
    state
        .update(
            MAIN_WINDOW,
            true,
            |present| {
                assert!(present);
                assert!(!state.enabled());
                Ok(())
            },
            || panic!("login must not restore the window"),
        )
        .unwrap();
    assert!(state.enabled());
}

#[test]
fn failed_logout_recovery_keeps_tray_available_and_is_retryable() {
    // 测试目标：验证隐藏主窗恢复失败时保留托盘入口，且立即禁用驻留并允许恢复重试。
    // 构造方法：先启用驻留，再让退出登录时的主窗恢复失败，随后重试成功。
    // 输入数据：main、true，然后 false；首次恢复返回 MainWindowRestoreFailed。
    // 预期行为：失败时不调用托盘移除；驻留已关闭；重试恢复成功后移除托盘。
    let state = ResidencyState::default();
    state
        .update(MAIN_WINDOW, true, |_| Ok(()), || Ok(()))
        .unwrap();
    assert_eq!(
        state.update(
            MAIN_WINDOW,
            false,
            |_| panic!("tray must remain available when window recovery fails"),
            || Err(AuthenticationStateError::MainWindowRestoreFailed),
        ),
        Err(AuthenticationStateError::MainWindowRestoreFailed)
    );
    assert!(!state.enabled());
    let restored = RefCell::new(false);
    state
        .update(
            MAIN_WINDOW,
            false,
            |present| {
                assert!(*restored.borrow());
                assert!(!present);
                Ok(())
            },
            || {
                *restored.borrow_mut() = true;
                Ok(())
            },
        )
        .unwrap();
    assert!(!state.enabled());
}

#[test]
fn failed_tray_removal_does_not_reenable_residency_and_can_be_retried() {
    // 测试目标：验证退出登录时移除托盘失败不会重新启用驻留，重复通知能完成恢复。
    // 构造方法：先启用驻留，首次退出登录模拟托盘更新失败，再提交同一退出登录状态。
    // 输入数据：main、true、false、false，首次移除返回 TrayUpdateFailed。
    // 预期行为：失败返回稳定错误且关闭驻留；重试隐藏成功，后续相同通知不再执行原生动作。
    let state = ResidencyState::default();
    state
        .update(MAIN_WINDOW, true, |_| Ok(()), || Ok(()))
        .unwrap();
    assert_eq!(
        state.update(
            MAIN_WINDOW,
            false,
            |_| Err(AuthenticationStateError::TrayUpdateFailed),
            || Ok(()),
        ),
        Err(AuthenticationStateError::TrayUpdateFailed)
    );
    assert!(!state.enabled());
    state
        .update(MAIN_WINDOW, false, |_| Ok(()), || Ok(()))
        .unwrap();
    state
        .update(
            MAIN_WINDOW,
            false,
            |_| panic!("must not repeat tray update"),
            || panic!("must not repeat window recovery"),
        )
        .unwrap();
}

#[test]
fn viewer_cannot_change_main_residency() {
    // 测试目标：验证图片查看器不能修改主窗口驻留行为，错误不会触发任何原生操作。
    // 构造方法：创建默认状态，通过 image-viewer 标签分别请求启用和禁用驻留。
    // 输入数据：image-viewer、true 和 false。
    // 预期行为：均返回 OperationNotAllowed，原生回调不执行，默认驻留保持禁用。
    let state = ResidencyState::default();
    for authenticated in [true, false] {
        assert_eq!(
            state.update(
                "image-viewer",
                authenticated,
                |_| panic!("unauthorized tray update"),
                || panic!("unauthorized window recovery"),
            ),
            Err(AuthenticationStateError::OperationNotAllowed)
        );
    }
    assert!(!state.enabled());
}

#[test]
fn authentication_errors_have_stable_serialized_codes() {
    // 测试目标：验证前端收到稳定错误码而非底层原生错误详情。
    // 构造方法：序列化身份校验、托盘、窗口恢复和状态错误并与约定字符串比较。
    // 输入数据：AuthenticationStateError 各个错误变体。
    // 预期行为：每个变体序列化为 snake_case 字符串。
    for (error, code) in [
        (
            AuthenticationStateError::OperationNotAllowed,
            "operation_not_allowed",
        ),
        (
            AuthenticationStateError::TrayUnavailable,
            "tray_unavailable",
        ),
        (
            AuthenticationStateError::TrayUpdateFailed,
            "tray_update_failed",
        ),
        (
            AuthenticationStateError::MainWindowUnavailable,
            "main_window_unavailable",
        ),
        (
            AuthenticationStateError::MainWindowRestoreFailed,
            "main_window_restore_failed",
        ),
        (
            AuthenticationStateError::LifecycleStateUnavailable,
            "lifecycle_state_unavailable",
        ),
    ] {
        assert_eq!(serde_json::to_value(error).unwrap(), code);
    }
}
