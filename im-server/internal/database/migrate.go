package database

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/entity"
)

func MigrateAuthentication() error {
	database, err := connection()
	if err != nil {
		return err
	}

	if err := database.AutoMigrate(&entity.User{}, &entity.Session{}); err != nil {
		return fmt.Errorf("migrate authentication tables: %w", err)
	}

	return nil
}
