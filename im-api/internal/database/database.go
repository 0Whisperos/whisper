package database

import (
	"database/sql"
	"errors"
	"fmt"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var (
	ErrNotInitialized = errors.New("database is not initialized")
	ErrAlreadyOpen    = errors.New("database is already open")

	db    *gorm.DB
	sqlDB *sql.DB
)

func Open(dsn string) error {
	if db != nil {
		return ErrAlreadyOpen
	}

	gormDB, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open GORM database: %w", err)
	}

	underlyingDB, err := gormDB.DB()
	if err != nil {
		return fmt.Errorf("get underlying database connection: %w", err)
	}

	db = gormDB
	sqlDB = underlyingDB

	return nil
}

func Close() error {
	if sqlDB == nil {
		return nil
	}

	underlyingDB := sqlDB
	db = nil
	sqlDB = nil

	return underlyingDB.Close()
}

func connection() (*gorm.DB, error) {
	if db == nil {
		return nil, ErrNotInitialized
	}

	return db, nil
}
