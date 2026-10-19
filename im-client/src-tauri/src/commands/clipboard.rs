use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachment_cache::AttachmentCache;
use crate::image_actions::{self, ImageTarget};
use crate::image_error::ImageError;
use crate::image_viewer::ViewerStore;
use crate::message_clipboard::{self, ClipboardBlock};

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn copy_chat_image(
    app: AppHandle,
    window: WebviewWindow,
    cache: State<'_, AttachmentCache>,
    store: State<'_, ViewerStore>,
    target: ImageTarget,
) -> Result<(), ImageError> {
    let caller = window.label().to_owned();
    let key = image_actions::resolve_target(&caller, &target, &store)?;
    let cache = cache
        .root_for_app(&app)
        .map_err(|_| ImageError::ImageUnavailable)?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = image_actions::read_target(&cache, &key)?;
        image_actions::resolve_target(&caller, &target, &app.state::<ViewerStore>())?;
        image_actions::copy(&image)
    })
    .await
    .map_err(|_| ImageError::ClipboardWriteFailed)?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn write_chat_message_clipboard(
    app: AppHandle,
    window: WebviewWindow,
    cache: State<'_, AttachmentCache>,
    api_base_url: String,
    user_id: u64,
    conversation_id: u64,
    blocks: Vec<ClipboardBlock>,
) -> Result<(), ImageError> {
    super::image_viewer::require_main(&window)?;
    let cache = cache
        .root_for_app(&app)
        .map_err(|_| ImageError::ImageUnavailable)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = message_clipboard::prepare(blocks, |id| {
            cache.read_image(&api_base_url, user_id, conversation_id, id)
        })?;
        message_clipboard::write(output)
    })
    .await
    .map_err(|_| ImageError::ClipboardWriteFailed)?
}

#[derive(serde::Serialize)]
pub(crate) struct ClipboardHtml {
    html: Option<String>,
}

#[tauri::command]
pub(crate) async fn read_chat_clipboard_html(
    window: WebviewWindow,
) -> Result<ClipboardHtml, ImageError> {
    super::image_viewer::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        crate::platform::clipboard::with_clipboard(ImageError::ClipboardReadFailed, |clipboard| {
            let html = clipboard.get().html().ok();
            if let Some(value) = &html {
                message_clipboard::check_html_size(value)?;
            }
            Ok(ClipboardHtml { html })
        })
    })
    .await
    .map_err(|_| ImageError::ClipboardReadFailed)?
}
