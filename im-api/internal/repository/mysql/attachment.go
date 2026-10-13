package mysql

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/gorm"
)

func CreateAttachments(ctx context.Context, attachments []entity.Attachment) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if len(attachments) == 0 {
		return nil
	}
	if err := global.MysqlDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.Create(&attachments).Error
	}); err != nil {
		return fmt.Errorf("create attachments: %w", err)
	}
	return nil
}

func FindAttachment(ctx context.Context, attachmentID string) (entity.Attachment, bool, error) {
	if global.MysqlDB == nil {
		return entity.Attachment{}, false, ErrNotInitialized
	}
	var attachment entity.Attachment
	err := global.MysqlDB.WithContext(ctx).Where("attachment_id = ?", attachmentID).Take(&attachment).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.Attachment{}, false, nil
	}
	if err != nil {
		return entity.Attachment{}, false, fmt.Errorf("find attachment: %w", err)
	}
	return attachment, true, nil
}

func MarkAttachmentUploaded(ctx context.Context, attachmentID string, uploaderID uint64, size int64, expiresAt time.Time) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	result := global.MysqlDB.WithContext(ctx).Model(&entity.Attachment{}).
		Where("attachment_id = ? AND uploader_user_id = ? AND status = ?", attachmentID, uploaderID, "uploading").
		Updates(map[string]interface{}{"status": "uploaded", "size_bytes": size, "expires_at": expiresAt})
	if result.Error != nil {
		return fmt.Errorf("mark attachment uploaded: %w", result.Error)
	}
	return nil
}

func MarkAttachmentExpired(ctx context.Context, attachmentID string, uploaderID uint64) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.WithContext(ctx).Model(&entity.Attachment{}).
		Where("attachment_id = ? AND uploader_user_id = ? AND status = ?", attachmentID, uploaderID, "uploading").
		Update("status", "expired").Error; err != nil {
		return fmt.Errorf("expire attachment: %w", err)
	}
	return nil
}

func ListAttachments(ctx context.Context, attachmentIDs []string) ([]entity.Attachment, error) {
	if global.MysqlDB == nil {
		return nil, ErrNotInitialized
	}
	var attachments []entity.Attachment
	if err := global.MysqlDB.WithContext(ctx).Where("attachment_id IN ?", attachmentIDs).Find(&attachments).Error; err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	return attachments, nil
}
