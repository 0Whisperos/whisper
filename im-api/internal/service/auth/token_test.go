package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSignAccessTokenCreatesVerifiableAccessClaims(t *testing.T) {
	// 测试目标：验证 access token 使用 HS256 签名，并包含 sub、typ=access、iat、exp。
	// 构造方法：使用固定时间和密钥签发 token，再用同一密钥解析 claims。
	// 输入数据：userID=20001，签发时间 2026-08-16 12:00:00 +08:00，TTL=15m。
	// 预期行为：解析得到 userID=20001，过期时间为签发时间后 15 分钟。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	tokenValue, expiresAt, err := signAccessToken(20001, now, 15*time.Minute, []byte("test-secret"))
	if err != nil {
		t.Fatalf("signAccessToken returned an error: %v", err)
	}

	claims, err := verifyAccessToken(tokenValue, []byte("test-secret"), now)
	if err != nil {
		t.Fatalf("verifyAccessToken returned an error: %v", err)
	}

	if claims.UserID != 20001 {
		t.Fatalf("UserID = %d, want 20001", claims.UserID)
	}
	if !claims.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("ExpiresAt = %v, want %v", claims.ExpiresAt, expiresAt)
	}
}

func TestVerifyAccessTokenRejectsExpiredToken(t *testing.T) {
	// 测试目标：验证过期 access token 返回稳定 ErrAccessTokenExpired。
	// 构造方法：在固定时间签发 15 分钟 token，并在过期后一秒验证。
	// 输入数据：签发时间 2026-08-16 12:00:00 UTC，验证时间 12:15:01 UTC。
	// 预期行为：错误可通过 errors.Is 判定为 ErrAccessTokenExpired。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	tokenValue, _, err := signAccessToken(20001, now, 15*time.Minute, []byte("test-secret"))
	if err != nil {
		t.Fatalf("signAccessToken returned an error: %v", err)
	}

	_, err = verifyAccessToken(tokenValue, []byte("test-secret"), now.Add(15*time.Minute+time.Second))

	if !errors.Is(err, ErrAccessTokenExpired) {
		t.Fatalf("verifyAccessToken error = %v, want ErrAccessTokenExpired", err)
	}
}

func TestVerifyAccessTokenRejectsWrongSignature(t *testing.T) {
	// 测试目标：验证签名密钥不匹配时 access token 被拒绝。
	// 构造方法：使用一个密钥签发 token，再用另一个密钥验证。
	// 输入数据：签发密钥 test-secret，验证密钥 other-secret。
	// 预期行为：错误可通过 errors.Is 判定为 ErrInvalidAccessToken。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	tokenValue, _, err := signAccessToken(20001, now, 15*time.Minute, []byte("test-secret"))
	if err != nil {
		t.Fatalf("signAccessToken returned an error: %v", err)
	}

	_, err = verifyAccessToken(tokenValue, []byte("other-secret"), now)

	if !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("verifyAccessToken error = %v, want ErrInvalidAccessToken", err)
	}
}

func TestVerifyAccessTokenRejectsWrongTokenType(t *testing.T) {
	// 测试目标：验证 typ 不是 access 的 JWT 不会被当作 access token 接受。
	// 构造方法：直接用 jwt/v5 构造 typ=refresh 的 HS256 token。
	// 输入数据：sub=20001，typ=refresh，未过期。
	// 预期行为：错误可通过 errors.Is 判定为 ErrInvalidAccessToken。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	claims := accessTokenPayload{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "20001",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
		},
		TokenType: "refresh",
	}
	tokenValue, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("SignedString returned an error: %v", err)
	}

	_, err = verifyAccessToken(tokenValue, []byte("test-secret"), now)

	if !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("verifyAccessToken error = %v, want ErrInvalidAccessToken", err)
	}
}

func TestGenerateRefreshTokenUsesBase64URLWithoutPadding(t *testing.T) {
	// 测试目标：验证 refresh token 是 32 字节随机值的 base64url 无填充编码。
	// 构造方法：生成 refresh token 并检查长度、字符集和无 padding。
	// 输入数据：无。
	// 预期行为：token 非空、长度为 43、不包含 +、/、=。
	tokenValue, err := generateRefreshToken()
	if err != nil {
		t.Fatalf("generateRefreshToken returned an error: %v", err)
	}

	if len(tokenValue) != 43 {
		t.Fatalf("token length = %d, want 43", len(tokenValue))
	}
	if strings.ContainsAny(tokenValue, "+/=") {
		t.Fatalf("token %q is not raw base64url", tokenValue)
	}
}
