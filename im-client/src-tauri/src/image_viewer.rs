#[cfg(test)]
mod tests;
mod window;

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::attachment_cache::AttachmentCache;
use crate::image_error::ImageError;

pub(crate) use window::{destroy_window, lifecycle_plugin, notify_session, open_window};

pub(crate) const LABEL: &str = "image-viewer";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerImageInput {
    pub(crate) id: String,
    pub(crate) message_id: String,
    pub(crate) attachment_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerImage {
    #[serde(flatten)]
    pub(crate) input: ViewerImageInput,
    pub(crate) asset_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerSession {
    pub(crate) session_id: String,
    pub(crate) version: u64,
    pub(crate) conversation_id: u64,
    pub(crate) current_index: usize,
    pub(crate) images: Vec<ViewerImage>,
}

#[derive(Clone)]
pub(crate) struct SessionState {
    pub(crate) api_base_url: String,
    pub(crate) user_id: u64,
    pub(crate) session: ViewerSession,
}

#[derive(Default)]
pub(crate) struct ViewerStore {
    pub(crate) mutation: tokio::sync::Mutex<()>,
    state: Mutex<ViewerData>,
    main_closed: AtomicBool,
    window_changed: tokio::sync::Notify,
}

#[derive(Default)]
struct ViewerData {
    session: Option<SessionState>,
    window_generation: Option<Uuid>,
}

impl ViewerStore {
    pub(crate) fn snapshot(
        &self,
        session_id: Option<&str>,
    ) -> Result<Option<SessionState>, ImageError> {
        let state = self
            .state
            .lock()
            .map_err(|_| ImageError::ViewerSessionExpired)?;
        if session_id.is_some_and(|id| {
            state
                .session
                .as_ref()
                .map(|s| s.session.session_id.as_str())
                != Some(id)
        }) {
            return Err(ImageError::ViewerSessionExpired);
        }
        Ok(state.session.clone())
    }

    pub(crate) fn replace(&self, state: SessionState) -> Result<(), ImageError> {
        let mut slot = self
            .state
            .lock()
            .map_err(|_| ImageError::ViewerSessionExpired)?;
        if self.main_closed.load(Ordering::SeqCst) {
            return Err(ImageError::OperationNotAllowed);
        }
        slot.session = Some(state);
        Ok(())
    }

    pub(crate) fn replace_current(&self, state: SessionState) -> Result<(), ImageError> {
        let mut slot = self
            .state
            .lock()
            .map_err(|_| ImageError::ViewerSessionExpired)?;
        if self.main_closed.load(Ordering::SeqCst)
            || slot
                .session
                .as_ref()
                .map(|current| current.session.session_id.as_str())
                != Some(state.session.session_id.as_str())
        {
            return Err(ImageError::ViewerSessionExpired);
        }
        slot.session = Some(state);
        Ok(())
    }

    pub(crate) fn main_closed(&self) -> bool {
        self.main_closed.load(Ordering::SeqCst)
    }

    pub(crate) fn close_main(&self) {
        self.main_closed.store(true, Ordering::SeqCst);
        self.clear();
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.session = None;
        }
    }

    pub(crate) fn window_ready(&self, generation: Uuid) {
        if let Ok(mut state) = self.state.lock() {
            state.window_generation = Some(generation);
        }
        self.window_changed.notify_waiters();
    }

    pub(crate) fn window_destroyed(&self, generation: Uuid) {
        if let Ok(mut state) = self.state.lock() {
            if state.window_generation == Some(generation) {
                state.window_generation = None;
                state.session = None;
            }
        }
        self.window_changed.notify_waiters();
    }

    pub(crate) fn window_generation(&self) -> Option<Uuid> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.window_generation)
    }

    pub(crate) async fn wait_window_destroyed(&self, generation: Uuid) {
        loop {
            // Register before reading state so an intervening native event cannot be lost.
            let notified = self.window_changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.window_generation() != Some(generation) {
                return;
            }
            notified.await;
        }
    }
}

pub(crate) fn validate_images(images: &[ViewerImageInput]) -> Result<(), ImageError> {
    let mut ids = HashSet::new();
    for image in images {
        if image.id.is_empty()
            || image.id.len() > 512
            || !ids.insert(&image.id)
            || Uuid::parse_str(&image.message_id).is_err()
            || Uuid::parse_str(&image.attachment_id).is_err()
        {
            return Err(ImageError::InvalidViewerSession);
        }
    }
    Ok(())
}

pub(crate) fn image_list(
    cache: &AttachmentCache,
    api_base_url: &str,
    user_id: u64,
    conversation_id: u64,
    images: Vec<ViewerImageInput>,
) -> Result<Vec<ViewerImage>, ImageError> {
    validate_images(&images)?;
    Ok(images
        .into_iter()
        .map(|input| {
            let asset_url = cache
                .image_path(api_base_url, user_id, conversation_id, &input.attachment_id)
                .ok()
                .map(|path| asset_url(&path));
            ViewerImage { input, asset_url }
        })
        .collect())
}

fn asset_url(path: &std::path::Path) -> String {
    let encoded = percent_encoding::utf8_percent_encode(
        &path.to_string_lossy(),
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    #[cfg(any(windows, target_os = "android"))]
    let prefix = "http://asset.localhost/";
    #[cfg(not(any(windows, target_os = "android")))]
    let prefix = "asset://localhost/";
    format!("{prefix}{encoded}")
}

pub(crate) fn updated_session(
    old: &SessionState,
    images: Vec<ViewerImage>,
) -> Option<SessionState> {
    if images.is_empty() {
        return None;
    }
    let old_selected = &old.session.images[old.session.current_index].input.id;
    let index = images
        .iter()
        .position(|image| &image.input.id == old_selected)
        .unwrap_or_else(|| {
            // Prefer the next surviving image in the old sequence, then the preceding one.
            old.session
                .images
                .iter()
                .skip(old.session.current_index + 1)
                .find_map(|old_image| {
                    images
                        .iter()
                        .position(|image| image.input.id == old_image.input.id)
                })
                .or_else(|| {
                    old.session
                        .images
                        .iter()
                        .take(old.session.current_index)
                        .rev()
                        .find_map(|old_image| {
                            images
                                .iter()
                                .position(|image| image.input.id == old_image.input.id)
                        })
                })
                .unwrap_or(0)
        });
    let mut next = old.clone();
    next.session.current_index = index;
    next.session.images = images;
    next.session.version += 1;
    Some(next)
}
