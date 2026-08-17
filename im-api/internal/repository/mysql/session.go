package mysql

import (
	"fmt"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model"
)

func CreateSession(session model.Session) error {
	database, err := connection()
	if err != nil {
		return err
	}
	if err := database.Create(&session).Error; err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func RevokeActiveSessionByTokenHash(tokenHash string) error {
	database, err := connection()
	if err != nil {
		return err
	}
	revokedAt := time.Now().UTC()
	result := database.Model(&model.Session{}).
		Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?", tokenHash, revokedAt).
		Update("revoked_at", revokedAt)
	if result.Error != nil {
		return fmt.Errorf("revoke active session: %w", result.Error)
	}
	return nil
}
