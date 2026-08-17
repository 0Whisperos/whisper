package global

import (
	"database/sql"

	goredis "github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

var MysqlDB *gorm.DB
var MysqlSQLDB *sql.DB
var RedisClient *goredis.Client
