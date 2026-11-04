use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;

use super::MAIN_WINDOW;

/// Stable IPC failures; platform error details remain in native diagnostics.
#[derive(Debug, Clone, Copy, Serialize, thiserror::Error, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuthenticationStateError {
    #[error("operation_not_allowed")]
    OperationNotAllowed,
    #[error("tray_unavailable")]
    TrayUnavailable,
    #[error("tray_update_failed")]
    TrayUpdateFailed,
    #[error("main_window_unavailable")]
    MainWindowUnavailable,
    #[error("main_window_restore_failed")]
    MainWindowRestoreFailed,
    #[error("lifecycle_state_unavailable")]
    LifecycleStateUnavailable,
}

pub(crate) struct ResidencyState {
    enabled: AtomicBool,
    // None permits retry after a native operation failed. Close handling reads only
    // the atomic flag, so it never blocks the UI thread on an IPC/native operation.
    applied: Mutex<Option<bool>>,
}

impl Default for ResidencyState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            applied: Mutex::new(Some(false)),
        }
    }
}

impl ResidencyState {
    pub(crate) fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub(crate) fn update(
        &self,
        window_label: &str,
        authenticated: bool,
        set_tray_present: impl FnOnce(bool) -> Result<(), AuthenticationStateError>,
        restore_hidden_main: impl FnOnce() -> Result<(), AuthenticationStateError>,
    ) -> Result<(), AuthenticationStateError> {
        if window_label != MAIN_WINDOW {
            return Err(AuthenticationStateError::OperationNotAllowed);
        }
        let mut applied = self
            .applied
            .lock()
            .map_err(|_| AuthenticationStateError::LifecycleStateUnavailable)?;
        if *applied == Some(authenticated) {
            return Ok(());
        }
        *applied = None;
        self.enabled.store(false, Ordering::Release);
        if !authenticated {
            // Recover the login screen before removing the user's tray entry.
            restore_hidden_main()?;
        }
        set_tray_present(authenticated)?;
        self.enabled.store(authenticated, Ordering::Release);
        *applied = Some(authenticated);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
