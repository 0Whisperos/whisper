package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	authjwt "github.com/0Whisperos/whisper/im-server/internal/pkg/jwt"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

func TestRequireAccessTokenRejectsMissingAuthorizationHeader(t *testing.T) {
	// Test goal: verify protected routes reject requests without a Bearer access token.
	// Construction: install RequireAccessToken on a test Gin route and send a request without Authorization.
	// Input: GET /protected with no Authorization header.
	// Expected behavior: the response is 401 with error_code=invalid_token and the protected handler is not called.
	gin.SetMode(gin.TestMode)
	called := false
	router := gin.New()
	router.Use(RequireAccessToken())
	router.GET("/protected", func(context *gin.Context) {
		called = true
		context.Status(http.StatusNoContent)
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/protected", nil))

	if recorder.Code != http.StatusUnauthorized || called || recorder.Body.String() != `{"error_code":"invalid_token","message":"invalid access token"}` {
		t.Fatalf("status=%d called=%t body=%s", recorder.Code, called, recorder.Body.String())
	}
}

func TestRequireAccessTokenStoresVerifiedUserID(t *testing.T) {
	// Test goal: verify a valid Bearer JWT is accepted and its subject becomes the authenticated user ID.
	// Construction: configure the existing JWT signer, sign an access token for user 20001, and inspect the downstream context.
	// Input: Authorization=Bearer <valid token> and a GET /protected request.
	// Expected behavior: the downstream handler receives UserID=20001 and returns 204.
	gin.SetMode(gin.TestMode)
	auth.SetTokenConfig([]byte("middleware-test-secret"), time.Hour, time.Hour)
	token, _, err := authjwt.SignAccessToken(20001, time.Now())
	if err != nil {
		t.Fatalf("SignAccessToken returned an error: %v", err)
	}
	var downstreamUserID uint64
	router := gin.New()
	router.Use(RequireAccessToken())
	router.GET("/protected", func(context *gin.Context) {
		downstreamUserID, _ = UserID(context)
		context.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent || downstreamUserID != 20001 {
		t.Fatalf("status=%d user_id=%d, want 204 and 20001", recorder.Code, downstreamUserID)
	}
}

func TestRequireAccessTokenRejectsInvalidToken(t *testing.T) {
	// Test goal: verify a malformed or incorrectly signed access token is rejected with the stable invalid_token code.
	// Construction: configure the JWT signer, send a syntactically invalid token through a protected Gin route.
	// Input: Authorization=Bearer not-a-jwt and GET /protected.
	// Expected behavior: the response is 401 with error_code=invalid_token and the protected handler is not called.
	gin.SetMode(gin.TestMode)
	auth.SetTokenConfig([]byte("middleware-test-secret"), time.Hour, time.Hour)
	called := false
	router := gin.New()
	router.Use(RequireAccessToken())
	router.GET("/protected", func(context *gin.Context) {
		called = true
		context.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer not-a-jwt")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized || called || recorder.Body.String() != `{"error_code":"invalid_token","message":"invalid access token"}` {
		t.Fatalf("status=%d called=%t body=%s", recorder.Code, called, recorder.Body.String())
	}
}

func TestRequireAccessTokenRejectsExpiredToken(t *testing.T) {
	// Test goal: verify an expired access token is distinguished from a malformed token for client retry handling.
	// Construction: sign a token whose expiration is already in the past, then send it to a protected Gin route.
	// Input: Authorization=Bearer <expired token> and GET /protected.
	// Expected behavior: the response is 401 with error_code=token_expired and the protected handler is not called.
	gin.SetMode(gin.TestMode)
	auth.SetTokenConfig([]byte("middleware-test-secret"), time.Hour, time.Hour)
	token, _, err := authjwt.SignAccessToken(20001, time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("SignAccessToken returned an error: %v", err)
	}
	called := false
	router := gin.New()
	router.Use(RequireAccessToken())
	router.GET("/protected", func(context *gin.Context) {
		called = true
		context.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized || called || recorder.Body.String() != `{"error_code":"token_expired","message":"access token expired"}` {
		t.Fatalf("status=%d called=%t body=%s", recorder.Code, called, recorder.Body.String())
	}
}
