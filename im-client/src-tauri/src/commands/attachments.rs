use serde::Serialize;
use tauri::{AppHandle, State};

use crate::attachment_cache::{AttachmentCache, Authorization};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheItemDto {
    pub(crate) attachment_id: String,
    pub(crate) file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<String>,
}

impl CacheItemDto {
    pub(crate) fn hit(attachment_id: String, file_path: String) -> Self {
        Self {
            attachment_id,
            file_path: Some(file_path),
            error_code: None,
        }
    }
    pub(crate) fn miss(attachment_id: String) -> Self {
        Self {
            attachment_id,
            file_path: None,
            error_code: None,
        }
    }
    pub(crate) fn failure(attachment_id: String, code: &str) -> Self {
        Self {
            attachment_id,
            file_path: None,
            error_code: Some(code.to_owned()),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn lookup_chat_image_cache(
    app: AppHandle,
    cache: State<'_, AttachmentCache>,
    api_base_url: String,
    user_id: u64,
    conversation_id: u64,
    attachment_ids: Vec<String>,
) -> Result<Vec<CacheItemDto>, String> {
    let cache = cache.root_for_app(&app)?;
    cache
        .lookup(&api_base_url, user_id, conversation_id, &attachment_ids)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn download_chat_images(
    app: AppHandle,
    cache: State<'_, AttachmentCache>,
    api_base_url: String,
    user_id: u64,
    conversation_id: u64,
    authorizations: Vec<Authorization>,
) -> Result<Vec<CacheItemDto>, String> {
    let cache = cache.root_for_app(&app)?;
    cache
        .download(&api_base_url, user_id, conversation_id, authorizations)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn invalidate_chat_image_cache(
    app: AppHandle,
    cache: State<'_, AttachmentCache>,
    api_base_url: String,
    user_id: u64,
    conversation_id: u64,
    attachment_id: String,
) -> Result<(), String> {
    let cache = cache.root_for_app(&app)?;
    cache
        .invalidate(&api_base_url, user_id, conversation_id, &attachment_id)
        .await
}
