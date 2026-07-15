# Go 错误设计示例

## 简单 sentinel 与包装

```go
package verification

import (
	"errors"
	"fmt"
)

var ErrChallengeExpired = errors.New("challenge expired")

func (s *Service) Verify(id, code string) error {
	if err := s.store.Verify(id, code); err != nil {
		return fmt.Errorf("verify challenge: %w", err)
	}
	return nil
}
```

调用方通过身份判断，而不是比较文本：

```go
if errors.Is(err, verification.ErrChallengeExpired) {
	// 处理稳定的过期语义。
}
```

只有 `store.Verify` 返回的错误确实应成为上层可检查契约时才使用 `%w`。

## 携带结构化数据的类型错误

```go
type AttemptsExceededError struct {
	RemainingAfter time.Time
}

func (e *AttemptsExceededError) Error() string {
	return "verification attempts exceeded"
}
```

```go
var exceeded *AttemptsExceededError
if errors.As(err, &exceeded) {
	retryAt := exceeded.RemainingAfter
	_ = retryAt
}
```

如果调用方只需知道“尝试次数已超限”，sentinel 会更简单；只有调用方确实需要 `RemainingAfter` 时才使用类型错误。

## 协议边界映射

```go
func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, verification.ErrChallengeExpired):
		writeJSON(w, http.StatusGone, apiError{Code: "challenge_expired"})
	default:
		writeJSON(w, http.StatusInternalServerError, apiError{Code: "internal_error"})
	}
}
```

领域 package 不应返回 HTTP status，也不应知道 JSON 错误结构。未知错误的响应不得包含 `err.Error()`。

## 避免通用 fault 框架

不要在没有真实调用方需求时先建立：

```go
type Fault struct {
	Kind       Kind
	Code       string
	Retryable  bool
	HTTPStatus int
	Cause      error
}
```

它把领域、重试、协议和诊断混进一个类型。先使用普通错误、少量 sentinel 或聚焦类型；重复的稳定处理需求出现后再抽象。
