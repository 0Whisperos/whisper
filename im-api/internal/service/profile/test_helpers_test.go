package profile

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"strconv"
	"strings"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

type fakeStore struct {
	putRequest  storage.PresignedRequest
	getRequest  storage.PresignedRequest
	object      storage.Object
	readErr     error
	writeErr    error
	deleteErr   error
	putKey      string
	putType     string
	getKey      string
	readKey     string
	writtenKey  string
	written     []byte
	writtenType string
	deleted     []string
}

func (store *fakeStore) PresignPut(_ context.Context, key, contentType string) (storage.PresignedRequest, error) {
	store.putKey = key
	store.putType = contentType
	return store.putRequest, nil
}

func (store *fakeStore) PresignGet(_ context.Context, key string) (storage.PresignedRequest, error) {
	store.getKey = key
	return store.getRequest, nil
}

func (store *fakeStore) ReadObject(_ context.Context, key string, _ int64) (storage.Object, error) {
	store.readKey = key
	return store.object, store.readErr
}

func (store *fakeStore) WriteObject(_ context.Context, key string, data []byte, contentType string) error {
	store.writtenKey = key
	store.written = append([]byte(nil), data...)
	store.writtenType = contentType
	return store.writeErr
}

func (store *fakeStore) DeleteObject(_ context.Context, key string) error {
	store.deleted = append(store.deleted, key)
	return store.deleteErr
}

func installProfileTestDependencies(t *testing.T, store storage.Store) {
	t.Helper()
	oldStore := objectStore
	oldPrefix := objectPrefix
	oldFind := findUserByID
	oldUpdate := updateUserProfile
	oldRandom := randomRead
	t.Cleanup(func() {
		objectStore = oldStore
		objectPrefix = oldPrefix
		findUserByID = oldFind
		updateUserProfile = oldUpdate
		randomRead = oldRandom
	})
	randomRead = func(data []byte) (int, error) {
		for index := range data {
			data[index] = 0xab
		}
		return len(data), nil
	}
	Configure(store, "avatars/")
}

func testAvatarKey(userID uint64, extension string) string {
	return "avatars/pending/" + strconv.FormatUint(userID, 10) + "/00112233445566778899aabbccddeeff" + extension
}

func testCommittedAvatarKey(userID uint64, extension string) string {
	return "avatars/committed/" + strconv.FormatUint(userID, 10) + "/" + strings.Repeat("ab", 16) + extension
}

func testOldAvatarKey(userID uint64, extension string) string {
	return "avatars/committed/" + strconv.FormatUint(userID, 10) + "/" + strings.Repeat("fe", 16) + extension
}

func pngBytes(size int) []byte {
	var contents bytes.Buffer
	_ = png.Encode(&contents, image.NewNRGBA(image.Rect(0, 0, 1, 1)))
	data := contents.Bytes()
	if size <= len(data) {
		return append([]byte(nil), data[:size]...)
	}
	data = append([]byte(nil), data...)
	data = append(data, make([]byte, size-len(data))...)
	return data
}
