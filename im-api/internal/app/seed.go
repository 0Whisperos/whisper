package app

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/logging"
	"github.com/0Whisperos/whisper/im-server/internal/model"
	"github.com/0Whisperos/whisper/im-server/internal/repository/mysql"
	"golang.org/x/crypto/bcrypt"
)

func RunSeed(configPath string) error {
	cfg, err := config.LoadServerConfig(configPath)
	if err != nil {
		return err
	}
	if err := cfg.ValidateSeed(); err != nil {
		return fmt.Errorf("validate seed configuration: %w", err)
	}

	if err := mysql.Open(cfg.Database.DSN); err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if err := mysql.Close(); err != nil {
			logging.Error("close database after seed", "error", err)
		}
	}()

	created, err := handleAccount(cfg.Seed.Account, cfg.Seed.Password)
	if err != nil {
		return err
	}

	if created {
		logging.Info("seed account created")
		return nil
	}

	logging.Info("seed account verified")
	return nil
}

func handleAccount(account string, password string) (bool, error) {
	user, found, err := mysql.FindUserByAccount(account)
	if err != nil {
		return false, fmt.Errorf("find seed user: %w", err)
	}
	if found {
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
			return false, fmt.Errorf("seed password mismatch: %w", err)
		}

		return false, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return false, fmt.Errorf("hash seed password: %w", err)
	}
	if err := mysql.CreateUser(model.User{Account: account, PasswordHash: string(hash)}); err != nil {
		return false, fmt.Errorf("create seed user: %w", err)
	}

	return true, nil
}
