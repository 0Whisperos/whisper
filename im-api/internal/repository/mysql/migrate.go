package mysql

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/model"
)

func MigrateAuthentication() error {
	return MigrateSchema()
}

func MigrateSchema() error {
	database, err := connection()
	if err != nil {
		return err
	}

	if err := database.AutoMigrate(migrationModels()...); err != nil {
		return fmt.Errorf("migrate database schema: %w", err)
	}

	return nil
}

func migrationModels() []interface{} {
	return []interface{}{
		&model.User{},
		&model.Conversation{},
		&model.ConversationMember{},
		&model.Message{},
		&model.OutboxEvent{},
		&model.ConversationMemberCursor{},
	}
}
