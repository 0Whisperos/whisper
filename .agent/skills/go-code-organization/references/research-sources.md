# Go 代码组织来源

制定规则时必须区分官方机制、社区惯例和项目偏好，不要把经验阈值写成 Go 语言要求。

## 官方机制与指导

- Go Modules Reference: https://go.dev/ref/mod
  - module 是共同发布、版本化和分发的一组 package。
  - `go.work` 用于多 module workspace，不替代各 module 的 `go.mod`。
- Organizing a Go module: https://go.dev/doc/modules/layout
  - 展示基础 package、`internal`、多个 command 与服务端项目的常见布局。
  - 布局应随项目规模和公开 API 需求演进。
- Go command package help: `go help packages`
  - package 由导入路径识别；`main` 表示可执行 command。
  - `testdata`、以 `.` 或 `_` 开头的目录由 Go 工具忽略。
- Go specification, Packages: https://go.dev/ref/spec#Packages
  - package 是声明与可见性的基本组织边界。
- Go 1.4 release notes, Internal packages: https://go.dev/doc/go1.4#internalpackages
  - `internal` 目录由 Go 工具链强制限制可导入范围。

## 社区惯例

- Effective Go: https://go.dev/doc/effective_go
  - package 名简短、清晰，导出名称应避免重复 package 语义。
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
  - 提供 package 命名、接口、错误与注释等常见评审建议。
- 标准库和 Go 官方仓库实践：入口通常聚焦装配，package 围绕能力组织；这不是固定目录模板。

## 项目偏好

- 结构决策必须先读取当前仓库证据。
- 不默认创建 `pkg/`、`utils`、`common` 或机械分层目录。
- 约 `300` 行、`3+` 职责是拆分提示，不是 Go 官方阈值。
- `go-code-organization` 只负责结构入口；测试与错误规则拆成独立 skill，按需加载。
