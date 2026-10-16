use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachment_cache::AttachmentCache;
use crate::image_error::ImageError;
use crate::image_viewer::{self, SessionState, ViewerImageInput, ViewerSession, ViewerStore};

pub(crate) fn require_main(window: &WebviewWindow) -> Result<(), ImageError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(ImageError::OperationNotAllowed)
    }
}

fn require_viewer(window: &WebviewWindow) -> Result<(), ImageError> {
    if window.label() == image_viewer::LABEL {
        Ok(())
    } else {
        Err(ImageError::OperationNotAllowed)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn prepare_image_viewer_session(
    app: AppHandle,
    window: WebviewWindow,
    cache: State<'_, AttachmentCache>,
    store: State<'_, ViewerStore>,
    api_base_url: String,
    user_id: u64,
    conversation_id: u64,
    images: Vec<ViewerImageInput>,
    selected_image_id: String,
) -> Result<ViewerSession, ImageError> {
    require_main(&window)?;
    image_viewer::validate_images(&images)?;
    let index = images
        .iter()
        .position(|image| image.id == selected_image_id)
        .ok_or(ImageError::InvalidViewerSession)?;
    let cache = cache
        .root_for_app(&app)
        .map_err(|_| ImageError::ImageUnavailable)?;
    let _guard = store.mutation.lock().await;
    let state = tauri::async_runtime::spawn_blocking(move || {
        let selected = cache.read_image(
            &api_base_url,
            user_id,
            conversation_id,
            &images[index].attachment_id,
        )?;
        crate::image_decode::decode(&selected)?;
        let images =
            image_viewer::image_list(&cache, &api_base_url, user_id, conversation_id, images)?;
        if images[index].asset_url.is_none() {
            return Err(ImageError::ImageNotCached);
        }
        Ok::<_, ImageError>(SessionState {
            session: ViewerSession {
                session_id: uuid::Uuid::new_v4().to_string(),
                version: 1,
                conversation_id,
                current_index: index,
                images,
            },
            api_base_url,
            user_id,
        })
    })
    .await
    .map_err(|_| ImageError::ImageUnavailable)??;
    if store.main_closed() || app.get_webview_window("main").is_none() {
        return Err(ImageError::OperationNotAllowed);
    }
    store.replace(state.clone())?;
    if let Err(error) = image_viewer::open_window(&app) {
        store.clear();
        return Err(error);
    }
    if store.main_closed()
        || app.get_webview_window("main").is_none()
        || !matches!(store.snapshot(Some(&state.session.session_id)), Ok(Some(_)))
    {
        store.clear();
        let _ = image_viewer::destroy_window(&app).await;
        return Err(ImageError::ViewerSessionExpired);
    }
    image_viewer::notify_session(&app, &state.session);
    Ok(state.session)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn get_image_viewer_session(
    window: WebviewWindow,
    store: State<'_, ViewerStore>,
    session_id: Option<String>,
) -> Result<Option<ViewerSession>, ImageError> {
    require_viewer(&window)?;
    Ok(store
        .snapshot(session_id.as_deref())?
        .map(|state| state.session))
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn update_image_viewer_session(
    app: AppHandle,
    window: WebviewWindow,
    cache: State<'_, AttachmentCache>,
    store: State<'_, ViewerStore>,
    session_id: String,
    images: Vec<ViewerImageInput>,
) -> Result<Option<ViewerSession>, ImageError> {
    require_main(&window)?;
    let _guard = store.mutation.lock().await;
    let old = store
        .snapshot(Some(&session_id))?
        .ok_or(ImageError::ViewerSessionExpired)?;
    let cache = cache
        .root_for_app(&app)
        .map_err(|_| ImageError::ImageUnavailable)?;
    let updated = tauri::async_runtime::spawn_blocking(move || {
        let images = image_viewer::image_list(
            &cache,
            &old.api_base_url,
            old.user_id,
            old.session.conversation_id,
            images,
        )?;
        Ok::<_, ImageError>(image_viewer::updated_session(&old, images))
    })
    .await
    .map_err(|_| ImageError::ImageUnavailable)??;
    // User closing the native window during cache lookup must not resurrect its session.
    store.snapshot(Some(&session_id))?;
    if let Some(state) = updated {
        store.replace_current(state.clone())?;
        image_viewer::notify_session(&app, &state.session);
        Ok(Some(state.session))
    } else {
        store.clear();
        image_viewer::destroy_window(&app).await?;
        Ok(None)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn select_image_viewer_image(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, ViewerStore>,
    session_id: String,
    image_id: String,
) -> Result<ViewerSession, ImageError> {
    require_viewer(&window)?;
    let _guard = store.mutation.lock().await;
    let mut state = store
        .snapshot(Some(&session_id))?
        .ok_or(ImageError::ViewerSessionExpired)?;
    state.session.current_index = state
        .session
        .images
        .iter()
        .position(|image| image.input.id == image_id)
        .ok_or(ImageError::InvalidViewerSession)?;
    state.session.version += 1;
    store.replace_current(state.clone())?;
    image_viewer::notify_session(&app, &state.session);
    Ok(state.session)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn close_image_viewer_session(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, ViewerStore>,
    session_id: Option<String>,
) -> Result<(), ImageError> {
    if window.label() != "main" {
        require_viewer(&window)?;
        if session_id.is_none() {
            return Err(ImageError::ViewerSessionExpired);
        }
    }
    let _guard = store.mutation.lock().await;
    store.snapshot(session_id.as_deref())?;
    store.clear();
    image_viewer::destroy_window(&app).await
}
