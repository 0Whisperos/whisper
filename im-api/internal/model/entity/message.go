package entity

import "time"

type Message struct {
	ID              uint64    `gorm:"column:id;type:bigint unsigned;not null;primaryKey;autoIncrement"`
	MessageID       string    `gorm:"column:message_id;type:char(36);not null;uniqueIndex:uk_messages_message_id"`
	ConversationID  uint64    `gorm:"column:conversation_id;type:bigint unsigned;not null;uniqueIndex:uk_messages_conversation_seq,priority:1;index:idx_messages_conversation_created,priority:1"`
	ConversationSeq uint64    `gorm:"column:conversation_seq;type:bigint unsigned;not null;uniqueIndex:uk_messages_conversation_seq,priority:2"`
	SenderUserID    uint64    `gorm:"column:sender_user_id;type:bigint unsigned;not null;uniqueIndex:uk_messages_sender_client_msg,priority:1"`
	ClientMessageID string    `gorm:"column:client_message_id;type:char(36);not null;uniqueIndex:uk_messages_sender_client_msg,priority:2"`
	MessageType     string    `gorm:"column:message_type;type:varchar(32);not null"`
	Content         JSONValue `gorm:"column:content;type:json;not null"`
	ContentHash     string    `gorm:"column:content_hash;type:char(64);not null"`
	CreatedAt       time.Time `gorm:"column:created_at;type:datetime(6);not null;index:idx_messages_conversation_created,priority:2"`
}

func (Message) TableName() string {
	return "messages"
}
