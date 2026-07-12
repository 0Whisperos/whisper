---
name: rust-error-design
description: 在本项目中设计 Rust 错误类型、public error API、Result<T, E>、thiserror/anyhow 策略，或调整错误暴露边界时使用。
---

# Rust 错误设计

## 核心原则

错误类型是 API 契约的一部分。library crate 应暴露调用方能理解和处理的错误；application / binary crate 可在边界聚合错误并添加上下文。

需要完整示例时，阅读 `references/error-examples.md`。需要来源依据时，阅读 `references/source-notes.md`。

## library crate

默认定义明确错误 enum，并实现 `std::error::Error` 与 `Display`。优先使用 `thiserror`：

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("empty message")]
    EmptyMessage,

    #[error("invalid message format")]
    InvalidFormat,

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
```

只有在依赖受限、错误极少、或 crate 明确不引入 derive 依赖时，才手写 `Display` / `Error`。

## application / binary crate

应用边界可以使用 `anyhow::Result` 聚合错误，并用 `.context(...)` 增加诊断信息。

不要把 `anyhow::Error` 作为 library public API 的默认返回错误类型。

## public API 暴露边界

public API 不默认暴露：

- `anyhow::Error`
- `Box<dyn std::error::Error>`
- 底层库错误细节
- `()` 或字符串错误

public error variant 应表达调用方可理解或可处理的失败原因。底层错误只在它确实是公开契约的一部分时才透明暴露。

## 文件位置

| 错误类型 | 推荐位置 | 说明 |
| --- | --- | --- |
| crate 级 public error | `src/error.rs` | 由 `lib.rs` re-export |
| 单一领域模块错误 | `src/<module>.rs` 或该领域子模块 | 只服务该模块时不必单独建文件 |
| 复杂领域错误 | `src/<module>/error.rs` | 错误 variant 多、转换多、文档多时拆分 |
| binary 边界错误 | `main.rs` / `app.rs` 附近 | 通常使用 `anyhow`，不作为 public API |

## `Result<T>` alias

只有当 crate 内有清晰稳定的统一错误类型时，才定义：

```rust
pub type Result<T> = std::result::Result<T, Error>;
```

不要在同一 crate 中定义多个含义不同的 `Result<T>` alias。模块局部错误可使用更具体的名称，或显式写出 `std::result::Result<T, ModuleError>`。

## 错误消息

- `Display` 面向人读，保持清晰。
- public variant 名称面向调用方处理，保持稳定。
- Rust API Guidelines 建议错误消息使用小写且不加句末标点，除非包含专有名词或多句文本。
