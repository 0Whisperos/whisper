use std::io::Cursor;

use crate::attachment_cache::CachedImage;
use crate::image_error::ImageError;

/// Shared original-image validation for viewer preparation and bitmap clipboard writes.
pub(crate) fn decode(image: &CachedImage) -> Result<image::RgbaImage, ImageError> {
    let format = match image
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/png" => image::ImageFormat::Png,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err(ImageError::UnsupportedMediaType),
    };
    let reader = image::ImageReader::with_format(Cursor::new(&image.bytes), format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| ImageError::ImageUnavailable)?;
    if u64::from(width) * u64::from(height) > 64 * 1024 * 1024 {
        return Err(ImageError::ImageUnavailable);
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&image.bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    Ok(reader
        .decode()
        .map_err(|_| ImageError::ImageUnavailable)?
        .into_rgba8())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(format: image::ImageFormat, content_type: &str) -> CachedImage {
        let pixels = image::RgbImage::from_pixel(2, 3, image::Rgb([50, 100, 150]));
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(pixels)
            .write_to(&mut bytes, format)
            .unwrap();
        CachedImage {
            bytes: bytes.into_inner(),
            content_type: content_type.into(),
        }
    }

    #[test]
    fn decodes_supported_original_formats_without_changing_source_bytes() {
        // 测试目标：共享解码器把 JPEG、PNG、WebP 原图解析为 RGBA，保持输入原图不变。
        // 构造方法：生成同一 2x3 RGB 图片，分别编码为三种支持格式后解码。
        // 输入数据：image/jpeg、image/png、image/webp 与各自的编码原始字节。
        // 预期行为：三种输入均得到 2x3 四通道位图；源字节完全不变。
        for (format, content_type) in [
            (image::ImageFormat::Jpeg, "image/jpeg"),
            (image::ImageFormat::Png, "image/png"),
            (image::ImageFormat::WebP, "image/webp"),
        ] {
            let original = encoded(format, content_type);
            let before = original.bytes.clone();
            let pixels = decode(&original).unwrap();
            assert_eq!(pixels.dimensions(), (2, 3));
            assert_eq!(pixels.as_raw().len(), 24);
            assert_eq!(original.bytes, before);
        }
    }

    #[test]
    fn corrupt_and_unsupported_images_return_stable_failures() {
        // 测试目标：共享解码器拒绝损坏、未支持类型以及与 MIME 不符的编码。
        // 构造方法：构造伪 PNG，再将有效 PNG 分别声明为 GIF 和 JPEG。
        // 输入数据：PNG 字节 [1,2,3]、image/gif 媒体类型、实际为 PNG 的 image/jpeg。
        // 预期行为：损坏或编码不符返回 ImageUnavailable，GIF 返回 UnsupportedMediaType。
        let corrupt = CachedImage {
            bytes: vec![1, 2, 3],
            content_type: "image/png".into(),
        };
        assert!(matches!(
            decode(&corrupt),
            Err(ImageError::ImageUnavailable)
        ));
        let mut unsupported = encoded(image::ImageFormat::Png, "image/gif");
        assert!(matches!(
            decode(&unsupported),
            Err(ImageError::UnsupportedMediaType)
        ));
        unsupported.content_type = "image/jpeg".into();
        assert!(matches!(
            decode(&unsupported),
            Err(ImageError::ImageUnavailable)
        ));
    }
}
