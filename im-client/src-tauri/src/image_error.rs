use serde::Serialize;

/// Stable IPC failures; native errors and private cache paths never cross this boundary.
#[derive(Debug, Clone, Copy, Serialize, thiserror::Error, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ImageError {
    #[error("image_not_cached")]
    ImageNotCached,
    #[error("image_unavailable")]
    ImageUnavailable,
    #[error("unsupported_media_type")]
    UnsupportedMediaType,
    #[error("clipboard_write_failed")]
    ClipboardWriteFailed,
    #[error("save_failed")]
    SaveFailed,
    #[error("viewer_session_expired")]
    ViewerSessionExpired,
    #[error("invalid_viewer_session")]
    InvalidViewerSession,
    #[error("operation_not_allowed")]
    OperationNotAllowed,
    #[error("viewer_window_failed")]
    ViewerWindowFailed,
}
