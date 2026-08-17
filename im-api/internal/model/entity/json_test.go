package entity

import (
	"database/sql/driver"
	"testing"
)

func TestJSONValueImplementsDatabaseInterfaces(t *testing.T) {
	// 测试目标：验证 JSON 字段类型能被 database/sql 与 GORM 作为 JSON 列处理。
	// 构造方法：对 JSONValue 做接口断言，并调用 GormDataType 检查通用数据类型。
	// 输入数据：JSONValue(`{"text":"hello"}`)。
	// 预期行为：JSONValue 实现 driver.Valuer，且声明的 GORM 数据类型是 json。
	value := JSONValue(`{"text":"hello"}`)
	if _, ok := interface{}(value).(driver.Valuer); !ok {
		t.Fatal("JSONValue does not implement driver.Valuer")
	}
	if got := value.GormDataType(); got != "json" {
		t.Fatalf("GormDataType = %q, want json", got)
	}
}
