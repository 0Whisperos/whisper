package attachments

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/model/entity"
	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

type fakeStore struct {
	putCalls    int
	getCalls    int
	stat        storage.ObjectMetadata
	statErr     error
	statResults []struct {
		metadata storage.ObjectMetadata
		err      error
	}
	presignErr error
	keys       []string
}

func (s *fakeStore) PresignPut(_ context.Context, key, contentType string) (storage.PresignedRequest, error) {
	s.putCalls++
	s.keys = append(s.keys, key)
	if s.presignErr != nil {
		return storage.PresignedRequest{}, s.presignErr
	}
	return storage.PresignedRequest{Method: "PUT", URL: "https://oss/upload", Headers: map[string]string{"Content-Type": contentType}, ExpiresAt: time.Unix(1_800_000_000, 0)}, nil
}
func (s *fakeStore) PresignGet(_ context.Context, key string) (storage.PresignedRequest, error) {
	s.getCalls++
	s.keys = append(s.keys, key)
	if s.presignErr != nil {
		return storage.PresignedRequest{}, s.presignErr
	}
	return storage.PresignedRequest{URL: "https://oss/download", ExpiresAt: time.Unix(1_800_000_000, 0)}, nil
}
func (s *fakeStore) StatObject(_ context.Context, key string) (storage.ObjectMetadata, error) {
	s.keys = append(s.keys, key)
	if len(s.statResults) > 0 {
		result := s.statResults[0]
		s.statResults = s.statResults[1:]
		return result.metadata, result.err
	}
	return s.stat, s.statErr
}
func (s *fakeStore) ReadObject(context.Context, string, int64) (storage.Object, error) {
	return storage.Object{}, nil
}
func (s *fakeStore) WriteObject(context.Context, string, []byte, string) error { return nil }
func (s *fakeStore) DeleteObject(context.Context, string) error                { return nil }

func installTestDependencies(t *testing.T, store *fakeStore) {
	t.Helper()
	oldStore, oldPrefix := objectStore, objectPrefix
	oldCreate, oldFind, oldMark, oldExpire, oldList := createAttachments, findAttachment, markAttachmentUploaded, markAttachmentExpired, listAttachments
	oldConversation, oldMember, oldNow, oldRandom := findConversation, isActiveMember, now, randomRead
	t.Cleanup(func() {
		objectStore, objectPrefix = oldStore, oldPrefix
		createAttachments, findAttachment, markAttachmentUploaded, markAttachmentExpired, listAttachments = oldCreate, oldFind, oldMark, oldExpire, oldList
		findConversation, isActiveMember, now, randomRead = oldConversation, oldMember, oldNow, oldRandom
	})
	objectStore = store
	objectPrefix = "files/attachments/"
	findConversation = func(id uint64) (entity.Conversation, bool, error) {
		return entity.Conversation{ID: id, ConversationType: "direct"}, true, nil
	}
	isActiveMember = func(uint64, uint64) (bool, error) { return true, nil }
	now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	randomRead = func(b []byte) (int, error) {
		for i := range b {
			b[i] = byte(i + 1)
		}
		return len(b), nil
	}
}

func TestAuthorizeUploadsCreatesOrderedPrivateAuthorizations(t *testing.T) {
	// 测试目标：验证批量授权遵守文件顺序、仅持久化服务端对象映射且响应不暴露 OSS key。
	// 构造方法：安装成功的会话权限、对象存储与记录写入替身，申请两张不同类型图片的授权。
	// 输入数据：会话 42、用户 7，依次上传 1,200 字节 PNG 与 800 字节 WebP。
	// 预期行为：返回两个各自的 PUT 授权和 UUID，记录状态为 uploading，JSON 响应不含对象 key。
	store := &fakeStore{}
	installTestDependencies(t, store)
	var saved []entity.Attachment
	createAttachments = func(_ context.Context, rows []entity.Attachment) error {
		saved = append([]entity.Attachment(nil), rows...)
		return nil
	}
	result, err := AuthorizeUploads(context.Background(), 7, UploadRequest{ConversationID: 42, Files: []UploadFile{{FileName: "a.png", ContentType: "image/png", SizeBytes: 1200}, {FileName: "b.webp", ContentType: "image/webp", SizeBytes: 800}}})
	if err != nil {
		t.Fatalf("AuthorizeUploads returned error: %v", err)
	}
	if len(result) != 2 || len(saved) != 2 || result[0].AttachmentID != saved[0].AttachmentID || saved[0].Status != "uploading" || saved[1].ContentType != "image/webp" {
		t.Fatalf("result=%#v saved=%#v, want two ordered uploading records", result, saved)
	}
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "files/attachments/") {
		t.Fatalf("authorization JSON leaked object key: %s", body)
	}
}

func TestAuthorizeUploadsRejectsBatchBeforeCreatingRecords(t *testing.T) {
	// 测试目标：验证上传授权对图片格式、单图/批次大小和成员权限进行整批拒绝。
	// 构造方法：分别提交 SVG、超限尺寸、非成员请求，并记录授权和数据库写入调用。
	// 输入数据：SVG 图片、20 MiB+1 图片，或成员检查返回 false 的合法 PNG 请求。
	// 预期行为：依次返回 unsupported_image_type、attachment_too_large、not_conversation_member，且未创建附件行。
	for _, scenario := range []struct {
		name   string
		file   UploadFile
		member bool
		want   error
	}{
		{name: "rejects svg", file: UploadFile{FileName: "x.svg", ContentType: "image/svg+xml", SizeBytes: 1}, member: true, want: ErrUnsupportedImageType},
		{name: "rejects oversized image", file: UploadFile{FileName: "x.png", ContentType: "image/png", SizeBytes: MaxImageBytes + 1}, member: true, want: ErrAttachmentTooLarge},
		{name: "rejects non member", file: UploadFile{FileName: "x.png", ContentType: "image/png", SizeBytes: 1}, member: false, want: ErrNotConversationMember},
	} {
		// 测试目标：验证当前场景拒绝指定非法参数或权限。
		// 构造方法：设置场景中的成员权限，并以单文件请求调用授权服务。
		// 输入数据：场景名称对应的文件字段、尺寸和成员标记。
		// 预期行为：返回指定稳定错误，且授权与持久化均未发生。
		t.Run(scenario.name, func(t *testing.T) {
			store := &fakeStore{}
			installTestDependencies(t, store)
			isActiveMember = func(uint64, uint64) (bool, error) { return scenario.member, nil }
			created := false
			createAttachments = func(context.Context, []entity.Attachment) error { created = true; return nil }
			_, err := AuthorizeUploads(context.Background(), 7, UploadRequest{ConversationID: 42, Files: []UploadFile{scenario.file}})
			if !errors.Is(err, scenario.want) {
				t.Fatalf("error=%v, want %v", err, scenario.want)
			}
			if created || store.putCalls != 0 {
				t.Fatalf("created=%v presign calls=%d, want no side effects", created, store.putCalls)
			}
		})
	}
}

func TestConfirmUploadsUsesObjectMetadataAndSupportsRetry(t *testing.T) {
	// 测试目标：验证完成确认只用对象元数据，并让 uploaded 状态重试返回已保存尺寸。
	// 构造方法：让 HEAD 元数据返回 1,234 字节，捕获状态更新，再将同一附件模拟为 uploaded 重试。
	// 输入数据：当前用户 7 确认合法 UUID 附件，OSS 对象大小为 1,234 字节。
	// 预期行为：首次转为 uploaded 并持久化实际大小；重试不再查询 OSS，仍返回 uploaded 和相同大小。
	store := &fakeStore{stat: storage.ObjectMetadata{Size: 1234}}
	installTestDependencies(t, store)
	id := "12345678-1234-4234-8234-123456789abc"
	row := entity.Attachment{AttachmentID: id, UploaderUserID: 7, Status: "uploading", ObjectKey: "secret/key"}
	updates := 0
	findAttachment = func(context.Context, string) (entity.Attachment, bool, error) { return row, true, nil }
	markAttachmentUploaded = func(_ context.Context, _ string, _ uint64, size int64, _ time.Time) error {
		updates++
		row.Status = "uploaded"
		row.SizeBytes = size
		return nil
	}
	first, err := ConfirmUploads(context.Background(), 7, CompletionRequest{AttachmentIDs: []string{id}})
	if err != nil {
		t.Fatal(err)
	}
	if first[0].Status != "uploaded" || first[0].SizeBytes != 1234 || updates != 1 {
		t.Fatalf("completion=%#v updates=%d", first, updates)
	}
	second, err := ConfirmUploads(context.Background(), 7, CompletionRequest{AttachmentIDs: []string{id}})
	if err != nil {
		t.Fatal(err)
	}
	if second[0].Status != "uploaded" || second[0].SizeBytes != 1234 || len(store.keys) != 1 {
		t.Fatalf("retry=%#v metadata calls=%d", second, len(store.keys))
	}
}

func TestConfirmUploadsReportsMetadataFailuresAndExpiresOversizedObject(t *testing.T) {
	// 测试目标：验证对象不存在与存储故障可重试，实际对象超限则进入 expired。
	// 构造方法：依次为不同附件提供 NotFound、普通存储错误和超过 20 MiB 的元数据，并捕获过期更新。
	// 输入数据：三个 uploading 附件分别对应缺失对象、HEAD 失败、20 MiB+1 对象。
	// 预期行为：逐项返回 object_not_found、storage_unavailable、attachment_too_large；超限附件状态变为 expired。
	store := &fakeStore{}
	installTestDependencies(t, store)
	ids := []string{"12345678-1234-4234-8234-123456789abc", "22345678-1234-4234-8234-123456789abc", "32345678-1234-4234-8234-123456789abc"}
	rows := map[string]entity.Attachment{}
	for _, id := range ids {
		rows[id] = entity.Attachment{AttachmentID: id, UploaderUserID: 7, Status: "uploading", ObjectKey: id}
	}
	findAttachment = func(_ context.Context, id string) (entity.Attachment, bool, error) { return rows[id], true, nil }
	store.statResults = []struct {
		metadata storage.ObjectMetadata
		err      error
	}{{err: storage.ErrObjectNotFound}, {err: errors.New("connection reset")}, {metadata: storage.ObjectMetadata{Size: MaxImageBytes + 1}}}
	markAttachmentExpired = func(_ context.Context, id string, _ uint64) error {
		rows[id] = entity.Attachment{AttachmentID: id, UploaderUserID: 7, Status: "expired"}
		return nil
	}
	markAttachmentUploaded = func(context.Context, string, uint64, int64, time.Time) error { return nil }
	results, err := ConfirmUploads(context.Background(), 7, CompletionRequest{AttachmentIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"object_not_found", "storage_unavailable", "attachment_too_large"}
	for i := range results {
		if results[i].ErrorCode != want[i] {
			t.Errorf("result[%d]=%#v, want error %q", i, results[i], want[i])
		}
	}
	if results[2].Status != "expired" || rows[ids[2]].Status != "expired" {
		t.Fatalf("oversized result=%#v row=%#v, want expired", results[2], rows[ids[2]])
	}
}

func TestAuthorizeDownloadsRejectsWholeBatchForUnavailableAttachment(t *testing.T) {
	// 测试目标：验证下载授权在任一附件不属于当前会话或未关联消息时整批拒绝。
	// 构造方法：配置有效会话成员，并让批次中一个附件已关联、另一个仍处于 uploaded。
	// 输入数据：两个合法附件 ID，其中第二条附件记录没有 message_id 且状态为 uploaded。
	// 预期行为：返回 attachment_unavailable，且没有为第一条附件签发部分下载 URL。
	store := &fakeStore{}
	installTestDependencies(t, store)
	ids := []string{"12345678-1234-4234-8234-123456789abc", "22345678-1234-4234-8234-123456789abc"}
	messageID := "message-uuid"
	listAttachments = func(context.Context, []string) ([]entity.Attachment, error) {
		return []entity.Attachment{{AttachmentID: ids[0], ConversationID: 42, Status: "attached", MessageID: &messageID, ObjectKey: "hidden/one", ContentType: "image/png", SizeBytes: 20}, {AttachmentID: ids[1], ConversationID: 42, Status: "uploaded", ObjectKey: "hidden/two"}}, nil
	}
	_, err := AuthorizeDownloads(context.Background(), 7, 42, CompletionRequest{AttachmentIDs: ids})
	if !errors.Is(err, ErrAttachmentUnavailable) {
		t.Fatalf("error=%v, want ErrAttachmentUnavailable", err)
	}
	if store.getCalls != 0 {
		t.Fatalf("presign GET calls=%d, want 0 for atomic batch rejection", store.getCalls)
	}
}
