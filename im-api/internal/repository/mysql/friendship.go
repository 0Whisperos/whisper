package mysql

import (
	"fmt"

	"github.com/0Whisperos/whisper/im-server/internal/global"
	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
)

func CreateFriendship(friendship entity.Friendship) error {
	if global.MysqlDB == nil {
		return ErrNotInitialized
	}
	if err := global.MysqlDB.Create(&friendship).Error; err != nil {
		return fmt.Errorf("create friendship: %w", err)
	}

	return nil
}
