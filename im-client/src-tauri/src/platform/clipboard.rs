use crate::image_error::ImageError;

/// All main/viewer clipboard reads and writes share one native open/write/drop lifetime.
pub(crate) fn with_clipboard<T>(
    failure: ImageError,
    action: impl FnOnce(&mut arboard::Clipboard) -> Result<T, ImageError>,
) -> Result<T, ImageError> {
    static ACCESS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ACCESS.lock().map_err(|_| failure)?;
    let mut clipboard = arboard::Clipboard::new().map_err(|_| failure)?;
    action(&mut clipboard)
}
