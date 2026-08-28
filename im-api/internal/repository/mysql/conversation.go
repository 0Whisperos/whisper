package mysql

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
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
