use tauri::{AppHandle, State, WebviewWindow};

use crate::platform::tray::{self, AuthenticationStateError, ExitError, ExitState, ResidencyState};

/// Only the authenticated main WebView may enable close-to-tray behavior.
#[tauri::command]
pub(crate) fn set_app_authenticated(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ResidencyState>,
    authenticated: bool,
) -> Result<(), AuthenticationStateError> {
    tray::set_authenticated(&app, &state, window.label(), authenticated)
}

/// Only the main WebView may acknowledge cleanup after a native tray exit request.
#[tauri::command]
pub(crate) fn complete_app_exit(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ExitState>,
) -> Result<(), ExitError> {
    state.complete(window.label())?;
    app.exit(0);
    Ok(())
}
