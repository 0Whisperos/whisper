package attachments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

const (
	MaxImageBytes int64 = 20 * 1024 * 1024
	MaxBatchBytes int64 = 50 * 1024 * 1024
	MaxBatchFiles       = 10
	attachmentTTL       = 24 * time.Hour
)

type UploadFile struct {
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}
type UploadRequest struct {
	ConversationID uint64       `json:"conversation_id"`
	Files          []UploadFile `json:"files"`
}
type UploadAuthorization struct {
	AttachmentID string            `json:"attachment_id"`
	UploadURL    string            `json:"upload_url"`
	Method       string            `json:"method"`
	Headers      map[string]string `json:"headers"`
	ExpiresAt    time.Time         `json:"expires_at"`
}
type CompletionRequest struct {
	AttachmentIDs []string `json:"attachment_ids"`
}
type Completion struct {
	AttachmentID string `json:"attachment_id"`
	Status       string `json:"status"`
	SizeBytes    int64  `json:"size_bytes,omitempty"`
	ErrorCode    string `json:"error_code,omitempty"`
}
type DownloadAuthorization struct {
	AttachmentID string    `json:"attachment_id"`
	DownloadURL  string    `json:"download_url"`
	ExpiresAt    time.Time `json:"expires_at"`
	ContentType  string    `json:"content_type"`
	SizeBytes    int64     `json:"size_bytes"`
}

var (
	objectStore            storage.Store
	objectPrefix           = "attachments/"
	createAttachments      = mysql.CreateAttachments
	findAttachment         = mysql.FindAttachment
	markAttachmentUploaded = mysql.MarkAttachmentUploaded
	markAttachmentExpired  = mysql.MarkAttachmentExpired
	listAttachments        = mysql.ListAttachments
	findConversation       = mysql.FindConversationByID
	isActiveMember         = mysql.IsActiveConversationMember
	now                    = time.Now
	randomRead             = rand.Read
)

func Configure(store storage.Store, prefix string) {
	objectStore = store
	prefix = strings.Trim(prefix, "/")
	if prefix == "" {
		objectPrefix = "attachments/"
	} else {
		objectPrefix = prefix + "/attachments/"
	}
}

func AuthorizeUploads(ctx context.Context, userID uint64, request UploadRequest) ([]UploadAuthorization, error) {
	if objectStore == nil {
		return nil, ErrStorageNotConfigured
	}
	if request.ConversationID == 0 || len(request.Files) == 0 || len(request.Files) > MaxBatchFiles {
		return nil, ErrInvalidRequest
	}
	var total int64
	for _, file := range request.Files {
		if strings.TrimSpace(file.FileName) == "" || utf8.RuneCountInString(file.FileName) > 255 || strings.ContainsAny(file.FileName, "\x00/\\") || file.SizeBytes <= 0 {
			return nil, ErrInvalidRequest
		}
		if normalizeType(file.ContentType) == "" {
			return nil, ErrUnsupportedImageType
		}
		if file.SizeBytes > MaxImageBytes {
			return nil, ErrAttachmentTooLarge
		}
		total += file.SizeBytes
	}
	if total > MaxBatchBytes {
		return nil, ErrAttachmentTooLarge
	}
	conversation, found, err := findConversation(request.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("find conversation for attachment upload: %w", err)
	}
	if !found || conversation.ConversationType != "direct" {
		return nil, ErrConversationNotFound
	}
	member, err := isActiveMember(request.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check attachment upload membership: %w", err)
	}
	if !member {
		return nil, ErrNotConversationMember
	}

	created := now().UTC()
	entities := make([]entity.Attachment, 0, len(request.Files))
	result := make([]UploadAuthorization, 0, len(request.Files))
	for _, file := range request.Files {
		id, err := newUUID()
		if err != nil {
			return nil, fmt.Errorf("generate attachment id: %w", err)
		}
		key := path.Join(objectPrefix, fmt.Sprint(request.ConversationID), id)
		typ := normalizeType(file.ContentType)
		presigned, err := objectStore.PresignPut(ctx, key, typ)
		if err != nil {
			return nil, fmt.Errorf("authorize attachment upload: %w", err)
		}
		entities = append(entities, entity.Attachment{AttachmentID: id, UploaderUserID: userID, ConversationID: request.ConversationID, ObjectKey: key, FileName: file.FileName, ContentType: typ, Status: "uploading", ExpiresAt: created.Add(attachmentTTL), CreatedAt: created, UpdatedAt: created})
		result = append(result, UploadAuthorization{AttachmentID: id, UploadURL: presigned.URL, Method: presigned.Method, Headers: presigned.Headers, ExpiresAt: presigned.ExpiresAt})
	}
	if err := createAttachments(ctx, entities); err != nil {
		return nil, fmt.Errorf("persist attachment upload authorizations: %w", err)
	}
	// TODO: expire abandoned uploading/uploaded records and delete their OSS objects after their authorization/grace period.
	return result, nil
}

func ConfirmUploads(ctx context.Context, userID uint64, request CompletionRequest) ([]Completion, error) {
	if objectStore == nil {
		return nil, ErrStorageNotConfigured
	}
	if !validIDs(request.AttachmentIDs) {
		return nil, ErrInvalidRequest
	}
	results := make([]Completion, 0, len(request.AttachmentIDs))
	for _, id := range request.AttachmentIDs {
		item := Completion{AttachmentID: id, Status: "uploading"}
		attachment, found, err := findAttachment(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("find attachment for completion: %w", err)
		}
		if !found || attachment.UploaderUserID != userID {
			item.ErrorCode = "attachment_unavailable"
			results = append(results, item)
			continue
		}
		item.Status = attachment.Status
		switch attachment.Status {
		case "uploaded":
			item.SizeBytes = attachment.SizeBytes
		case "uploading":
			metadata, err := objectStore.StatObject(ctx, attachment.ObjectKey)
			if err != nil {
				if isObjectNotFound(err) {
					item.ErrorCode = "object_not_found"
				} else {
					item.ErrorCode = "storage_unavailable"
				}
				break
			}
			if metadata.Size <= 0 {
				item.ErrorCode = "object_not_found"
				break
			}
			if metadata.Size > MaxImageBytes {
				if err := markAttachmentExpired(ctx, id, userID); err != nil {
					return nil, fmt.Errorf("expire oversized attachment: %w", err)
				}
				item.Status = "expired"
				item.ErrorCode = "attachment_too_large"
				break
			}
			if err := markAttachmentUploaded(ctx, id, userID, metadata.Size, now().UTC().Add(attachmentTTL)); err != nil {
				return nil, fmt.Errorf("mark attachment uploaded: %w", err)
			}
			item.Status = "uploaded"
			item.SizeBytes = metadata.Size
		default:
			item.ErrorCode = "attachment_unavailable"
		}
		results = append(results, item)
	}
	return results, nil
}

func AuthorizeDownloads(ctx context.Context, userID, conversationID uint64, request CompletionRequest) ([]DownloadAuthorization, error) {
	if objectStore == nil {
		return nil, ErrStorageNotConfigured
	}
	if conversationID == 0 || !validIDs(request.AttachmentIDs) {
		return nil, ErrInvalidRequest
	}
	conversation, found, err := findConversation(conversationID)
	if err != nil {
		return nil, fmt.Errorf("find conversation for attachment download: %w", err)
	}
	if !found || conversation.ConversationType != "direct" {
		return nil, ErrConversationNotFound
	}
	member, err := isActiveMember(conversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check attachment download membership: %w", err)
	}
	if !member {
		return nil, ErrNotConversationMember
	}
	attachments, err := listAttachments(ctx, request.AttachmentIDs)
	if err != nil {
		return nil, fmt.Errorf("list attachments for download: %w", err)
	}
	byID := make(map[string]entity.Attachment, len(attachments))
	for _, a := range attachments {
		byID[a.AttachmentID] = a
	}
	ordered := make([]entity.Attachment, 0, len(request.AttachmentIDs))
	for _, id := range request.AttachmentIDs {
		a, ok := byID[id]
		if !ok || a.ConversationID != conversationID || a.Status != "attached" || a.MessageID == nil {
			return nil, ErrAttachmentUnavailable
		}
		ordered = append(ordered, a)
	}
	result := make([]DownloadAuthorization, 0, len(ordered))
	for _, a := range ordered {
		p, err := objectStore.PresignGet(ctx, a.ObjectKey)
		if err != nil {
			return nil, fmt.Errorf("authorize attachment download: %w", err)
		}
		result = append(result, DownloadAuthorization{AttachmentID: a.AttachmentID, DownloadURL: p.URL, ExpiresAt: p.ExpiresAt, ContentType: a.ContentType, SizeBytes: a.SizeBytes})
	}
	return result, nil
}

func normalizeType(value string) string {
	t, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	t = strings.ToLower(t)
	switch t {
	case "image/jpeg", "image/png", "image/webp":
		return t
	default:
		return ""
	}
}
func validIDs(ids []string) bool {
	if len(ids) == 0 || len(ids) > MaxBatchFiles {
		return false
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !validUUID(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}
func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
func newUUID() (string, error) {
	var b [16]byte
	if _, err := randomRead(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}
func isObjectNotFound(err error) bool { return errors.Is(err, storage.ErrObjectNotFound) }
