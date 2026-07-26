package auth

import (
	"encoding/hex"
	"errors"
	"testing"
)

func TestLoginRejectsInvalidRequest(t *testing.T) {
	// 测试目标：验证登录输入不符合账号或密码规则时返回稳定的无效请求错误。
	// 构造方法：在未初始化数据库的状态下调用 Login，使测试只经过输入校验分支。
	// 输入数据：7 位数字账号 "1234567" 与非空密码 "password"。
	// 预期行为：返回的错误可通过 errors.Is 判断为 ErrInvalidRequest。
	_, err := Login("1234567", "password")
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("Login error = %v, want ErrInvalidRequest", err)
	}
}

func TestGenerateAccessTokenProducesRandomHexToken(t *testing.T) {
	// 测试目标：验证 access token 由 32 字节安全随机数据编码为十六进制字符串。
	// 构造方法：连续调用两次 token 生成函数，并分别验证长度、编码合法性和结果差异。
	// 输入数据：无外部输入，由 crypto/rand 生成两组 token 数据。
	// 预期行为：两个 token 均为 64 个十六进制字符，且不相同。
	first, err := generateAccessToken()
	if err != nil {
		t.Fatalf("generateAccessToken returned an error: %v", err)
	}
	second, err := generateAccessToken()
	if err != nil {
		t.Fatalf("generateAccessToken returned an error: %v", err)
	}

	for _, token := range []string{first, second} {
		if len(token) != 64 {
			t.Errorf("token length = %d, want 64", len(token))
		}
		if _, err := hex.DecodeString(token); err != nil {
			t.Errorf("token %q is not valid hexadecimal: %v", token, err)
		}
	}
	if first == second {
		t.Error("two generated access tokens are identical")
	}
}

func TestHashAccessTokenDoesNotReturnRawToken(t *testing.T) {
	// 测试目标：验证持久化用 token hash 是确定的 SHA-256 十六进制值，而非原始 token。
	// 构造方法：对固定 token 调用哈希函数，并比较其长度、确定性和与原始值的差异。
	// 输入数据：原始 token "0123456789abcdef"。
	// 预期行为：hash 长度为 64，重复计算结果一致，且不等于原始 token。
	const token = "0123456789abcdef"

	firstHash := hashAccessToken(token)
	secondHash := hashAccessToken(token)

	if len(firstHash) != 64 {
		t.Errorf("hash length = %d, want 64", len(firstHash))
	}
	if firstHash != secondHash {
		t.Errorf("hash values differ: %q != %q", firstHash, secondHash)
	}
	if firstHash == token {
		t.Error("hashAccessToken returned the raw token")
	}
}
