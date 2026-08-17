package model

import (
	"database/sql/driver"
	"fmt"
)

type JSONValue []byte

func (value JSONValue) Value() (driver.Value, error) {
	if len(value) == 0 {
		return "{}", nil
	}
	return string(value), nil
}

func (value *JSONValue) Scan(src interface{}) error {
	switch data := src.(type) {
	case nil:
		*value = nil
	case []byte:
		*value = append((*value)[0:0], data...)
	case string:
		*value = append((*value)[0:0], data...)
	default:
		return fmt.Errorf("scan JSONValue from %T", src)
	}
	return nil
}

func (JSONValue) GormDataType() string {
	return "json"
}
