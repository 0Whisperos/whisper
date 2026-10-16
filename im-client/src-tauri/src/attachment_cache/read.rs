use std::io::Read;

use super::{index, key::CacheKey, AttachmentCache};
use crate::image_error::ImageError;

#[cfg(test)]
mod tests;

pub(crate) struct CachedImage {
    pub(crate) content_type: String,
    pub(crate) bytes: Vec<u8>,
}

impl AttachmentCache {
    pub(crate) fn image_path(
        &self,
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        attachment_id: &str,
    ) -> Result<std::path::PathBuf, ImageError> {
        let key = CacheKey::new(api_base_url, user_id, conversation_id, attachment_id)
            .map_err(|_| ImageError::ImageUnavailable)?;
        index::lookup_record(&self.root, &key)
            .map_err(|_| ImageError::ImageUnavailable)?
            .map(|record| record.path)
            .ok_or(ImageError::ImageNotCached)
    }
    /// Reads only records whose namespace, expected path and canonical root have been verified.
    pub(crate) fn read_image(
        &self,
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        attachment_id: &str,
    ) -> Result<CachedImage, ImageError> {
        let key = CacheKey::new(api_base_url, user_id, conversation_id, attachment_id)
            .map_err(|_| ImageError::ImageUnavailable)?;
        let record = index::lookup_record(&self.root, &key)
            .map_err(|_| ImageError::ImageUnavailable)?
            .ok_or(ImageError::ImageNotCached)?;
        const MAX_BYTES: u64 = 20 * 1024 * 1024;
        if record.size_bytes == 0 || record.size_bytes > MAX_BYTES {
            return Err(ImageError::ImageUnavailable);
        }
        let file = std::fs::File::open(&record.path).map_err(|_| ImageError::ImageUnavailable)?;
        let mut bytes = Vec::with_capacity(record.size_bytes as usize);
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ImageError::ImageUnavailable)?;
        if bytes.len() as u64 != record.size_bytes {
            return Err(ImageError::ImageUnavailable);
        }
        Ok(CachedImage {
            content_type: record.content_type,
            bytes,
        })
    }
}
