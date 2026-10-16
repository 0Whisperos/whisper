use super::*;
use crate::image_viewer::{SessionState, ViewerImage, ViewerImageInput, ViewerSession};
use std::io::Cursor;

const ID: &str = "6b916932-0738-48f2-b62e-f3f212472d73";

fn encoded(format: image::ImageFormat, content_type: &str) -> CachedImage {
    let pixels = image::RgbaImage::from_pixel(2, 3, image::Rgba([50, 100, 150, 255]));
    let image = image::DynamicImage::ImageRgba8(pixels).to_rgb8();
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut bytes, format)
        .unwrap();
    CachedImage {
        bytes: bytes.into_inner(),
        content_type: content_type.into(),
    }
}

#[test]
fn writes_supported_original_formats_to_clipboard_once() {
    // 测试目标：JPEG、PNG、WebP 原图均经共享解码后向剪贴板 adapter 写入一次 RGBA 位图。
    // 构造方法：生成同一 2x3 像素图并编码为三种图片格式，注入可观察 writer 调用 copy_with。
    // 输入数据：三种媒体类型和对应原始图片字节。
    // 预期行为：writer 收到 2x3 四通道位图且恰好调用一次，输入原图字节不变。
    for (format, content_type) in [
        (image::ImageFormat::Jpeg, "image/jpeg"),
        (image::ImageFormat::Png, "image/png"),
        (image::ImageFormat::WebP, "image/webp"),
    ] {
        let original = encoded(format, content_type);
        let before = original.bytes.clone();
        let mut writes = 0;
        copy_with(&original, |bitmap| {
            writes += 1;
            assert_eq!((bitmap.width, bitmap.height), (2, 3));
            assert_eq!(bitmap.bytes.len(), 24);
            Ok(())
        })
        .unwrap();
        assert_eq!(writes, 1);
        assert_eq!(original.bytes, before);
    }
}

#[test]
fn clipboard_adapter_failure_is_reported_without_claiming_success() {
    // 测试目标：平台剪贴板拒绝写入时向前端返回稳定失败状态。
    // 构造方法：将有效 PNG 交给 copy_with，注入始终返回 Err 的 writer。
    // 输入数据：有效 2x3 PNG 和失败剪贴板 adapter。
    // 预期行为：返回 ClipboardWriteFailed，不产生成功返回值。
    let original = encoded(image::ImageFormat::Png, "image/png");
    assert_eq!(
        copy_with(&original, |_| Err(())),
        Err(ImageError::ClipboardWriteFailed)
    );
}

#[test]
fn viewer_cannot_request_chat_keys_or_another_sessions_images() {
    // 测试目标：viewer 只能操作当前 session 中的图片，不能指定聊天缓存键。
    // 构造方法：初始化一个 viewer session，分别提交聊天 target、失效 session 和未知图片。
    // 输入数据：viewer caller、chat target、wrong session ID、unknown image ID。
    // 预期行为：跨窗口、失效 session 和非 session 图片分别被拒绝，合法 viewer 图片可解析。
    let store = ViewerStore::default();
    store
        .replace(SessionState {
            api_base_url: "https://example.test".into(),
            user_id: 1,
            session: ViewerSession {
                session_id: "active".into(),
                version: 1,
                conversation_id: 2,
                current_index: 0,
                images: vec![ViewerImage {
                    input: ViewerImageInput {
                        id: "item".into(),
                        message_id: ID.into(),
                        attachment_id: ID.into(),
                    },
                    asset_url: None,
                }],
            },
        })
        .unwrap();
    let chat = ImageTarget::Chat {
        api_base_url: "https://example.test".into(),
        user_id: 1,
        conversation_id: 2,
        attachment_id: ID.into(),
    };
    assert!(matches!(
        resolve_target(LABEL, &chat, &store),
        Err(ImageError::OperationNotAllowed)
    ));
    let target = |session: &str, id: &str| ImageTarget::Viewer {
        session_id: session.into(),
        image_id: id.into(),
    };
    assert!(matches!(
        resolve_target(LABEL, &target("wrong", "item"), &store),
        Err(ImageError::ViewerSessionExpired)
    ));
    assert!(matches!(
        resolve_target(LABEL, &target("active", "unknown"), &store),
        Err(ImageError::ImageUnavailable)
    ));
    assert_eq!(
        resolve_target(LABEL, &target("active", "item"), &store)
            .unwrap()
            .attachment_id,
        ID
    );
    assert!(matches!(
        resolve_target("main", &target("active", "item"), &store),
        Err(ImageError::OperationNotAllowed)
    ));
}

#[test]
fn save_cancellation_and_success_preserve_original_bytes_and_safe_name() {
    // 测试目标：取消保存静默结束，成功保存保留原字节且建议名只来源于 UUID/MIME。
    // 构造方法：创建 PNG 原图，调用取消分支并写入临时目标文件，最后删除测试文件。
    // 输入数据：有效附件 UUID、image/png、None 和临时文件路径。
    // 预期行为：取消 saved=false、无路径；成功 saved=true，输出内容与原图完全相同。
    let original = encoded(image::ImageFormat::Png, "image/png");
    let key = ImageKey {
        api_base_url: "unused".into(),
        user_id: 1,
        conversation_id: 2,
        attachment_id: ID.into(),
    };
    assert_eq!(
        suggested_name(&key, &original).unwrap(),
        format!("{ID}.png")
    );
    let cancel = save_to(&original, None).unwrap();
    assert!(!cancel.saved && cancel.file_path.is_none());
    let path = std::env::temp_dir().join(format!("whisper-export-{}.png", uuid::Uuid::new_v4()));
    assert!(save_to(&original, Some(&path)).unwrap().saved);
    let written = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(written, original.bytes);
}

#[test]
fn save_write_failure_and_error_serialization_do_not_expose_private_paths() {
    // 测试目标：保存目标不可写时返回稳定 code，不泄漏内部 IO 错误和路径。
    // 构造方法：向不存在目录的子文件写入 PNG，然后序列化错误。
    // 输入数据：随机不存在目录下的 target.png。
    // 预期行为：返回 SaveFailed，IPC 序列化值为字符串 save_failed。
    let path = std::env::temp_dir()
        .join(uuid::Uuid::new_v4().to_string())
        .join("target.png");
    assert!(matches!(
        save_to(&encoded(image::ImageFormat::Png, "image/png"), Some(&path)),
        Err(ImageError::SaveFailed)
    ));
    assert_eq!(
        serde_json::to_string(&ImageError::SaveFailed).unwrap(),
        "\"save_failed\""
    );
}

#[test]
fn ipc_targets_accept_camel_case_fields_without_filesystem_paths() {
    // 测试目标：前端 target DTO 的 camelCase 字段能被 Rust 解析且不含任意源路径接口。
    // 构造方法：直接按共享合同反序列化 chat 和 viewer JSON target。
    // 输入数据：apiBaseUrl/userId/conversationId/attachmentId 和 sessionId/imageId。
    // 预期行为：两种合法 DTO 均解析为对应枚举；非法 kind 不可解析。
    let chat: ImageTarget = serde_json::from_value(serde_json::json!({"kind":"chat", "apiBaseUrl":"https://example.test", "userId":1, "conversationId":2, "attachmentId":ID})).unwrap();
    assert!(matches!(
        chat,
        ImageTarget::Chat {
            user_id: 1,
            conversation_id: 2,
            ..
        }
    ));
    let viewer: ImageTarget = serde_json::from_value(
        serde_json::json!({"kind":"viewer", "sessionId":"active", "imageId":"item"}),
    )
    .unwrap();
    assert!(matches!(viewer, ImageTarget::Viewer { .. }));
    assert!(serde_json::from_value::<ImageTarget>(
        serde_json::json!({"kind":"path", "filePath":"C:/outside.png"})
    )
    .is_err());
}
