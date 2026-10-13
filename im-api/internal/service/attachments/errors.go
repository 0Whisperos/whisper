package attachments

import "errors"

var (
	ErrInvalidRequest        = errors.New("invalid attachment request")
	ErrUnsupportedImageType  = errors.New("unsupported image type")
	ErrAttachmentTooLarge    = errors.New("attachment is too large")
	ErrConversationNotFound  = errors.New("conversation not found")
	ErrNotConversationMember = errors.New("not a conversation member")
	ErrAttachmentUnavailable = errors.New("attachment unavailable")
	ErrStorageUnavailable    = errors.New("storage unavailable")
	ErrStorageNotConfigured  = errors.New("object storage is not configured")
)
