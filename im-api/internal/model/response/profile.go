package response

import "time"

type AvatarUploadAuthorization struct {
	ObjectKey string            `json:"object_key"`
	UploadURL string            `json:"upload_url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expires_at"`
}

type AvatarDownloadAuthorization struct {
	ObjectKey   string    `json:"object_key"`
	DownloadURL string    `json:"download_url"`
	ExpiresAt   time.Time `json:"expires_at"`
}
