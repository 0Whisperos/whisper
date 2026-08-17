package mysql

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func MigrateAuthentication() error {
	return MigrateSchema()
}

func MigrateSchema() error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}

	if err := global.MysqlDB.AutoMigrate(migrationModels()...); err != nil {
		return fmt.Errorf("migrate database schema: %w", err)
	}

	return nil
}

func migrationModels() []interface{} {
	return []interface{}{
		&entity.User{},
		&entity.Conversation{},
		&entity.ConversationMember{},
		&entity.Message{},
		&entity.OutboxEvent{},
		&entity.ConversationMemberCursor{},
	}
}
