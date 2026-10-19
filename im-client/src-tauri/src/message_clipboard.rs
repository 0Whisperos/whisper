use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

use crate::{attachment_cache::CachedImage, image_error::ImageError};

pub(crate) const MAX_HTML_BYTES: usize = 72 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 50 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ClipboardBlock {
    Text { text: String },
    Image { source: ImageSource },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ImageSource {
    #[serde(rename_all = "camelCase")]
    Cache { attachment_id: String },
    #[serde(rename_all = "camelCase")]
    Inline {
        content_type: String,
        base64: String,
    },
}

pub(crate) enum ClipboardOutput {
    Bitmap(CachedImage),
    Html { html: String, plain: String },
}

pub(crate) fn prepare(
    blocks: Vec<ClipboardBlock>,
    mut read_cached: impl FnMut(&str) -> Result<CachedImage, ImageError>,
) -> Result<ClipboardOutput, ImageError> {
    let image_count = blocks
        .iter()
        .filter(|block| matches!(block, ClipboardBlock::Image { .. }))
        .count();
    if image_count > 10 {
        return Err(ImageError::ClipboardContentTooLarge);
    }
    let bitmap_only = image_count == 1
        && blocks.iter().all(|block| match block {
            ClipboardBlock::Text { text } => text.trim().is_empty(),
            ClipboardBlock::Image { .. } => true,
        });
    let mut html = String::from("<div data-whisper-message-version=\"1\">");
    let mut plain = String::new();
    let mut total = 0usize;
    for block in blocks {
        match block {
            ClipboardBlock::Text { text } => {
                if text.len() > MAX_HTML_BYTES
                    || plain.len().saturating_add(text.len()) > MAX_HTML_BYTES
                {
                    return Err(ImageError::ClipboardContentTooLarge);
                }
                html.push_str("<p data-whisper-block=\"text\" style=\"white-space:pre-wrap\">");
                escape(&text, &mut html)?;
                html.push_str("</p>");
                plain.push_str(&text);
            }
            ClipboardBlock::Image { source } => {
                let image = match source {
                    ImageSource::Cache { attachment_id } => read_cached(&attachment_id)?,
                    ImageSource::Inline {
                        content_type,
                        base64,
                    } => {
                        if base64.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
                            return Err(ImageError::ClipboardContentTooLarge);
                        }
                        CachedImage {
                            content_type,
                            bytes: STANDARD
                                .decode(base64)
                                .map_err(|_| ImageError::ImageUnavailable)?,
                        }
                    }
                };
                total = total
                    .checked_add(image.bytes.len())
                    .ok_or(ImageError::ClipboardContentTooLarge)?;
                if image.bytes.len() > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES {
                    return Err(ImageError::ClipboardContentTooLarge);
                }
                let content_type = media_type(&image.content_type)?;
                crate::image_decode::decode(&image)?;
                if bitmap_only {
                    return Ok(ClipboardOutput::Bitmap(image));
                }
                html.push_str("<img data-whisper-block=\"image\" src=\"data:");
                html.push_str(content_type);
                html.push_str(";base64,");
                STANDARD.encode_string(&image.bytes, &mut html);
                html.push_str("\" alt=\"图片\" />");
                plain.push_str("[图片]");
            }
        }
        check_html_size(&html)?;
    }
    if plain.is_empty() {
        return Err(ImageError::ClipboardEmpty);
    }
    html.push_str("</div>");
    check_html_size(&html)?;
    Ok(ClipboardOutput::Html { html, plain })
}

fn media_type(value: &str) -> Result<&'static str, ImageError> {
    match value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Ok("image/jpeg"),
        "image/png" => Ok("image/png"),
        "image/webp" => Ok("image/webp"),
        _ => Err(ImageError::UnsupportedMediaType),
    }
}

fn escape(text: &str, output: &mut String) -> Result<(), ImageError> {
    for character in text.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            value => output.push(value),
        }
        check_html_size(output)?;
    }
    Ok(())
}

pub(crate) fn check_html_size(html: &str) -> Result<(), ImageError> {
    if html.len() > MAX_HTML_BYTES {
        Err(ImageError::ClipboardContentTooLarge)
    } else {
        Ok(())
    }
}

pub(crate) fn write(output: ClipboardOutput) -> Result<(), ImageError> {
    match output {
        ClipboardOutput::Bitmap(image) => crate::image_actions::copy(&image),
        ClipboardOutput::Html { html, plain } => write_html_with(html, plain, |html, plain| {
            crate::platform::clipboard::with_clipboard(
                ImageError::ClipboardWriteFailed,
                |clipboard| {
                    clipboard
                        .set_html(html, Some(plain))
                        .map_err(|_| ImageError::ClipboardWriteFailed)
                },
            )
        }),
    }
}

fn write_html_with(
    html: String,
    plain: String,
    writer: impl FnOnce(String, String) -> Result<(), ImageError>,
) -> Result<(), ImageError> {
    check_html_size(&html)?;
    writer(html, plain)
}

#[cfg(test)]
mod tests;
