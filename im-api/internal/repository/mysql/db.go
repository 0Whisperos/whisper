package mysql

import (
	"errors"
	"fmt"
	"net/url"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/0Whisperos/whisper/im-server/internal/global"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var (
	ErrNotInitialized = errors.New("database is not initialized")
	ErrAlreadyOpen    = errors.New("database is already open")
)

func Open(config config.DatabaseConfig) error {
	if global.MysqlDB != nil {
		return ErrAlreadyOpen
	}

	gormDB, err := gorm.Open(mysql.Open(buildDSN(config)), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open GORM database: %w", err)
	}

	underlyingDB, err := gormDB.DB()
	if err != nil {
		return fmt.Errorf("get underlying database connection: %w", err)
	}

	underlyingDB.SetMaxOpenConns(config.Pool.MaxOpenConns)
	underlyingDB.SetMaxIdleConns(config.Pool.MaxIdleConns)
	connMaxLifetime, err := config.Pool.ConnMaxLifetimeDuration()
	if err != nil {
		return err
	}
	underlyingDB.SetConnMaxLifetime(connMaxLifetime)
	connMaxIdleTime, err := config.Pool.ConnMaxIdleTimeDuration()
	if err != nil {
		return err
	}
	underlyingDB.SetConnMaxIdleTime(connMaxIdleTime)

	global.MysqlDB = gormDB
	global.MysqlSQLDB = underlyingDB

	return nil
}

func Close() error {
	if global.MysqlSQLDB == nil {
		return nil
	}

	underlyingDB := global.MysqlSQLDB
	global.MysqlDB = nil
	global.MysqlSQLDB = nil

	return underlyingDB.Close()
}

func buildDSN(config config.DatabaseConfig) string {
	values := url.Values{}
	values.Set("charset", config.Charset)
	values.Set("parseTime", fmt.Sprintf("%t", config.ParseTime))
	values.Set("loc", config.Loc)
	values.Set("timeout", config.Timeout)
	values.Set("readTimeout", config.ReadTimeout)
	values.Set("writeTimeout", config.WriteTimeout)

	return fmt.Sprintf(
		"%s:%s@tcp(%s:%d)/%s?%s",
		config.Username,
		config.Password,
		config.Host,
		config.Port,
		config.Name,
		values.Encode(),
	)
}
