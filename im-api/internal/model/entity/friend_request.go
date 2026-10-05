package entity

import "time"

type FriendRequest struct {
	ID                  uint64    `gorm:"column:id;type:bigint unsigned;not null;primaryKey;autoIncrement"`
	SenderUserID        uint64    `gorm:"column:sender_user_id;type:bigint unsigned;not null;uniqueIndex:uk_friend_requests_direction,priority:1;index:idx_friend_requests_recipient_status,priority:1"`
	RecipientUserID     uint64    `gorm:"column:recipient_user_id;type:bigint unsigned;not null;uniqueIndex:uk_friend_requests_direction,priority:2;index:idx_friend_requests_recipient_status,priority:2"`
	VerificationMessage string    `gorm:"column:verification_message;type:varchar(800);not null;default:''"`
	Status              string    `gorm:"column:status;type:varchar(16);not null;index:idx_friend_requests_recipient_status,priority:3"`
	CreatedAt           time.Time `gorm:"column:created_at;type:datetime(6);not null"`
	UpdatedAt           time.Time `gorm:"column:updated_at;type:datetime(6);not null"`
}

func (FriendRequest) TableName() string { return "friend_requests" }
