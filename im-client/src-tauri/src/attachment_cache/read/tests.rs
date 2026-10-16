use super::super::{index, key::CacheKey};
use super::*;

const ID: &str = "6b916932-0738-48f2-b62e-f3f212472d73";

struct Fixture {
    cache: AttachmentCache,
    key: CacheKey,
    path: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("whisper-validated-read-{}", uuid::Uuid::new_v4()));
        let key = CacheKey::new("https://example.test", 1, 2, ID).unwrap();
        let path = root.join(key.relative_path("png"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, [1, 2, 3, 4]).unwrap();
        index::commit(&root, &key, &key.relative_path("png"), "image/png", 4).unwrap();
        let mut cache = AttachmentCache::new();
        cache.root = root;
        Self { cache, key, path }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.cache.root);
    }
}

#[test]
fn reads_only_exact_user_conversation_and_server_namespaces() {
    // 测试目标：有效原图可读取，但其他用户、会话或服务地址不命中同一文件。
    // 构造方法：创建一个缓存记录，再按合法和其他命名空间读取。
    // 输入数据：api example.test、user 1、conversation 2；另用 user 3、conversation 4、other.test。
    // 预期行为：合法键返回四字节，其余均返回 ImageNotCached。
    let fixture = Fixture::new();
    assert_eq!(
        fixture
            .cache
            .read_image("https://example.test", 1, 2, ID)
            .unwrap()
            .bytes,
        [1, 2, 3, 4]
    );
    for (api, user, conversation) in [
        ("https://example.test", 3, 2),
        ("https://example.test", 1, 4),
        ("https://other.test", 1, 2),
    ] {
        assert!(matches!(
            fixture.cache.read_image(api, user, conversation, ID),
            Err(ImageError::ImageNotCached)
        ));
    }
}

#[test]
fn rejects_truncated_and_mismatched_index_paths() {
    // 测试目标：截断文件和被篡改的索引相对路径不能作为有效源图读取。
    // 构造方法：先截断合法缓存；另建 fixture 并将路径改为 files/../outside.png。
    // 输入数据：预期 4 字节但实际 1 字节；索引目录穿越路径。
    // 预期行为：两次均返回 ImageNotCached，删除损坏索引项。
    let truncated = Fixture::new();
    std::fs::write(&truncated.path, [1]).unwrap();
    assert!(matches!(
        truncated.cache.read_image("https://example.test", 1, 2, ID),
        Err(ImageError::ImageNotCached)
    ));
    let corrupted = Fixture::new();
    let db = rusqlite::Connection::open(corrupted.cache.root.join("index.sqlite3")).unwrap();
    db.execute(
        "UPDATE image_cache SET relative_path='files/../outside.png'",
        [],
    )
    .unwrap();
    assert!(matches!(
        corrupted.cache.read_image("https://example.test", 1, 2, ID),
        Err(ImageError::ImageNotCached)
    ));
    assert!(index::lookup_record(&corrupted.cache.root, &corrupted.key)
        .unwrap()
        .is_none());
}
