package entity

import (
	"reflect"
	"sync"
	"testing"

	"gorm.io/gorm/schema"
)

func parseSchema(t *testing.T, model interface{}) *schema.Schema {
	t.Helper()

	parsed, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parse schema for %T: %v", model, err)
	}
	return parsed
}

func assertField(t *testing.T, parsed *schema.Schema, fieldName string, columnName string, columnType string, primaryKey bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.DBName != columnName {
		t.Fatalf("%s.%s DBName = %q, want %q", parsed.Name, fieldName, field.DBName, columnName)
	}
	if got := field.TagSettings["TYPE"]; got != columnType {
		t.Fatalf("%s.%s type = %q, want %q", parsed.Name, fieldName, got, columnType)
	}
	if field.PrimaryKey != primaryKey {
		t.Fatalf("%s.%s PrimaryKey = %v, want %v", parsed.Name, fieldName, field.PrimaryKey, primaryKey)
	}
}

func assertAutoIncrement(t *testing.T, parsed *schema.Schema, fieldName string, want bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.AutoIncrement != want {
		t.Fatalf("%s.%s AutoIncrement = %v, want %v", parsed.Name, fieldName, field.AutoIncrement, want)
	}
}

func assertDefault(t *testing.T, parsed *schema.Schema, fieldName string, want string) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.DefaultValue != want {
		t.Fatalf("%s.%s default = %q, want %q", parsed.Name, fieldName, field.DefaultValue, want)
	}
}

func assertNotNull(t *testing.T, parsed *schema.Schema, fieldName string, want bool) {
	t.Helper()

	field := parsed.LookUpField(fieldName)
	if field == nil {
		t.Fatalf("%s field %s is missing", parsed.Name, fieldName)
	}
	if field.NotNull != want {
		t.Fatalf("%s.%s NotNull = %v, want %v", parsed.Name, fieldName, field.NotNull, want)
	}
}

func assertIndex(t *testing.T, parsed *schema.Schema, indexName string, unique bool, columns ...string) {
	t.Helper()

	indexes := parsed.ParseIndexes()
	for _, index := range indexes {
		if index.Name != indexName {
			continue
		}
		if (index.Class == "UNIQUE") != unique {
			t.Fatalf("%s index %s unique = %v, want %v", parsed.Name, indexName, index.Class == "UNIQUE", unique)
		}
		var got []string
		for _, option := range index.Fields {
			got = append(got, option.DBName)
		}
		if !reflect.DeepEqual(got, columns) {
			t.Fatalf("%s index %s columns = %#v, want %#v", parsed.Name, indexName, got, columns)
		}
		return
	}
	t.Fatalf("%s index %s is missing", parsed.Name, indexName)
}
