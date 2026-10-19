package chat

import "github.com/0Whisperos/whisper/im-server/internal/model/entity"

func loadReplyTargets(conversationID uint64, messages []entity.Message) (map[string]entity.Message, error) {
	ids := make([]string, 0)
	seen := make(map[string]bool)
	for _, message := range messages {
		if message.ReplyToMessageID != nil && !seen[*message.ReplyToMessageID] {
			id := *message.ReplyToMessageID
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	targets, err := findMessagesByIDs(conversationID, ids)
	if err != nil {
		return nil, err
	}
	result := make(map[string]entity.Message, len(targets))
	for _, target := range targets {
		if target.ConversationID == conversationID && seen[target.MessageID] {
			result[target.MessageID] = target
		}
	}
	return result, nil
}
