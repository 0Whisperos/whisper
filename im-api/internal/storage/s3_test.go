package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/aws/smithy-go"
)

func TestS3StorePresignsPathStyleUploadWithoutNetworkRequest(t *testing.T) {
	// 测试目标：验证 S3 兼容配置可生成客户端直传所需的 path-style PUT URL 和签名请求头。
	// 构造方法：用本机 endpoint、静态测试密钥创建 S3Store，只调用不会联网的 PresignPut。
	// 输入数据：bucket=whisper-test、key=avatars/7/test.png、Content-Type=image/png、TTL=10m。
	// 预期行为：方法为 PUT，URL 包含 bucket/key 和 600 秒有效期，headers 包含 image/png。
	store, err := NewS3(context.Background(), config.StorageConfig{
		Endpoint:        "http://127.0.0.1:9000",
		Region:          "us-east-1",
		BucketName:      "whisper-test",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		ForcePathStyle:  true,
		UploadURLTTL:    "10m",
		DownloadURLTTL:  "5m",
	})
	if err != nil {
		t.Fatalf("NewS3 returned an error: %v", err)
	}
	store.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	authorization, err := store.PresignPut(context.Background(), "avatars/7/test.png", "image/png")
	if err != nil {
		t.Fatalf("PresignPut returned an error: %v", err)
	}
	if authorization.Method != "PUT" || !strings.Contains(authorization.URL, "/whisper-test/avatars/7/test.png") || !strings.Contains(authorization.URL, "X-Amz-Expires=600") {
		t.Fatalf("authorization = %#v, want path-style PUT valid for 600 seconds", authorization)
	}
	if authorization.Headers["Content-Type"] != "image/png" {
		t.Fatalf("headers = %#v, want signed Content-Type image/png", authorization.Headers)
	}
	if !authorization.ExpiresAt.Equal(time.Unix(1_700_000_000, 0).UTC().Add(10 * time.Minute)) {
		t.Fatalf("ExpiresAt = %v, want fixed now + 10m", authorization.ExpiresAt)
	}
}

func TestS3StoreWriteObjectAvoidsStreamingChecksumTrailer(t *testing.T) {
	// 测试目标：验证写入 S3 兼容存储时，不发送 OSS 不支持的流式校验和 trailer。
	// 构造方法：启动 httptest S3 endpoint，使用正式 S3Store 配置调用 WriteObject，并记录收到的 HTTP 请求。
	// 输入数据：对象 key=avatars/committed/test.png、内容为 PNG 测试字节、Content-Type=image/png。
	// 预期行为：服务端收到完整对象内容，且请求不包含 STREAMING-UNSIGNED-PAYLOAD-TRAILER 编码。
	requestReceived := make(chan *http.Request, 1)
	bodyReceived := make(chan []byte, 1)
	endpoint := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestReceived <- request.Clone(context.Background())
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		bodyReceived <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer endpoint.Close()

	store, err := NewS3(context.Background(), config.StorageConfig{
		Endpoint:        endpoint.URL,
		Region:          "cn-hangzhou",
		BucketName:      "whisper-test",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		ForcePathStyle:  true,
		UploadURLTTL:    "10m",
		DownloadURLTTL:  "5m",
	})
	if err != nil {
		t.Fatalf("NewS3 returned an error: %v", err)
	}

	objectData := []byte("test image payload")
	if err := store.WriteObject(context.Background(), "avatars/committed/test.png", objectData, "image/png"); err != nil {
		t.Fatalf("WriteObject returned an error: %v", err)
	}

	request := <-requestReceived
	if got := request.Header.Get("Content-Encoding"); strings.Contains(got, "aws-chunked") {
		t.Fatalf("Content-Encoding = %q, want no aws-chunked encoding", got)
	}
	if got := request.Header.Get("x-amz-content-sha256"); strings.Contains(got, "STREAMING-UNSIGNED-PAYLOAD-TRAILER") {
		t.Fatalf("x-amz-content-sha256 = %q, want no streaming checksum trailer", got)
	}
	if got := request.Header.Get("x-amz-trailer"); got != "" {
		t.Fatalf("x-amz-trailer = %q, want no checksum trailer", got)
	}
	if got := <-bodyReceived; string(got) != string(objectData) {
		t.Fatalf("request body = %q, want %q", got, objectData)
	}
}

func TestPreserveContextErrorKeepsCancellationIdentity(t *testing.T) {
	// 测试目标：验证 S3 适配层不会丢失 context cancellation 的稳定错误语义。
	// 构造方法：创建并立即取消 context，再把普通 SDK 错误交给错误转换函数。
	// 输入数据：context.Canceled 和文本为 sdk failed 的底层错误。
	// 预期行为：返回错误可通过 errors.Is 识别为 context.Canceled。
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := preserveContextError(ctx, "read S3 object", errors.New("sdk failed"))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled identity", err)
	}
}

func TestMapS3ErrorConvertsNoSuchKeyToLocalSentinel(t *testing.T) {
	// 测试目标：验证对象不存在时不会向业务层泄漏 AWS SDK 的具体错误类型。
	// 构造方法：构造 smithy NoSuchKey API 错误并调用 S3 错误转换函数。
	// 输入数据：Code=NoSuchKey、Message=missing。
	// 预期行为：返回错误可通过 errors.Is 识别为本地 ErrObjectNotFound。
	sdkError := &smithy.GenericAPIError{Code: "NoSuchKey", Message: "missing"}

	err := mapS3Error(context.Background(), "read S3 object", sdkError)
	if !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("error = %v, want ErrObjectNotFound", err)
	}
}
