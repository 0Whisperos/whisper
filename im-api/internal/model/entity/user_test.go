package entity

import (
	"reflect"
	"testing"
)

func TestUserProfileFieldsHaveEmptyDatabaseDefaults(t *testing.T) {
	// Test goal: verify the user entity exposes nickname and signature as non-null fields with empty database defaults.
	// Construction: inspect the GORM tags on the User entity and instantiate its zero value.
	// Input: User{} with no nickname or signature configured.
	// Expected behavior: both fields are empty strings and their tags specify not-null default '' migration metadata.
	user := User{}
	if user.Nickname != "" || user.Signature != "" {
		t.Fatalf("zero-value profile fields = nickname %q signature %q, want empty strings", user.Nickname, user.Signature)
	}

	typeOfUser := reflect.TypeOf(User{})
	for _, fieldName := range []string{"Nickname", "Signature"} {
		field, ok := typeOfUser.FieldByName(fieldName)
		if !ok {
			t.Fatalf("User is missing %s", fieldName)
		}
		tag := field.Tag.Get("gorm")
		if !containsTagPart(tag, "not null") || !containsTagPart(tag, "default:''") {
			t.Fatalf("User.%s gorm tag = %q, want not null and default:''", fieldName, tag)
		}
	}
}

func containsTagPart(tag, part string) bool {
	for _, value := range splitTag(tag) {
		if value == part {
			return true
		}
	}
	return false
}

func splitTag(tag string) []string {
	result := make([]string, 0)
	start := 0
	for index := 0; index <= len(tag); index++ {
		if index == len(tag) || tag[index] == ';' {
			result = append(result, tag[start:index])
			start = index + 1
		}
	}
	return result
}
