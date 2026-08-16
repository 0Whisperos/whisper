package migration

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/database"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
)

func Run(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}
	if err := database.Open(cfg.Database.DSN); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := database.Close(); err != nil {
			logging.Error("close database after migration", "error", err)
		}
	}()

	if err := database.MigrateAuthentication(); err != nil {
		return err
	}
	logging.Info("authentication database migration completed")

	return nil
}
