package chat

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func authorizeConversation(userID, conversationID uint64) (entity.Conversation, error) {
	conversation, found, err := findConversationByID(conversationID)
	if err != nil {
		return entity.Conversation{}, fmt.Errorf("find conversation: %w", err)
	}
	if !found || conversation.ConversationType != "direct" {
		return entity.Conversation{}, ErrConversationNotFound
	}
	member, err := isActiveConversationMember(conversationID, userID)
	if err != nil {
		return entity.Conversation{}, fmt.Errorf("check conversation membership: %w", err)
	}
	if !member {
		return entity.Conversation{}, ErrNotConversationMember
	}
	return conversation, nil
}
