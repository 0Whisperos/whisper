#[cfg(test)]
mod tests;

use std::borrow::Cow;

use serde::{Deserialize, Serialize};

use crate::attachment_cache::{AttachmentCache, CachedImage};
use crate::image_error::ImageError;
use crate::image_viewer::{ViewerStore, LABEL};

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ImageTarget {
    #[serde(rename_all = "camelCase")]
    Chat {
        api_base_url: String,
        user_id: u64,
        conversation_id: u64,
        attachment_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Viewer {
        session_id: String,
        image_id: String,
    },
}

pub(crate) struct ImageKey {
    pub(crate) api_base_url: String,
    pub(crate) user_id: u64,
    pub(crate) conversation_id: u64,
    pub(crate) attachment_id: String,
}

pub(crate) fn resolve_target(
    caller: &str,
    target: &ImageTarget,
    store: &ViewerStore,
) -> Result<ImageKey, ImageError> {
    match target {
        ImageTarget::Chat {
            api_base_url,
            user_id,
            conversation_id,
            attachment_id,
        } if caller == "main" => {
            // UUID normalization also makes the save dialog's suggested filename safe.
            let attachment_id = uuid::Uuid::parse_str(attachment_id)
                .map_err(|_| ImageError::ImageUnavailable)?
                .to_string();
            Ok(ImageKey {
                api_base_url: api_base_url.clone(),
                user_id: *user_id,
                conversation_id: *conversation_id,
                attachment_id,
            })
        }
        ImageTarget::Viewer {
            session_id,
            image_id,
        } if caller == LABEL => {
            let state = store
                .snapshot(Some(session_id))?
                .ok_or(ImageError::ViewerSessionExpired)?;
            let image = state
                .session
                .images
                .iter()
                .find(|image| &image.input.id == image_id)
                .ok_or(ImageError::ImageUnavailable)?;
            Ok(ImageKey {
                api_base_url: state.api_base_url,
                user_id: state.user_id,
                conversation_id: state.session.conversation_id,
                attachment_id: image.input.attachment_id.clone(),
            })
        }
        _ => Err(ImageError::OperationNotAllowed),
    }
}

pub(crate) fn read_target(
    cache: &AttachmentCache,
    key: &ImageKey,
) -> Result<CachedImage, ImageError> {
    cache.read_image(
        &key.api_base_url,
        key.user_id,
        key.conversation_id,
        &key.attachment_id,
    )
}

pub(crate) fn copy(image: &CachedImage) -> Result<(), ImageError> {
    copy_with(image, |data| {
        crate::platform::clipboard::with_clipboard(ImageError::ClipboardWriteFailed, |clipboard| {
            clipboard
                .set_image(data)
                .map_err(|_| ImageError::ClipboardWriteFailed)
        })
        .map_err(|_| ())
    })
}

fn copy_with(
    image: &CachedImage,
    writer: impl FnOnce(arboard::ImageData<'static>) -> Result<(), ()>,
) -> Result<(), ImageError> {
    let pixels = crate::image_decode::decode(image)?;
    let data = arboard::ImageData {
        width: pixels.width() as usize,
        height: pixels.height() as usize,
        bytes: Cow::Owned(pixels.into_raw()),
    };
    writer(data).map_err(|_| ImageError::ClipboardWriteFailed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveResult {
    pub(crate) saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) file_path: Option<String>,
}

pub(crate) fn suggested_name(key: &ImageKey, image: &CachedImage) -> Result<String, ImageError> {
    let extension = match image
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => return Err(ImageError::UnsupportedMediaType),
    };
    let id = uuid::Uuid::parse_str(&key.attachment_id).map_err(|_| ImageError::ImageUnavailable)?;
    Ok(format!("{id}.{extension}"))
}

pub(crate) fn save_to(
    image: &CachedImage,
    target: Option<&std::path::Path>,
) -> Result<SaveResult, ImageError> {
    let Some(path) = target else {
        return Ok(SaveResult {
            saved: false,
            file_path: None,
        });
    };
    // Bytes were read and validated before the dialog; never re-open a frontend-provided source.
    std::fs::write(path, &image.bytes).map_err(|_| ImageError::SaveFailed)?;
    Ok(SaveResult {
        saved: true,
        file_path: Some(path.to_string_lossy().into_owned()),
    })
}
