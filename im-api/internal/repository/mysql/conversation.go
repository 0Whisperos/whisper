package mysql

import (
	"context"
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/gorm"
)

func CreateConversation(conversation *entity.Conversation) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(conversation).Error; err != nil {
		return fmt.Errorf("create conversation: %w", err)
	}

	return nil
}

func CreateConversationMember(member entity.ConversationMember) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(&member).Error; err != nil {
		return fmt.Errorf("create conversation member: %w", err)
	}

	return nil
}

func CreateConversationMemberCursor(cursor entity.ConversationMemberCursor) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(&cursor).Error; err != nil {
		return fmt.Errorf("create conversation member cursor: %w", err)
	}

	return nil
}

func FindDirectConversationID(userID, friendUserID uint64) (*uint64, bool, error) {
	if global.MysqlDB == nil {
		return nil, false, ErrNotInitialized
	}

	var conversationID uint64
	err := global.MysqlDB.WithContext(context.Background()).
		Table("conversations AS c").
		Select("c.id").
		Joins("JOIN conversation_members AS first_member ON first_member.conversation_id = c.id AND first_member.user_id = ? AND first_member.member_state = ?", userID, "active").
		Joins("JOIN conversation_members AS second_member ON second_member.conversation_id = c.id AND second_member.user_id = ? AND second_member.member_state = ?", friendUserID, "active").
		Where("c.conversation_type = ?", "direct").
		Order("c.id ASC").
		Limit(1).
		Take(&conversationID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("find direct conversation: %w", err)
	}

	return &conversationID, true, nil
}

func FindConversationByID(conversationID uint64) (entity.Conversation, bool, error) {
	if global.MysqlDB == nil {
		return entity.Conversation{}, false, ErrNotInitialized
	}

	var conversation entity.Conversation
	err := global.MysqlDB.WithContext(context.Background()).Where("id = ?", conversationID).First(&conversation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.Conversation{}, false, nil
	}
	if err != nil {
		return entity.Conversation{}, false, fmt.Errorf("find conversation by id: %w", err)
	}

	return conversation, true, nil
}

func IsActiveConversationMember(conversationID, userID uint64) (bool, error) {
	if global.MysqlDB == nil {
		return false, ErrNotInitialized
	}

	var count int64
	err := global.MysqlDB.WithContext(context.Background()).
		Model(&entity.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND member_state = ?", conversationID, userID, "active").
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check conversation membership: %w", err)
	}

	return count > 0, nil
}

func ListMessages(conversationID uint64, beforeSeq, fromSeq *uint64, limit int) ([]entity.Message, bool, error) {
	if global.MysqlDB == nil {
		return nil, false, ErrNotInitialized
	}

	query := global.MysqlDB.WithContext(context.Background()).
		Where("conversation_id = ? AND message_type = ?", conversationID, "text").
		Limit(limit + 1)
	if fromSeq != nil {
		query = query.Where("conversation_seq >= ?", *fromSeq).Order("conversation_seq ASC")
	} else {
		if beforeSeq != nil {
			query = query.Where("conversation_seq < ?", *beforeSeq)
		}
		query = query.Order("conversation_seq DESC")
	}

	var messages []entity.Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, false, fmt.Errorf("list messages: %w", err)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}
	if fromSeq == nil {
		for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
			messages[left], messages[right] = messages[right], messages[left]
		}
	}

	return messages, hasMore, nil
}
