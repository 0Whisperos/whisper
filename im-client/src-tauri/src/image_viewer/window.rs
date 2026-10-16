use serde::Serialize;
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{ViewerSession, LABEL};
use crate::image_error::ImageError;

/// Owns viewer instance generations independently of global WebView policies.
pub(crate) fn lifecycle_plugin() -> TauriPlugin<tauri::Wry> {
    PluginBuilder::new("image-viewer-lifecycle")
        .on_window_ready(|window| {
            if window.label() == LABEL {
                let generation = uuid::Uuid::new_v4();
                window
                    .state::<super::ViewerStore>()
                    .window_ready(generation);
                let app = window.app_handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        app.state::<super::ViewerStore>()
                            .window_destroyed(generation);
                    }
                });
            }
        })
        .build()
}

pub(crate) fn open_window(app: &AppHandle) -> Result<(), ImageError> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show().map_err(|_| ImageError::ViewerWindowFailed)?;
        window
            .unminimize()
            .map_err(|_| ImageError::ViewerWindowFailed)?;
        window
            .set_focus()
            .map_err(|_| ImageError::ViewerWindowFailed)?;
    } else {
        WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::App("index.html?window=image-viewer".into()),
        )
        .title("图片查看器 — Whisper")
        .decorations(false)
        .resizable(true)
        .maximizable(true)
        .shadow(true)
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 320.0)
        .build()
        .map_err(|_| ImageError::ViewerWindowFailed)?;
    }
    Ok(())
}

async fn native_barrier(app: &AppHandle) -> Result<(), ImageError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(());
    })
    .map_err(|_| ImageError::ViewerWindowFailed)?;
    receiver.await.map_err(|_| ImageError::ViewerWindowFailed)
}

pub(crate) async fn destroy_window(app: &AppHandle) -> Result<(), ImageError> {
    // Flush the previously queued on_window_ready before observing its instance generation.
    native_barrier(app).await?;
    if let Some(window) = app.get_webview_window(LABEL) {
        let store = app.state::<super::ViewerStore>();
        let generation = store.window_generation();
        window
            .destroy()
            .map_err(|_| ImageError::ViewerWindowFailed)?;
        if let Some(generation) = generation {
            store.wait_window_destroyed(generation).await;
        }
        // Hold the command mutation gate until native removal finishes its event callback.
        native_barrier(app).await?;
    }
    Ok(())
}

pub(crate) fn notify_session(app: &AppHandle, session: &ViewerSession) {
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Update<'a> {
        session_id: &'a str,
        version: u64,
    }
    let _ = app.emit_to(
        LABEL,
        "image-viewer-session-updated",
        Update {
            session_id: &session.session_id,
            version: session.version,
        },
    );
}
