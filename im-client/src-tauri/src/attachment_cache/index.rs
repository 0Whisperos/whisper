use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use super::key::{canonical_files_root, checked_path, CacheKey};
use crate::commands::attachments::CacheItemDto;

const DATABASE_FILE: &str = "index.sqlite3";

fn open(root: &Path) -> rusqlite::Result<Connection> {
    fs::create_dir_all(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let connection = Connection::open(root.join(DATABASE_FILE))?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS image_cache (
           api_base_url TEXT NOT NULL,
           user_id TEXT NOT NULL,
           conversation_id TEXT NOT NULL,
           attachment_id TEXT NOT NULL,
           relative_path TEXT NOT NULL,
           content_type TEXT NOT NULL,
           size_bytes INTEGER NOT NULL,
           PRIMARY KEY (api_base_url, user_id, conversation_id, attachment_id)
         );",
    )?;
    Ok(connection)
}

pub(super) fn lookup_many(
    root: &Path,
    api_base_url: &str,
    user_id: u64,
    conversation_id: u64,
    ids: &[String],
) -> rusqlite::Result<Vec<CacheItemDto>> {
    let connection = open(root)?;
    let mut output = Vec::with_capacity(ids.len());
    for id in ids {
        let key = match CacheKey::new(api_base_url, user_id, conversation_id, id) {
            Ok(key) => key,
            Err(code) => {
                output.push(CacheItemDto::failure(id.clone(), code));
                continue;
            }
        };
        let record = connection.query_row(
            "SELECT relative_path, content_type, size_bytes FROM image_cache
             WHERE api_base_url = ?1 AND user_id = ?2 AND conversation_id = ?3 AND attachment_id = ?4",
            params![key.api_base_url, key.user_id.to_string(), key.conversation_id.to_string(), key.attachment_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
        ).optional()?;
        let Some((relative, content_type, size_bytes)) = record else {
            output.push(CacheItemDto::miss(id.clone()));
            continue;
        };
        let expected_relative =
            key.relative_path(extension_for(&content_type).unwrap_or("invalid"));
        let Some(path) = checked_path(root, Path::new(&relative)) else {
            delete_key(&connection, &key)?;
            output.push(CacheItemDto::miss(id.clone()));
            continue;
        };
        let Ok(size_bytes) = u64::try_from(size_bytes) else {
            delete_key(&connection, &key)?;
            output.push(CacheItemDto::miss(id.clone()));
            continue;
        };
        if Path::new(&relative) != expected_relative || !valid_file(root, &path, size_bytes) {
            delete_key(&connection, &key)?;
            output.push(CacheItemDto::miss(id.clone()));
            continue;
        }
        output.push(CacheItemDto::hit(
            id.clone(),
            path.to_string_lossy().into_owned(),
        ));
    }
    Ok(output)
}

pub(super) fn commit(
    root: &Path,
    key: &CacheKey,
    relative: &Path,
    content_type: &str,
    size_bytes: u64,
) -> rusqlite::Result<()> {
    let connection = open(root)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO image_cache (api_base_url, user_id, conversation_id, attachment_id, relative_path, content_type, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(api_base_url, user_id, conversation_id, attachment_id) DO UPDATE SET
           relative_path = excluded.relative_path, content_type = excluded.content_type, size_bytes = excluded.size_bytes",
        params![key.api_base_url, key.user_id.to_string(), key.conversation_id.to_string(), key.attachment_id, relative.to_string_lossy(), content_type, i64::try_from(size_bytes).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, i64::MAX))?],
    )?;
    transaction.commit()
}

pub(super) fn invalidate(root: &Path, key: &CacheKey) -> rusqlite::Result<()> {
    let connection = open(root)?;
    let transaction = connection.unchecked_transaction()?;
    let relative: Option<String> = transaction.query_row(
        "SELECT relative_path FROM image_cache WHERE api_base_url = ?1 AND user_id = ?2 AND conversation_id = ?3 AND attachment_id = ?4",
        params![key.api_base_url, key.user_id.to_string(), key.conversation_id.to_string(), key.attachment_id],
        |row| row.get(0),
    ).optional()?;
    transaction.execute(
        "DELETE FROM image_cache WHERE api_base_url = ?1 AND user_id = ?2 AND conversation_id = ?3 AND attachment_id = ?4",
        params![key.api_base_url, key.user_id.to_string(), key.conversation_id.to_string(), key.attachment_id],
    )?;
    transaction.commit()?;
    if let Some(relative) = relative {
        if let Some(path) = checked_path(root, Path::new(&relative)) {
            if let (Some(files_root), Ok(canonical)) =
                (canonical_files_root(root), fs::canonicalize(&path))
            {
                if canonical.starts_with(files_root) {
                    let _ = fs::remove_file(canonical);
                }
            }
        }
    }
    Ok(())
}

pub(super) fn remove(root: &Path, key: &CacheKey) -> rusqlite::Result<()> {
    let connection = open(root)?;
    delete_key(&connection, key)
}

fn delete_key(connection: &Connection, key: &CacheKey) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM image_cache WHERE api_base_url = ?1 AND user_id = ?2 AND conversation_id = ?3 AND attachment_id = ?4",
        params![key.api_base_url, key.user_id.to_string(), key.conversation_id.to_string(), key.attachment_id],
    )?;
    Ok(())
}

pub(super) fn extension_for(content_type: &str) -> Option<&'static str> {
    match content_type
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn valid_file(root: &Path, path: &PathBuf, expected_size: u64) -> bool {
    let Some(files_root) = canonical_files_root(root) else {
        return false;
    };
    let Ok(canonical) = fs::canonicalize(path) else {
        return false;
    };
    if !canonical.starts_with(files_root) {
        return false;
    }
    let Ok(metadata) = fs::metadata(canonical) else {
        return false;
    };
    metadata.is_file() && metadata.len() == expected_size && expected_size > 0
}

#[cfg(test)]
mod tests {
    use super::{commit, extension_for, invalidate, lookup_many, open};
    use crate::attachment_cache::key::CacheKey;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let n = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("whisper-image-index-{n}"));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn rejects_unsupported_media_types() {
        // 测试目标：只为 JPEG、PNG、WebP 生成缓存扩展名。
        // 构造方法：逐一查询支持和不支持的媒体类型映射。
        // 输入数据：image/jpeg、image/png、image/webp 和 image/gif。
        // 预期行为：三种支持类型映射到固定扩展名，GIF 被拒绝。
        assert_eq!(extension_for("image/jpeg"), Some("jpg"));
        assert_eq!(extension_for("image/png; charset=binary"), Some("png"));
        assert_eq!(extension_for("image/webp"), Some("webp"));
        assert_eq!(extension_for("image/gif"), None);
    }

    #[test]
    fn database_failure_is_reported_without_replacing_the_database() {
        // 测试目标：验证索引位置被普通文件占用时数据库错误会向调用方传播。
        // 构造方法：预先在 index.sqlite3 路径写入普通文本，再尝试打开索引。
        // 输入数据：包含不可打开 index.sqlite3 文件的临时缓存目录。
        // 预期行为：打开失败，不删除或覆盖原文件。
        let dir = TempDir::new();
        fs::write(dir.0.join("index.sqlite3"), "preserve me").unwrap();
        assert!(open(&dir.0).is_err());
        assert_eq!(
            fs::read_to_string(dir.0.join("index.sqlite3")).unwrap(),
            "preserve me"
        );
    }

    #[test]
    fn malformed_attachment_id_is_returned_as_an_item_error() {
        // 测试目标：验证单个无效附件 ID 不会使整批查询失败。
        // 构造方法：在可用空数据库上查询一个非法 ID。
        // 输入数据：attachment ID 为 "bad-id"。
        // 预期行为：命令批次成功返回，该条目带 invalid_attachment_id 且无文件路径。
        let dir = TempDir::new();
        let result =
            lookup_many(&dir.0, "https://example.com", 1, 1, &["bad-id".to_owned()]).unwrap();
        assert_eq!(
            result[0].error_code.as_deref(),
            Some("invalid_attachment_id")
        );
        assert!(result[0].file_path.is_none());
    }

    #[test]
    fn committed_image_is_reused_for_duplicate_lookups_and_invalidated_with_its_file() {
        // 测试目标：验证图片文件与 SQLite 记录提交后可命中，且失效操作会删除对应缓存文件。
        // 构造方法：在临时缓存目录写入完整 PNG 文件并提交记录，重复查询同一附件，再执行失效。
        // 输入数据：同一逻辑键对应 4 字节 PNG，查询批次包含两次相同 UUID。
        // 预期行为：两条查询返回同一文件路径；失效后索引返回未命中，文件也被移除。
        let dir = TempDir::new();
        let id = "6b916932-0738-48f2-b62e-f3f212472d73";
        let key = CacheKey::new("https://example.com/api", 12, 34, id).unwrap();
        let relative = key.relative_path("png");
        let full_path = dir.0.join(&relative);
        fs::create_dir_all(full_path.parent().unwrap()).unwrap();
        fs::write(&full_path, [1, 2, 3, 4]).unwrap();
        commit(&dir.0, &key, &relative, "image/png", 4).unwrap();

        let duplicate_ids = vec![id.to_owned(), id.to_owned()];
        let hits = lookup_many(&dir.0, "https://example.com/api/", 12, 34, &duplicate_ids).unwrap();
        assert_eq!(hits[0].file_path, hits[1].file_path);
        assert!(hits[0].file_path.is_some());

        invalidate(&dir.0, &key).unwrap();
        let misses =
            lookup_many(&dir.0, "https://example.com/api", 12, 34, &[id.to_owned()]).unwrap();
        assert!(misses[0].file_path.is_none());
        assert!(!full_path.exists());
    }
}
