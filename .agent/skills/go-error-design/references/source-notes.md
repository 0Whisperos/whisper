# Go 错误设计来源

## 官方机制与指导

- Package errors: https://pkg.go.dev/errors
  - `errors.Is` 遍历错误树判断身份，优于直接相等。
  - `errors.As` 从错误树提取匹配类型。
  - 错误通过 `Unwrap() error` 或 `Unwrap() []error` 形成错误树。
- Go 1.13 errors: https://go.dev/blog/go1.13-errors
  - `fmt.Errorf` 的 `%w` 支持包装。
  - 包装会使底层错误成为调用方可检查的 API，需要有意识地选择。
- Errors are values: https://go.dev/blog/errors-are-values
  - 错误应作为值组合和处理，不应只被当作字符串。
- Go Code Review Comments, Error Strings: https://go.dev/wiki/CodeReviewComments#error-strings
  - 错误字符串通常小写开头且不加标点，以便被其他上下文组合。
- Package context: https://pkg.go.dev/context
  - `Canceled` 与 `DeadlineExceeded` 是调用方可能需要通过 `errors.Is` 判断的稳定错误。

## 社区惯例

- 在 adapter 边界隔离第三方 SDK 错误，避免供应商类型扩散到领域 API。
- 在进程或协议边界统一记录错误，减少重复日志与敏感信息泄漏。
- 是否重试由操作语义和幂等性决定，而不是仅由错误类别决定。

## 项目偏好

- 标准 `error`、`fmt.Errorf("...: %w", err)` 和 `errors.Is/As` 是默认选择。
- 只为调用方真实处理的稳定失败导出 sentinel 或类型错误。
- 不预建通用 `fault` package、错误分类树或把 HTTP status 放进领域错误。
- 测试必须遵守 `go-testing` 和 `AGENTS.md` 的四项描述性注释要求。
