package database

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/entity"
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
		&entity.User{},
		&entity.Conversation{},
		&entity.ConversationMember{},
		&entity.Message{},
		&entity.OutboxEvent{},
		&entity.ConversationMemberCursor{},
	}
}
