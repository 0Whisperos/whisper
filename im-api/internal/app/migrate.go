package app

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
)

func RunMigration(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}
	if err := mysql.Open(cfg.Database.DSN); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := mysql.Close(); err != nil {
			logging.Error("close database after migration", "error", err)
		}
	}()

	if err := mysql.MigrateSchema(); err != nil {
		return err
	}
	logging.Info("database schema migration completed")

	return nil
}
