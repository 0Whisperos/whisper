mod download;
mod index;
mod key;
mod read;

pub(crate) use read::CachedImage;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use reqwest::Client;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

pub(crate) use download::Authorization;
use key::CacheKey;

#[derive(Clone)]
pub(crate) struct AttachmentCache {
    root: PathBuf,
    client: Client,
    key_locks: Arc<AsyncMutex<HashMap<CacheKey, Arc<AsyncMutex<()>>>>>,
}

impl AttachmentCache {
    pub(crate) fn new() -> Self {
        Self {
            root: PathBuf::new(),
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .expect("build attachment cache HTTP client"),
            key_locks: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    pub(crate) fn root_for_app(&self, app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_cache_dir()
            .map_err(|_| "cache_unavailable".to_owned())?
            .join("chat-images");
        Ok(Self {
            root,
            ..self.clone()
        })
    }

    pub(crate) async fn lookup(
        &self,
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        attachment_ids: &[String],
    ) -> Result<Vec<super::commands::attachments::CacheItemDto>, String> {
        let root = self.root.clone();
        let api_base_url = api_base_url.to_owned();
        let ids = attachment_ids.to_vec();
        tauri::async_runtime::spawn_blocking(move || {
            index::lookup_many(&root, &api_base_url, user_id, conversation_id, &ids)
        })
        .await
        .map_err(|_| "cache_unavailable".to_owned())?
        .map_err(|_| "cache_unavailable".to_owned())
    }

    pub(crate) async fn download(
        &self,
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        authorizations: Vec<Authorization>,
    ) -> Result<Vec<super::commands::attachments::CacheItemDto>, String> {
        let mut output = Vec::with_capacity(authorizations.len());
        for authorization in authorizations {
            let attachment_id = authorization.attachment_id.clone();
            let key = match CacheKey::new(api_base_url, user_id, conversation_id, &attachment_id) {
                Ok(key) => key,
                Err(code) => {
                    output.push(super::commands::attachments::CacheItemDto::failure(
                        attachment_id,
                        code,
                    ));
                    continue;
                }
            };
            let key_lock = {
                let mut locks = self.key_locks.lock().await;
                locks
                    .entry(key.clone())
                    .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                    .clone()
            };
            let _guard = key_lock.lock().await;
            let cache = self.clone();
            let client = self.client.clone();
            let result = download::download_one(cache, client, key, authorization).await;
            output.push(match result {
                Ok(file_path) => {
                    super::commands::attachments::CacheItemDto::hit(attachment_id, file_path)
                }
                Err(code) => {
                    super::commands::attachments::CacheItemDto::failure(attachment_id, code)
                }
            });
        }
        Ok(output)
    }

    pub(crate) async fn invalidate(
        &self,
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        attachment_id: &str,
    ) -> Result<(), String> {
        let key = CacheKey::new(api_base_url, user_id, conversation_id, attachment_id)
            .map_err(|_| "invalid_cache_key".to_owned())?;
        let key_lock = {
            let mut locks = self.key_locks.lock().await;
            locks
                .entry(key.clone())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        let _guard = key_lock.lock().await;
        let root = self.root.clone();
        tauri::async_runtime::spawn_blocking(move || index::invalidate(&root, &key))
            .await
            .map_err(|_| "cache_unavailable".to_owned())?
            .map_err(|_| "cache_unavailable".to_owned())
    }
}
