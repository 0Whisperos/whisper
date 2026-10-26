package chat

import (
	"fmt"
	"strings"
	"time"
)

const maxMessageStatusBatchSize = 100

type MessageStatus struct {
	MessageID  string
	RecalledAt *time.Time
}

func ListConversationMessageStatuses(userID, conversationID uint64, messageIDs []string) ([]MessageStatus, error) {
	if conversationID == 0 || len(messageIDs) < 1 || len(messageIDs) > maxMessageStatusBatchSize {
		return nil, ErrInvalidMessageStatusRequest
	}
	ids := make([]string, 0, len(messageIDs))
	seen := make(map[string]bool, len(messageIDs))
	for _, id := range messageIDs {
		if !validMessageUUID(id) {
			return nil, ErrInvalidMessageStatusRequest
		}
		id = strings.ToLower(id)
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if _, err := authorizeConversation(userID, conversationID); err != nil {
		return nil, err
	}
	messages, err := findMessagesByIDs(conversationID, ids)
	if err != nil {
		return nil, fmt.Errorf("load conversation message statuses: %w", err)
	}
	byID := make(map[string]MessageStatus, len(messages))
	for _, message := range messages {
		id := strings.ToLower(message.MessageID)
		if message.ConversationID == conversationID && seen[id] {
			byID[id] = MessageStatus{MessageID: message.MessageID, RecalledAt: message.RecalledAt}
		}
	}
	statuses := make([]MessageStatus, 0, len(byID))
	for _, id := range ids {
		if status, ok := byID[id]; ok {
			statuses = append(statuses, status)
		}
	}
	return statuses, nil
}

func validMessageUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for index := 0; index < len(id); index++ {
		value := id[index]
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if value != '-' {
				return false
			}
		} else if !(value >= '0' && value <= '9' || value >= 'a' && value <= 'f' || value >= 'A' && value <= 'F') {
			return false
		}
	}
	return true
}
