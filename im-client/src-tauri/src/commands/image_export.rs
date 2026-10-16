use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachment_cache::AttachmentCache;
use crate::image_actions::{self, ImageTarget, SaveResult};
use crate::image_error::ImageError;
use crate::image_viewer::ViewerStore;

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn save_chat_image(
    app: AppHandle,
    window: WebviewWindow,
    cache: State<'_, AttachmentCache>,
    store: State<'_, ViewerStore>,
    target: ImageTarget,
) -> Result<SaveResult, ImageError> {
    let caller = window.label().to_owned();
    let key = image_actions::resolve_target(&caller, &target, &store)?;
    let cache = cache
        .root_for_app(&app)
        .map_err(|_| ImageError::ImageUnavailable)?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = image_actions::read_target(&cache, &key)?;
        let name = image_actions::suggested_name(&key, &image)?;
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("下载原图")
            .set_file_name(&name)
            .save_file();
        if path.is_some() {
            // Logout/replacement while the native dialog was open revokes a viewer target.
            image_actions::resolve_target(&caller, &target, &app.state::<ViewerStore>())?;
        }
        image_actions::save_to(&image, path.as_deref())
    })
    .await
    .map_err(|_| ImageError::SaveFailed)?
}
