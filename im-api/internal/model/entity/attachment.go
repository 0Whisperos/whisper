package entity

import "time"

type Attachment struct {
	AttachmentID   string    `gorm:"column:attachment_id;type:char(36);not null;primaryKey"`
	UploaderUserID uint64    `gorm:"column:uploader_user_id;type:bigint unsigned;not null;index:idx_attachments_uploader_status,priority:1"`
	ConversationID uint64    `gorm:"column:conversation_id;type:bigint unsigned;not null;index:idx_attachments_conversation_status,priority:1"`
	ObjectKey      string    `gorm:"column:object_key;type:varchar(512);not null;uniqueIndex:uk_attachments_object_key"`
	FileName       string    `gorm:"column:file_name;type:varchar(255);not null"`
	ContentType    string    `gorm:"column:content_type;type:varchar(64);not null"`
	SizeBytes      int64     `gorm:"column:size_bytes;type:bigint unsigned;not null;default:0"`
	Status         string    `gorm:"column:status;type:varchar(16);not null;index:idx_attachments_uploader_status,priority:2;index:idx_attachments_conversation_status,priority:2"`
	MessageID      *string   `gorm:"column:message_id;type:char(36);index:idx_attachments_message_id"`
	ExpiresAt      time.Time `gorm:"column:expires_at;type:datetime(6);not null"`
	CreatedAt      time.Time `gorm:"column:created_at;type:datetime(6);not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;type:datetime(6);not null"`
}

func (Attachment) TableName() string { return "attachments" }
