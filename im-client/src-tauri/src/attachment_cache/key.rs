use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) struct CacheKey {
    pub(super) api_base_url: String,
    pub(super) user_id: u64,
    pub(super) conversation_id: u64,
    pub(super) attachment_id: String,
}

impl CacheKey {
    pub(super) fn new(
        api_base_url: &str,
        user_id: u64,
        conversation_id: u64,
        attachment_id: &str,
    ) -> Result<Self, &'static str> {
        if user_id == 0 || conversation_id == 0 {
            return Err("invalid_cache_key");
        }
        let api_base_url = normalize_api_base_url(api_base_url).ok_or("invalid_cache_key")?;
        let attachment_id = Uuid::parse_str(attachment_id)
            .map_err(|_| "invalid_attachment_id")?
            .hyphenated()
            .to_string();
        Ok(Self {
            api_base_url,
            user_id,
            conversation_id,
            attachment_id,
        })
    }

    pub(super) fn relative_path(&self, extension: &str) -> PathBuf {
        let mut digest = Sha256::new();
        digest.update(self.api_base_url.as_bytes());
        let namespace = hex::encode(digest.finalize());
        PathBuf::from("files")
            .join(namespace)
            .join(self.user_id.to_string())
            .join(self.conversation_id.to_string())
            .join(format!("{}.{}", self.attachment_id, extension))
    }
}

pub(super) fn checked_path(root: &Path, relative: &Path) -> Option<PathBuf> {
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    let files = root.join("files");
    let path = root.join(relative);
    if !path.starts_with(&files) {
        return None;
    }
    Some(path)
}

pub(super) fn canonical_files_root(root: &Path) -> Option<PathBuf> {
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let canonical_files = std::fs::canonicalize(root.join("files")).ok()?;
    if canonical_files != canonical_root.join("files") {
        return None;
    }
    Some(canonical_files)
}

pub(super) fn normalize_api_base_url(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    // Keep the same cache identity rule as config::normalize_api_base_url and the frontend helper.
    Some(value.trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::{checked_path, normalize_api_base_url, CacheKey};
    use std::path::Path;

    #[test]
    fn normalizes_server_url_like_existing_config_and_keeps_path_scope() {
        // 测试目标：验证缓存命名空间与现有配置及前端一致，只去除末尾斜杠。
        // 构造方法：分别解析带尾斜杠的主机地址和带路径的 HTTPS 地址，并生成缓存键。
        // 输入数据：http://EXAMPLE.com:80/// 与 https://example.com/api/。
        // 预期行为：URL 通过 HTTP(S) 校验后保留原始主机/端口/路径，仅移除末尾斜杠。
        let plain = CacheKey::new(
            "http://EXAMPLE.com:80///",
            5,
            9,
            "6b916932-0738-48f2-b62e-f3f212472d73",
        )
        .unwrap();
        let path = CacheKey::new(
            "https://example.com/api/",
            5,
            9,
            "6b916932-0738-48f2-b62e-f3f212472d73",
        )
        .unwrap();
        assert_eq!(plain.api_base_url, "http://EXAMPLE.com:80");
        assert_ne!(plain.relative_path("png"), path.relative_path("png"));
    }

    #[test]
    fn rejects_invalid_ids_and_paths_outside_files_directory() {
        // 测试目标：验证附件标识及索引相对路径不能构成目录穿越。
        // 构造方法：使用非 UUID 附件 ID，并向路径检查器传入含父目录组件的路径。
        // 输入数据：attachment_id="../outside" 和 files/../index.sqlite3。
        // 预期行为：无效附件键被拒绝，越界相对路径不产生文件系统路径。
        assert!(CacheKey::new("https://example.com", 1, 2, "../outside").is_err());
        assert!(checked_path(
            Path::new("C:/cache/chat-images"),
            Path::new("files/../index.sqlite3")
        )
        .is_none());
    }

    #[test]
    fn rejects_non_http_schemes() {
        // 测试目标：确保缓存键地址校验与现有客户端配置的 HTTP(S) 限制一致。
        // 构造方法：分别规范化 HTTPS 地址和 file 协议 URL。
        // 输入数据：https://example.com 与 file:///tmp/api。
        // 预期行为：HTTPS 地址保留原文，非 HTTP(S) 协议被拒绝。
        assert_eq!(
            normalize_api_base_url("https://example.com"),
            Some("https://example.com".to_owned())
        );
        assert!(normalize_api_base_url("file:///tmp/api").is_none());
    }
}
