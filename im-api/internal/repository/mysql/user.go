package mysql

import (
	"context"
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"gorm.io/gorm"
)

func FindUserByAccount(account string) (entity.User, bool, error) {
	if global.MysqlDB == nil {
		return entity.User{}, false, ErrNotInitialized
	}

	var user entity.User
	err := global.MysqlDB.WithContext(context.Background()).Where("account = ?", account).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.User{}, false, nil
	}
	if err != nil {
		return entity.User{}, false, fmt.Errorf("find user by account: %w", err)
	}

	return user, true, nil
}

func CreateUser(user entity.User) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(&user).Error; err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}
