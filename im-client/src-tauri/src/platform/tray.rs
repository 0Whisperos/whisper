use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Window, WindowEvent,
};

mod residency;

pub(crate) use residency::{AuthenticationStateError, ResidencyState};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "whisper-tray";
const OPEN_MENU: &str = "tray-open";
const EXIT_MENU: &str = "tray-exit";
const EXIT_TIMEOUT: Duration = Duration::from_secs(5);
const RUNNING: u8 = 0;
const EXIT_REQUESTED: u8 = 1;
const EXIT_COMPLETED: u8 = 2;

#[derive(Debug, thiserror::Error)]
pub(crate) enum SetupError {
    #[error("application icon is missing; cannot create system tray")]
    MissingIcon,
    #[error("failed to create system tray: {0}")]
    Tray(#[from] tauri::Error),
}

/// Stable IPC errors do not expose native implementation details.
#[derive(Debug, Clone, Copy, Serialize, thiserror::Error, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExitError {
    #[error("operation_not_allowed")]
    OperationNotAllowed,
    #[error("exit_not_requested")]
    ExitNotRequested,
}

#[derive(Clone, Default)]
pub(crate) struct ExitState {
    phase: Arc<AtomicU8>,
}

impl ExitState {
    /// Start the independent native watchdog before notifying JavaScript.
    /// Clones share the same transition, so repeated requests cannot restart the deadline.
    fn request(
        &self,
        timeout: Duration,
        exit: impl FnOnce() + Send + 'static,
    ) -> Option<JoinHandle<()>> {
        self.request_after(move || thread::sleep(timeout), exit)
    }

    fn request_after(
        &self,
        wait: impl FnOnce() + Send + 'static,
        exit: impl FnOnce() + Send + 'static,
    ) -> Option<JoinHandle<()>> {
        self.phase
            .compare_exchange(RUNNING, EXIT_REQUESTED, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        let state = self.clone();
        Some(thread::spawn(move || {
            wait();
            if state.claim_exit().is_ok() {
                exit();
            }
        }))
    }

    pub(crate) fn complete(&self, window_label: &str) -> Result<(), ExitError> {
        if window_label != MAIN_WINDOW {
            return Err(ExitError::OperationNotAllowed);
        }
        self.claim_exit()
    }

    fn claim_exit(&self) -> Result<(), ExitError> {
        self.phase
            .compare_exchange(
                EXIT_REQUESTED,
                EXIT_COMPLETED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map(|_| ())
            .map_err(|_| ExitError::ExitNotRequested)
    }
}

pub(crate) fn setup(app: &App) -> Result<(), SetupError> {
    app.default_window_icon().ok_or(SetupError::MissingIcon)?;
    // Menu handlers are global in Tauri. Register once rather than once per login.
    app.on_menu_event(|app, event| match event.id.as_ref() {
        OPEN_MENU => restore_main(app),
        EXIT_MENU => request_exit(app),
        _ => {}
    });
    Ok(())
}

fn create_tray(app: &AppHandle) -> Result<(), SetupError> {
    let icon = app
        .default_window_icon()
        .ok_or(SetupError::MissingIcon)?
        .clone();
    let open = MenuItem::with_id(app, OPEN_MENU, "打开 Whisper", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, EXIT_MENU, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Whisper")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn set_tray_present(app: &AppHandle, present: bool) -> Result<(), AuthenticationStateError> {
    let native_app = app.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    // tray-icon's final Drop must run on the UI thread, just like its creation.
    app.run_on_main_thread(move || {
        let result = if present {
            if native_app.tray_by_id(TRAY_ID).is_some() {
                Ok(())
            } else {
                create_tray(&native_app).map_err(|error| {
                    eprintln!("failed to create authenticated system tray: {error}");
                    match error {
                        SetupError::MissingIcon => AuthenticationStateError::TrayUnavailable,
                        SetupError::Tray(_) => AuthenticationStateError::TrayUpdateFailed,
                    }
                })
            }
        } else {
            // Do not hide first: Windows tray-icon 0.24.1 deletes on hide and again
            // on Drop. Removing the visible icon directly performs one deletion.
            drop(native_app.remove_tray_by_id(TRAY_ID));
            Ok(())
        };
        let _ = sender.send(result);
    })
    .map_err(|error| {
        eprintln!("failed to schedule system tray update: {error}");
        AuthenticationStateError::TrayUpdateFailed
    })?;
    receiver
        .recv()
        .map_err(|_| AuthenticationStateError::TrayUpdateFailed)?
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == MAIN_WINDOW
        && window.state::<ResidencyState>().enabled()
        && window.app_handle().tray_by_id(TRAY_ID).is_some()
    {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("failed to hide main window: {error}");
            }
        }
    }
}

pub(crate) fn set_authenticated(
    app: &AppHandle,
    state: &ResidencyState,
    window_label: &str,
    authenticated: bool,
) -> Result<(), AuthenticationStateError> {
    state.update(
        window_label,
        authenticated,
        |present| set_tray_present(app, present),
        || {
            let window = app
                .get_webview_window(MAIN_WINDOW)
                .ok_or(AuthenticationStateError::MainWindowUnavailable)?;
            let result = window.is_visible().and_then(|visible| {
                if visible {
                    Ok(())
                } else {
                    window
                        .show()
                        .and_then(|_| window.unminimize())
                        .and_then(|_| window.set_focus())
                }
            });
            result.map_err(|error| {
                eprintln!("failed to restore unauthenticated main window: {error}");
                AuthenticationStateError::MainWindowRestoreFailed
            })
        },
    )
}

fn restore_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let Err(error) = window
            .show()
            .and_then(|_| window.unminimize())
            .and_then(|_| window.set_focus())
        {
            eprintln!("failed to restore main window: {error}");
        }
    }
}

fn request_exit(app: &AppHandle) {
    let timeout_app = app.clone();
    let state = app.state::<ExitState>();
    if state
        .request(EXIT_TIMEOUT, move || timeout_app.exit(0))
        .is_some()
    {
        // The watchdog also handles an absent or unresponsive main WebView.
        if let Err(error) = app.emit_to(MAIN_WINDOW, "app-exit-requested", ()) {
            eprintln!("failed to notify main window of exit: {error}");
        }
    }
}

#[cfg(test)]
mod tests;
