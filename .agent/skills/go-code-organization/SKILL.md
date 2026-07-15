---
name: go-code-organization
description: Use when 在本项目中创建或修改 Go module、package、cmd/internal 目录、导出 API、接口，或评估 Go 文件与服务边界。
---

# Go 代码组织

## 核心原则

先从当前仓库收集证据，再决定结构。检查 `go.mod`、`go.work`、已有 package、构建脚本和部署边界；没有证据时，不得自行固定单 module、多 module 或根 `go.work`。

需要测试组织时，必须加载 `go-testing`。涉及错误包装、公开错误 API 或跨 package 错误边界时，必须加载 `go-error-design`。

需要正反例时，阅读 `references/examples.md`；需要来源依据时，阅读 `references/research-sources.md`。

## Module 与服务边界

- `go.mod` 表示版本与依赖边界，不等同于每个目录或每个二进制。
- 新增 module 或 `go.work` 前，确认服务是否独立版本、发布、依赖和部署。
- 多个服务需要锁步发布且共享大量内部代码时，单 module 可能更简单；需要独立演进时，多 module 才可能合理。
- `go.work` 只用于需要的多 module 协作，不应成为生产构建或 CI 正确性的隐式前提。
- 仓库证据不足且选择会影响依赖或发布时，按 `AGENTS.md` 的澄清机制询问用户。

## Package 与目录

| 区域 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| `main` / `cmd/<name>/` | 配置读取、依赖装配、生命周期、进程退出 | 业务规则、长流程、具体存储或协议实现 |
| `internal/` | 不允许 module 外部导入的实现与领域 package | 为了显得分层而创建的空壳目录 |
| 领域 package | 围绕单一业务能力共同变化的类型和行为 | 按 controller/service/repository 机械切层 |
| 可复用 package | 已有多个真实调用方共享的稳定能力 | `utils`、`common`、`helpers` 等杂物集合 |

不要默认创建 `pkg/`。只有代码确实需要被 `internal` 边界之外的消费者导入，且 API 已有明确调用方时才评估使用。

package 名保持简短、小写且表达能力边界。避免 `models`、`types`、`misc` 这类仅按代码形态聚合的名称。

## 入口与依赖方向

- `main` 保持薄：完成装配后调用可测试的应用入口。
- 领域规则不依赖 HTTP、SMTP、Redis 等具体传输或 SDK 类型。
- 在使用方确实需要替代实现时，由使用方定义小接口；不要为每个 struct 预先创建接口。
- 避免循环依赖。出现循环时重新检查 package 是否按共同变化的能力划分。

## 导出与 API

- 默认使用未导出标识符。
- 只有其他 package 的真实调用方需要时才导出。
- 不要为了测试导出内部 helper；同 package 测试可以访问未导出实现。
- 导出类型和函数一旦被其他 package 使用，就要按兼容性契约对待。

## 文件拆分

优先按职责和变化原因拆分，同一 package 可以由多个聚焦文件组成。出现任一信号时必须评估拆分：

- 单文件约 `300` 行且仍在增长。
- 同一文件包含 `3+` 个明显职责。
- 配置、HTTP、领域规则、存储和错误映射混在一起。
- 修改或测试一个行为必须理解大量无关上下文。

行数只是项目提示，不是硬阈值。不要机械地按类型创建文件，也不要把职责单一的小文件继续拆碎。

## 验证

结构调整后至少运行：

```text
gofmt -w <changed-go-files>
go test ./...
go vet ./...
```

命令必须从包含目标 `go.mod` 的 module 根目录执行。多 module 仓库要逐个验证受影响 module，不能假设仓库根目录的 `go test ./...` 会覆盖全部代码。

## 常见错误

| 错误 | 处理 |
| --- | --- |
| 无证据就创建根 `go.work` 和每服务一个 `go.mod` | 先确认版本、依赖与部署边界 |
| 小服务预建完整分层目录 | 从能表达当前能力的最小 package 开始 |
| 把共享愿望当成真实复用 | 等出现至少两个明确调用方再抽取 |
| 为 mock 给每个类型配接口 | 只在使用方需要替代实现时定义小接口 |
| 所有实现都堆进 `main.go` | 让 `main` 只装配，把可测试行为放到聚焦 package |
