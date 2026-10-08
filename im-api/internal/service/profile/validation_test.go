package profile

import (
	"bytes"
	"context"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"testing"

	"github.com/0Whisperos/whisper/im-server/internal/storage"
)

func TestValidateAvatarObjectAcceptsPNG(t *testing.T) {
	// 测试目标：验证服务端接受完整解码的 PNG，并将规范 Content-Type 固定为 image/png。
	// 构造方法：使用标准库编码 1x1 NRGBA 图片，将字节放入假对象存储。
	// 输入数据：有效 PNG 字节和 .png pending key。
	// 预期行为：校验成功，返回原始字节和 image/png。
	data := encodeTestImage(t, png.Encode)
	store := &fakeStore{object: storage.Object{Size: int64(len(data)), Data: data}}
	installProfileTestDependencies(t, store)

	avatar, err := validateAvatarObject(context.Background(), testAvatarKey(7, ".png"))
	if err != nil {
		t.Fatalf("validateAvatarObject returned an error: %v", err)
	}
	if avatar.ContentType != "image/png" || !bytes.Equal(avatar.Data, data) {
		t.Fatalf("avatar = content type %q, %d bytes; want image/png, %d bytes", avatar.ContentType, len(avatar.Data), len(data))
	}
}

func TestValidateAvatarObjectRejectsNonPNGImageBytes(t *testing.T) {
	// 测试目标：验证后缀伪装成 .png 的其他可解码图片不能通过对象校验。
	// 构造方法：分别编码 JPEG 和 GIF，放入假对象存储，并使用合法格式的 .png key。
	// 输入数据：有效 JPEG 或 GIF 字节，以及 avatars/pending/7/<随机值>.png。
	// 预期行为：两种输入均返回 ErrUnsupportedAvatar，不会因图片可解码而放行。
	testCases := []struct {
		name string
		data []byte
	}{
		// 测试目标：验证 JPEG 内容不能冒充 PNG。
		// 构造方法：使用标准库编码 1x1 NRGBA 图片为 JPEG。
		// 输入数据：有效 JPEG 图片字节和 .png key。
		// 预期行为：返回 ErrUnsupportedAvatar。
		{name: "JPEG bytes with PNG key", data: encodeTestImage(t, func(writer io.Writer, source image.Image) error { return jpeg.Encode(writer, source, nil) })},
		// 测试目标：验证 GIF 内容不能冒充 PNG。
		// 构造方法：使用标准库编码 1x1 NRGBA 图片为 GIF。
		// 输入数据：有效 GIF 图片字节和 .png key。
		// 预期行为：返回 ErrUnsupportedAvatar。
		{name: "GIF bytes with PNG key", data: encodeTestImage(t, func(writer io.Writer, source image.Image) error { return gif.Encode(writer, source, nil) })},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			store := &fakeStore{object: storage.Object{Size: int64(len(testCase.data)), Data: testCase.data}}
			installProfileTestDependencies(t, store)
			_, err := validateAvatarObject(context.Background(), testAvatarKey(7, ".png"))
			if err != ErrUnsupportedAvatar {
				t.Fatalf("error = %v, want ErrUnsupportedAvatar", err)
			}
		})
	}
}

func encodeTestImage(t *testing.T, encode func(io.Writer, image.Image) error) []byte {
	t.Helper()
	var contents bytes.Buffer
	if err := encode(&contents, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("encode test image: %v", err)
	}
	return contents.Bytes()
}
