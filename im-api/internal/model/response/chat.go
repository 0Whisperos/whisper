package response

import (
	"encoding/json"
	"time"
)

type UserProfile struct {
	UserID          uint64  `json:"user_id"`
	Account         string  `json:"account"`
	Nickname        string  `json:"nickname"`
	Signature       string  `json:"signature"`
	AvatarObjectKey *string `json:"avatar_object_key"`
}

type Friend struct {
	UserProfile
	FriendshipState string  `json:"friendship_state"`
	ConversationID  *uint64 `json:"conversation_id"`
}

type Me struct {
	UserProfile
}

type Message struct {
	MessageID       string          `json:"message_id"`
	ConversationID  uint64          `json:"conversation_id"`
	ConversationSeq uint64          `json:"conversation_seq"`
	SenderUserID    uint64          `json:"sender_user_id"`
	ClientMessageID string          `json:"client_message_id"`
	MessageType     string          `json:"message_type"`
	Content         json.RawMessage `json:"content"`
	CreatedAt       string          `json:"created_at"`
}

type MessagePage struct {
	Messages      []Message `json:"messages"`
	HasMore       bool      `json:"has_more"`
	NextBeforeSeq *uint64   `json:"next_before_seq,omitempty"`
	NextFromSeq   *uint64   `json:"next_from_seq,omitempty"`
}

func NewUserProfile(userID uint64, account, nickname, signature string, avatarObjectKey *string) UserProfile {
	return UserProfile{
		UserID:          userID,
		Account:         account,
		Nickname:        nickname,
		Signature:       signature,
		AvatarObjectKey: avatarObjectKey,
	}
}

func NewMessage(messageID string, conversationID, conversationSeq, senderUserID uint64, clientMessageID, messageType string, content json.RawMessage, createdAt time.Time) Message {
	return Message{
		MessageID:       messageID,
		ConversationID:  conversationID,
		ConversationSeq: conversationSeq,
		SenderUserID:    senderUserID,
		ClientMessageID: clientMessageID,
		MessageType:     messageType,
		Content:         content,
		CreatedAt:       formatProtocolTime(createdAt),
	}
}
