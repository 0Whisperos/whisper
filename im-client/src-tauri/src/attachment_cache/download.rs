use std::fs::{self, OpenOptions};
use std::io::Write;

use reqwest::Client;
use serde::Deserialize;
use url::Url;
use uuid::Uuid;

use super::index;
use super::key::{canonical_files_root, checked_path, CacheKey};
use super::AttachmentCache;

const MAX_IMAGE_SIZE: u64 = 20 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Authorization {
    pub(crate) attachment_id: String,
    pub(crate) download_url: String,
    pub(crate) content_type: String,
    pub(crate) size_bytes: u64,
}

pub(super) async fn download_one(
    cache: AttachmentCache,
    client: Client,
    key: CacheKey,
    authorization: Authorization,
) -> Result<String, &'static str> {
    if authorization.size_bytes == 0 || authorization.size_bytes > MAX_IMAGE_SIZE {
        return Err("invalid_size");
    }
    let Some(extension) = index::extension_for(&authorization.content_type) else {
        return Err("unsupported_media_type");
    };
    let signed_url = Url::parse(&authorization.download_url).map_err(|_| "invalid_download_url")?;
    if !matches!(signed_url.scheme(), "http" | "https") || signed_url.host_str().is_none() {
        return Err("invalid_download_url");
    }

    let root = cache.root.clone();
    let id = key.attachment_id.clone();
    let api_url = key.api_base_url.clone();
    let lookup_key = key.clone();
    let cached = tauri::async_runtime::spawn_blocking(move || {
        index::lookup_many(
            &root,
            &api_url,
            lookup_key.user_id,
            lookup_key.conversation_id,
            &[id],
        )
    })
    .await
    .map_err(|_| "cache_unavailable")?
    .map_err(|_| "cache_unavailable")?;
    if let Some(path) = cached.first().and_then(|item| item.file_path.clone()) {
        return Ok(path);
    }

    let response = client
        .get(signed_url)
        .send()
        .await
        .map_err(|_| "download_failed")?;
    if !response.status().is_success() {
        return Err("download_failed");
    }
    let response_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .ok_or("unsupported_media_type")?;
    let normalized_auth_type = authorization
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let normalized_response_type = response_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if normalized_auth_type != normalized_response_type {
        return Err("unsupported_media_type");
    }

    let relative = key.relative_path(extension);
    let final_path = checked_path(&cache.root, &relative).ok_or("invalid_cache_key")?;
    let parent = final_path.parent().ok_or("invalid_cache_key")?;
    fs::create_dir_all(parent).map_err(|_| "cache_unavailable")?;
    let files_root = canonical_files_root(&cache.root).ok_or("invalid_cache_key")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|_| "cache_unavailable")?;
    if !canonical_parent.starts_with(&files_root) {
        return Err("invalid_cache_key");
    }
    let part_path = parent.join(format!("{}.{}.part", key.attachment_id, Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part_path)
        .map_err(|_| "cache_unavailable")?;
    let mut response = response;
    let mut received = 0_u64;
    let write_result: Result<(), &'static str> = async {
        while let Some(chunk) = response.chunk().await.map_err(|_| "download_failed")? {
            received = received
                .checked_add(chunk.len() as u64)
                .ok_or("size_mismatch")?;
            if received > authorization.size_bytes || received > MAX_IMAGE_SIZE {
                return Err("size_mismatch");
            }
            file.write_all(&chunk).map_err(|_| "cache_unavailable")?;
        }
        if received != authorization.size_bytes {
            return Err("size_mismatch");
        }
        file.sync_all().map_err(|_| "cache_unavailable")?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(code) = write_result {
        let _ = fs::remove_file(&part_path);
        return Err(code);
    }

    // Replacement is controlled: the valid complete .part is the only source installed at the final path.
    if final_path.exists() {
        fs::remove_file(&final_path).map_err(|_| {
            let _ = fs::remove_file(&part_path);
            "cache_unavailable"
        })?;
    }
    if fs::rename(&part_path, &final_path).is_err() {
        let _ = fs::remove_file(&part_path);
        return Err("cache_unavailable");
    }

    let root = cache.root.clone();
    let commit_key = key.clone();
    let commit_path = relative.clone();
    let content_type = normalized_auth_type;
    let size = received;
    let commit = tauri::async_runtime::spawn_blocking(move || {
        index::commit(&root, &commit_key, &commit_path, &content_type, size)
    })
    .await;
    if !matches!(commit, Ok(Ok(()))) {
        let _ = fs::remove_file(&final_path);
        let root = cache.root.clone();
        let remove_key = key.clone();
        let _ =
            tauri::async_runtime::spawn_blocking(move || index::remove(&root, &remove_key)).await;
        return Err("cache_unavailable");
    }
    Ok(final_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{download_one, Authorization};
    use crate::attachment_cache::index::lookup_many;
    use crate::attachment_cache::key::CacheKey;
    use crate::attachment_cache::AttachmentCache;
    use reqwest::Client;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::runtime::Builder;

    const ATTACHMENT_ID: &str = "6b916932-0738-48f2-b62e-f3f212472d73";
    static HTTP_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("whisper-image-download-{unique}"));
            fs::create_dir_all(&path).expect("create temporary cache directory");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct HttpFixture {
        url: String,
        requests: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl HttpFixture {
        fn new(body: Vec<u8>, content_type: &'static str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind local HTTP fixture");
            listener
                .set_nonblocking(true)
                .expect("make fixture listener nonblocking");
            let address = listener.local_addr().expect("read fixture address");
            let requests = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let worker_requests = Arc::clone(&requests);
            let worker_stop = Arc::clone(&stop);
            let worker = thread::spawn(move || {
                while !worker_stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            read_request(&mut stream);
                            worker_requests.fetch_add(1, Ordering::SeqCst);
                            let header = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                body.len()
                            );
                            let _ = stream.write_all(header.as_bytes());
                            let _ = stream.write_all(&body);
                            let _ = stream.flush();
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
            });
            Self {
                url: format!("http://{address}/image"),
                requests,
                stop,
                worker: Some(worker),
            }
        }

        fn request_count(&self) -> usize {
            self.requests.load(Ordering::SeqCst)
        }
    }

    impl Drop for HttpFixture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(worker) = self.worker.take() {
                worker.join().expect("join local HTTP fixture");
            }
        }
    }

    fn read_request(stream: &mut TcpStream) {
        let mut request = Vec::new();
        let mut byte = [0_u8; 1];
        while stream.read(&mut byte).unwrap_or(0) == 1 {
            request.push(byte[0]);
            if request.ends_with(b"\r\n\r\n") {
                break;
            }
        }
    }

    fn cache_at(root: &Path) -> AttachmentCache {
        AttachmentCache {
            root: root.to_path_buf(),
            client: Client::new(),
            key_locks: Default::default(),
        }
    }

    fn authorization(url: String, content_type: &str, size_bytes: u64) -> Authorization {
        Authorization {
            attachment_id: ATTACHMENT_ID.to_owned(),
            download_url: url,
            content_type: content_type.to_owned(),
            size_bytes,
        }
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(future)
    }

    fn contains_part_file(path: &Path) -> bool {
        let Ok(entries) = fs::read_dir(path) else {
            return false;
        };
        entries.flatten().any(|entry| {
            let file_type = entry.file_type().ok();
            if file_type.is_some_and(|kind| kind.is_dir()) {
                contains_part_file(&entry.path())
            } else {
                entry.path().extension().is_some_and(|ext| ext == "part")
            }
        })
    }

    #[test]
    fn streamed_download_commits_and_repeated_call_uses_the_cached_file() {
        // 测试目标：验证分块 HTTP 下载会提交最终文件与 SQLite 索引，重复调用直接命中且不再发 GET。
        // 构造方法：启动本地 TCP HTTP fixture，首次调用下载图片，再以同一授权调用 downloader 一次。
        // 输入数据：PNG 响应体 [1, 2, 3, 4]，授权大小为 4 字节，附件 ID 为有效 UUID。
        // 预期行为：首次返回文件内容并可由索引命中；第二次路径相同，fixture 总请求数仍为 1。
        let _guard = HTTP_TEST_LOCK
            .lock()
            .expect("lock local HTTP fixture tests");
        let directory = TempDir::new();
        let body = vec![1, 2, 3, 4];
        let fixture = HttpFixture::new(body.clone(), "image/png");
        let cache = cache_at(&directory.0);
        let key = CacheKey::new("https://api.example.test", 10, 20, ATTACHMENT_ID)
            .expect("create valid key");
        let authorization = authorization(fixture.url.clone(), "image/png", body.len() as u64);

        let first = run(download_one(
            cache.clone(),
            Client::new(),
            key.clone(),
            authorization.clone(),
        ))
        .expect("download image");
        let second = run(download_one(
            cache,
            Client::new(),
            key.clone(),
            authorization,
        ))
        .expect("reuse cached image");

        assert_eq!(first, second);
        assert_eq!(fs::read(&first).expect("read committed file"), body);
        let indexed = lookup_many(
            &directory.0,
            "https://api.example.test",
            10,
            20,
            &[ATTACHMENT_ID.to_owned()],
        )
        .expect("query committed index");
        assert_eq!(indexed[0].file_path.as_deref(), Some(first.as_str()));
        assert_eq!(fixture.request_count(), 1);
        assert!(!contains_part_file(&directory.0));
    }

    #[test]
    fn concurrent_download_commands_share_one_download_for_the_same_key() {
        // 测试目标：验证同一缓存实例收到相同逻辑键的并发下载命令时，只执行一次 HTTP GET。
        // 构造方法：启动本地 HTTP fixture，并用 tokio::join! 同时调用缓存服务的两次 download 命令。
        // 输入数据：用户 10、会话 20、相同附件 UUID 和同一张 4 字节 PNG 图片。
        // 预期行为：两次命令均返回相同完整文件路径，fixture 只收到一次请求，SQLite 记录可命中。
        let _guard = HTTP_TEST_LOCK
            .lock()
            .expect("lock local HTTP fixture tests");
        let directory = TempDir::new();
        let body = vec![4, 3, 2, 1];
        let fixture = HttpFixture::new(body, "image/png");
        let cache = cache_at(&directory.0);
        let auth = authorization(fixture.url.clone(), "image/png", 4);
        let first_cache = cache.clone();
        let second_cache = cache.clone();
        let first_auth = auth.clone();

        let (first, second) = run(async {
            let first = tauri::async_runtime::spawn(async move {
                first_cache
                    .download("https://api.example.test", 10, 20, vec![first_auth])
                    .await
            });
            let second = tauri::async_runtime::spawn(async move {
                second_cache
                    .download("https://api.example.test", 10, 20, vec![auth])
                    .await
            });
            (
                first.await.expect("join first cache command"),
                second.await.expect("join second cache command"),
            )
        });
        let first_item = first.expect("first cache command").remove(0);
        let first_path = first_item.file_path.clone().unwrap_or_else(|| {
            panic!(
                "first command did not return a path: {:?}",
                first_item.error_code
            )
        });
        let second_item = second.expect("second cache command").remove(0);
        let second_path = second_item.file_path.clone().unwrap_or_else(|| {
            panic!(
                "second command did not return a path: {:?}",
                second_item.error_code
            )
        });

        assert_eq!(first_path, second_path);
        assert_eq!(fixture.request_count(), 1);
        assert_eq!(
            fs::read(first_path).expect("read shared cached file"),
            [4, 3, 2, 1]
        );
    }

    #[test]
    fn size_or_mime_mismatch_leaves_no_committed_file_or_index_record() {
        // 测试目标：验证下载字节数不符或响应 MIME 与授权不符时，不留下可命中的文件、索引或临时文件。
        // 构造方法：分别启动本地服务器返回 4 字节 PNG，使用错误大小授权和错误 MIME 授权执行下载。
        // 输入数据：用例一授权 5 字节 image/png；用例二授权 4 字节 image/jpeg，服务器均返回 4 字节 image/png。
        // 预期行为：大小不符返回 size_mismatch，MIME 不符返回 unsupported_media_type；两者均无缓存记录或遗留文件。
        let _guard = HTTP_TEST_LOCK
            .lock()
            .expect("lock local HTTP fixture tests");
        for (content_type, size_bytes, expected_error) in [
            ("image/png", 5, "size_mismatch"),
            ("image/jpeg", 4, "unsupported_media_type"),
        ] {
            let directory = TempDir::new();
            let fixture = HttpFixture::new(vec![9, 8, 7, 6], "image/png");
            let cache = cache_at(&directory.0);
            let key = CacheKey::new("https://api.example.test", 10, 20, ATTACHMENT_ID)
                .expect("create valid key");
            let auth = authorization(fixture.url.clone(), content_type, size_bytes);

            let error = run(download_one(cache, Client::new(), key.clone(), auth))
                .expect_err("reject mismatched response");

            assert_eq!(error, expected_error);
            let indexed = lookup_many(
                &directory.0,
                "https://api.example.test",
                10,
                20,
                &[ATTACHMENT_ID.to_owned()],
            )
            .expect("query cache after failed download");
            assert!(indexed[0].file_path.is_none());
            assert!(!directory.0.join(key.relative_path("png")).exists());
            assert!(!directory.0.join(key.relative_path("jpg")).exists());
            assert!(!contains_part_file(&directory.0));
            assert_eq!(fixture.request_count(), 1);
        }
    }
}
