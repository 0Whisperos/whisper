use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachment_cache::AttachmentCache;
use crate::image_actions::{self, ImageTarget};
use crate::image_error::ImageError;
use crate::image_viewer::ViewerStore;

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
