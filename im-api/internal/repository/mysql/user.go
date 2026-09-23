package mysql

import (
	"context"
	"errors"
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
)

var ErrDuplicateAccount = errors.New("account already exists")

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

func FindUserByID(userID uint64) (entity.User, bool, error) {
	if global.MysqlDB == nil {
		return entity.User{}, false, ErrNotInitialized
	}

	var user entity.User
	err := global.MysqlDB.WithContext(context.Background()).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return entity.User{}, false, nil
	}
	if err != nil {
		return entity.User{}, false, fmt.Errorf("find user by id: %w", err)
	}

	return user, true, nil
}

func CreateUser(user *entity.User) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(user).Error; err != nil {
		if isDuplicateKeyError(err) {
			return ErrDuplicateAccount
		}
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}

func isDuplicateKeyError(err error) bool {
	var mysqlError *mysqldriver.MySQLError
	return errors.As(err, &mysqlError) && mysqlError.Number == 1062
}
