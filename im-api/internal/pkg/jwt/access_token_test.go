package jwt

import (
	"errors"
	"testing"
	"time"
)

func TestAccessTokenSignAndVerifyReturnsClaims(t *testing.T) {
	// 测试目标：验证 access token 签发后可以校验出用户 ID 和过期时间。
	// 构造方法：配置 JWT secret 和 TTL，在固定时间签发 token，再用相同时间校验。
	// 输入数据：userID=20001，now=2026-08-16T12:00:00Z，TTL=15m。
	// 预期行为：校验返回 userID=20001，expires_at=now+15m。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	Configure([]byte("test-secret"), 15*time.Minute)

	tokenValue, expiresAt, err := SignAccessToken(20001, now)
	if err != nil {
		t.Fatalf("SignAccessToken returned an error: %v", err)
	}
	claims, err := VerifyAccessToken(tokenValue, now)
	if err != nil {
		t.Fatalf("VerifyAccessToken returned an error: %v", err)
	}

	if claims.UserID != 20001 {
		t.Fatalf("UserID = %d, want 20001", claims.UserID)
	}
	if !claims.ExpiresAt.Equal(expiresAt) || !expiresAt.Equal(now.Add(15*time.Minute)) {
		t.Fatalf("expiresAt = %v, claims.ExpiresAt = %v, want %v", expiresAt, claims.ExpiresAt, now.Add(15*time.Minute))
	}
}

func TestAccessTokenVerifyRejectsExpiredToken(t *testing.T) {
	// 测试目标：验证过期 access token 返回稳定 ErrTokenExpired。
	// 构造方法：配置短 TTL 后签发 token，再使用过期后的时间校验。
	// 输入数据：TTL=1m，校验时间为签发时间后 2m。
	// 预期行为：错误可通过 errors.Is 判定为 ErrTokenExpired。
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	Configure([]byte("test-secret"), time.Minute)
	tokenValue, _, err := SignAccessToken(20001, now)
	if err != nil {
		t.Fatalf("SignAccessToken returned an error: %v", err)
	}

	_, err = VerifyAccessToken(tokenValue, now.Add(2*time.Minute))

	if !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("VerifyAccessToken error = %v, want ErrTokenExpired", err)
	}
}

func TestAccessTokenVerifyRejectsInvalidToken(t *testing.T) {
	// 测试目标：验证非法 token 返回稳定 ErrInvalidToken，且不暴露解析细节。
	// 构造方法：配置 JWT secret 后直接校验明显非法的 token 字符串。
	// 输入数据：tokenValue=not-a-token。
	// 预期行为：错误可通过 errors.Is 判定为 ErrInvalidToken。
	Configure([]byte("test-secret"), 15*time.Minute)

	_, err := VerifyAccessToken("not-a-token", time.Now())

	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("VerifyAccessToken error = %v, want ErrInvalidToken", err)
	}
}
