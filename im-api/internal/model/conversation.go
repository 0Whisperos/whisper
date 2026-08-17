package model

import "time"

type Conversation struct {
	ID               uint64    `gorm:"column:id;type:bigint unsigned;not null;primaryKey;autoIncrement"`
	ConversationType string    `gorm:"column:conversation_type;type:varchar(16);not null"`
	LastSeq          uint64    `gorm:"column:last_seq;type:bigint unsigned;not null;default:0"`
	CreatedAt        time.Time `gorm:"column:created_at;type:datetime(6);not null"`
	UpdatedAt        time.Time `gorm:"column:updated_at;type:datetime(6);not null"`
}

func (Conversation) TableName() string {
	return "conversations"
}

type ConversationMember struct {
	ConversationID uint64     `gorm:"column:conversation_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false"`
	UserID         uint64     `gorm:"column:user_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false;index:idx_conversation_members_user,priority:1"`
	MemberState    string     `gorm:"column:member_state;type:varchar(16);not null;index:idx_conversation_members_user,priority:2"`
	JoinedAt       time.Time  `gorm:"column:joined_at;type:datetime(6);not null"`
	LeftAt         *time.Time `gorm:"column:left_at;type:datetime(6)"`
}

func (ConversationMember) TableName() string {
	return "conversation_members"
}

type ConversationMemberCursor struct {
	ConversationID uint64     `gorm:"column:conversation_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false"`
	UserID         uint64     `gorm:"column:user_id;type:bigint unsigned;not null;primaryKey;autoIncrement:false"`
	DeliveredSeq   uint64     `gorm:"column:delivered_seq;type:bigint unsigned;not null;default:0"`
	ReadSeq        uint64     `gorm:"column:read_seq;type:bigint unsigned;not null;default:0"`
	DeliveredAt    *time.Time `gorm:"column:delivered_at;type:datetime(6)"`
	ReadAt         *time.Time `gorm:"column:read_at;type:datetime(6)"`
}

func (ConversationMemberCursor) TableName() string {
	return "conversation_member_cursors"
}
