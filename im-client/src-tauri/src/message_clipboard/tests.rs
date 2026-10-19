use super::*;
use std::io::Cursor;

fn image() -> CachedImage {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::new(2, 3))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    CachedImage {
        bytes: bytes.into_inner(),
        content_type: "image/png".into(),
    }
}
fn inline(image: CachedImage) -> ClipboardBlock {
    ClipboardBlock::Image {
        source: ImageSource::Inline {
            content_type: image.content_type,
            base64: STANDARD.encode(image.bytes),
        },
    }
}

#[test]
fn mixed_content_preserves_order_and_escapes_text_with_fallback() {
    // 测试目标：完整图文保持原序并同时具备安全 HTML 与纯文本。
    // 构造方法：将文字、临时 PNG、后置文字交给 prepare。
    // 输入数据：中文、换行、HTML 特殊字符及有效 2x3 PNG。
    // 预期行为：图前后文字位置不变，源码被转义，fallback 在图位置显示占位。
    let output = prepare(
        vec![
            ClipboardBlock::Text {
                text: "前<&\n".into(),
            },
            inline(image()),
            ClipboardBlock::Text { text: "后".into() },
        ],
        |_| unreachable!(),
    )
    .unwrap();
    let ClipboardOutput::Html { html, plain } = output else {
        panic!("expected html")
    };
    assert!(html.contains("前&lt;&amp;\n"));
    assert!(html.find("前").unwrap() < html.find("data:image/png;base64,").unwrap());
    assert!(html.find("data:image/png;base64,").unwrap() < html.find("后").unwrap());
    assert_eq!(plain, "前<&\n[图片]后");
}

#[test]
fn single_original_image_with_whitespace_uses_bitmap() {
    // 测试目标：纯图消息忽略空白文字并选择系统位图。
    // 构造方法：围绕一张缓存图片添加空白文字，使用可观察 reader。
    // 输入数据：附件 key 和 2x3 PNG 原图。
    // 预期行为：只读对应附件一次，输出保留原始图片字节。
    let original = image();
    let before = original.bytes.clone();
    let mut reads = 0;
    let output = prepare(
        vec![
            ClipboardBlock::Text { text: " \n".into() },
            ClipboardBlock::Image {
                source: ImageSource::Cache {
                    attachment_id: "attachment".into(),
                },
            },
        ],
        |id| {
            assert_eq!(id, "attachment");
            reads += 1;
            Ok(image())
        },
    )
    .unwrap();
    let ClipboardOutput::Bitmap(result) = output else {
        panic!("expected bitmap")
    };
    assert_eq!(result.bytes, before);
    assert_eq!(reads, 1);
}

#[test]
fn bad_images_and_missing_cache_fail_before_writing() {
    // 测试目标：临时图和缓存异常不被静默复制为部分正文。
    // 构造方法：分别提交损坏 PNG、不支持类型及缺失附件。
    // 输入数据：AQID PNG、GIF 声明和返回 ImageNotCached 的 reader。
    // 预期行为：全部失败且返回稳定错误，不产生可写输出。
    assert!(matches!(
        prepare(
            vec![inline(CachedImage {
                content_type: "image/png".into(),
                bytes: vec![1, 2, 3]
            })],
            |_| unreachable!()
        ),
        Err(ImageError::ImageUnavailable)
    ));
    assert!(matches!(
        prepare(
            vec![inline(CachedImage {
                content_type: "image/gif".into(),
                bytes: vec![1]
            })],
            |_| unreachable!()
        ),
        Err(ImageError::UnsupportedMediaType)
    ));
    assert!(matches!(
        prepare(
            vec![ClipboardBlock::Image {
                source: ImageSource::Cache {
                    attachment_id: "missing".into()
                }
            }],
            |_| Err(ImageError::ImageNotCached)
        ),
        Err(ImageError::ImageNotCached)
    ));
}

#[test]
fn content_limits_and_empty_messages_are_rejected() {
    // 测试目标：限制图数量、单图字节和 HTML 传输体积。
    // 构造方法：构造 11 图、超大缓存图片、超限 HTML 和空正文。
    // 输入数据：11 个 image blocks、20MiB+1 字节、72MiB+1 HTML 字节。
    // 预期行为：超限返回 ClipboardContentTooLarge，空内容返回 ClipboardEmpty。
    assert!(matches!(
        prepare(
            (0..11).map(|_| inline(image())).collect(),
            |_| unreachable!()
        ),
        Err(ImageError::ClipboardContentTooLarge)
    ));
    assert!(matches!(
        prepare(
            vec![ClipboardBlock::Image {
                source: ImageSource::Cache {
                    attachment_id: "big".into()
                }
            }],
            |_| Ok(CachedImage {
                content_type: "image/png".into(),
                bytes: vec![0; MAX_IMAGE_BYTES + 1]
            })
        ),
        Err(ImageError::ClipboardContentTooLarge)
    ));
    assert_eq!(
        check_html_size(&"x".repeat(MAX_HTML_BYTES + 1)),
        Err(ImageError::ClipboardContentTooLarge)
    );
    assert!(matches!(
        prepare(vec![], |_| unreachable!()),
        Err(ImageError::ClipboardEmpty)
    ));
}

#[test]
fn html_and_fallback_are_written_together_and_adapter_failure_propagates() {
    // 测试目标：HTML 与 fallback 通过一次 adapter 调用写入且失败不宣称成功。
    // 构造方法：注入 writer 并检查同时收到两种格式，随后返回原生写失败。
    // 输入数据：<p>中文</p> 和纯文本中文。
    // 预期行为：调用一次，ClipboardWriteFailed 向上传递。
    let mut writes = 0;
    let result = write_html_with("<p>中文</p>".into(), "中文".into(), |html, plain| {
        writes += 1;
        assert_eq!(html, "<p>中文</p>");
        assert_eq!(plain, "中文");
        Err(ImageError::ClipboardWriteFailed)
    });
    assert_eq!(writes, 1);
    assert_eq!(result, Err(ImageError::ClipboardWriteFailed));
}

#[test]
fn input_dto_rejects_arbitrary_paths_and_urls() {
    // 测试目标：临时图片接口仅允许受限的 MIME 与 Base64 字节。
    // 构造方法：反序列化带多余路径和远程地址的图片 source。
    // 输入数据：inline 源附带 filePath 或 url 字段。
    // 预期行为：两个不符合稳定 DTO 的输入均被拒绝。
    for field in ["filePath", "url"] {
        let value = serde_json::json!({"kind":"inline", "contentType":"image/png", "base64":"AQID", field:"outside"});
        assert!(serde_json::from_value::<ImageSource>(value).is_err());
    }
}

#[test]
fn total_original_bytes_are_limited_before_the_third_image_is_encoded() {
    // 测试目标：整条消息原图总量不能超过 50MiB，即便单张均未超限。
    // 构造方法：把有效 PNG 的尾部补齐至 18MiB，通过缓存 reader 重复读取三张。
    // 输入数据：三张 18MiB PNG 与文字正文，合计 54MiB。
    // 预期行为：第三张累加时返回 ClipboardContentTooLarge，不生成可写的部分消息。
    let blocks = (0..3)
        .map(|index| ClipboardBlock::Image {
            source: ImageSource::Cache {
                attachment_id: index.to_string(),
            },
        })
        .collect();
    let result = prepare(blocks, |_| {
        let mut original = image();
        original.bytes.resize(18 * 1024 * 1024, 0);
        Ok(original)
    });
    assert!(matches!(result, Err(ImageError::ClipboardContentTooLarge)));
}

#[test]
fn literal_html_source_is_always_encoded_as_message_text() {
    // 测试目标：消息正文中的 HTML 源码不能变成剪贴板中的实际标签或图片。
    // 构造方法：把纯文字源码交给 prepare，读取 HTML 和纯文本两个结果。
    // 输入数据：<div><img src="data:image/png;base64,AQID"></div>。
    // 预期行为：HTML 中没有实际 img 标签，fallback 完整保留源码文字。
    let source = "<div><img src=\"data:image/png;base64,AQID\"></div>";
    let output = prepare(
        vec![ClipboardBlock::Text {
            text: source.into(),
        }],
        |_| unreachable!(),
    )
    .unwrap();
    let ClipboardOutput::Html { html, plain } = output else {
        panic!("expected html")
    };
    assert_eq!(plain, source);
    assert!(!html.contains("<img"));
    assert!(html.contains("&lt;div&gt;&lt;img"));
}
