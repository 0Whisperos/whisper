---
name: rust-code-organization
description: 在本项目中创建 Rust crate、拆分或重构 Rust 模块、新建 .rs 文件、定义 mod、调整 Rust 可见性或评估 Rust 文件边界时使用。
---

# Rust 代码组织

## 核心原则

先从当前代码和 `Cargo.toml` 收集证据，再判断结构。不要凭记忆套模板。

`rust-code-organization` 是 Rust 结构入口 skill，只保留高频规则。需要测试或错误 API 细节时，按需加载相关 skill，避免占用上下文。

## 必须同时加载的内容

- 涉及新增、修改、迁移 Rust 测试，或判断测试放置位置时，加载 `.agent/skills/rust-testing/SKILL.md`。
- 涉及错误类型、public error API、`Result<T, E>`、`thiserror` 或 `anyhow` 时，加载 `.agent/skills/rust-error-design/SKILL.md`。
- 涉及多 crate workspace 边界时，阅读 `references/workspace-layout.md`。
- 需要正反例时，阅读 `references/examples.md`。
- 需要来源依据时，阅读 `references/research-sources.md`。

## 来源分级

- 官方共识：Rust Book、Cargo Book、Rust Reference、Rust API Guidelines。
- 社区惯例：Rust CLI Book、Rust Cookbook、rust-unofficial/patterns、社区大型项目经验。
- 知名 crate 实践：Tokio、Serde、Clap 等真实源码结构。
- 项目偏好：本 skill 明确写出的阈值和默认选择。

## 文件类型规则

| 文件类型 | 应放内容 | 不应放内容 | 来源 |
| --- | --- | --- | --- |
| `src/lib.rs` | crate 文档、crate 级属性、`mod` / `pub mod`、`pub use`、feature cfg、少量 facade API | 大段业务逻辑、复杂函数体、具体算法实现 | 官方共识 + 知名 crate 实践 |
| `src/main.rs` | 参数解析、日志初始化、依赖装配、调用 library、进程退出码处理 | 可测试核心逻辑、领域模型、长流程实现 | 社区惯例 |
| `src/<module>.rs` | 模块入口、子模块声明、局部 re-export、该模块核心类型与 impl | 多个无关职责、跨领域工具堆放 | 官方共识 + 项目偏好 |
| `src/<module>/<child>.rs` | 子模块实现，服务于父模块职责 | 与父模块无关的独立领域逻辑 | 官方共识 + 项目偏好 |
| `tests/` | 通过 public API 验证集成行为 | 测私有 helper 或内部模块路径 | 官方共识 |

## 模块文件路径

新代码必须使用现代模块路径：

```text
src/parser.rs
src/parser/token.rs
src/parser/ast.rs
```

不要新建 `src/parser/mod.rs`。它仍是合法 Rust，但属于旧路径风格；仅在维护既有代码或保持已有项目风格时保留，不作为新代码默认选择。

## 拆分判断

优先按职责拆分，行数只作为提示。出现任一信号时必须评估拆分：

- 单文件约 `300` 行且仍在增长。
- 一个文件包含 `3+` 个明显职责。
- 同一文件有多个独立变化原因。
- public API、解析、IO、错误处理、测试夹在一起。
- 阅读、测试或修改该文件时需要同时理解过多上下文。

不要机械拆分小文件；如果一个 `120` 行文件职责单一、边界清楚，可以保留。

## 可见性

默认从最小可见性开始：

1. private：模块内部实现细节。
2. `pub(crate)`：crate 内共享，但不进入 public API。
3. `pub`：稳定公开契约，只有调用方确实需要时才使用。

public API 一旦暴露就有兼容性成本。新增 `pub` 前必须确认它属于对外契约，而不是为了绕过模块边界。

## 类型与 impl

默认把类型定义和核心 `impl` 放在同一文件，便于阅读和维护。只有当文件过大、trait impl 成组增长，或存在清晰职责边界时，才拆到子模块。

不要按 `types.rs` / `impl.rs` 机械分离；这不是本项目默认 Rust 风格。
