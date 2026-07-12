# Rust 错误设计来源说明

## 官方共识

Rust API Guidelines:

- public function 返回 `Result<T, E>` 时，`E` 应是有意义的错误类型。
- 错误类型应实现 `std::error::Error` 和 `Display`。
- 错误类型通常也应满足 `Send + Sync`，便于跨线程和异步场景传播。
- 不要使用 `()` 作为错误类型。
- public API 的错误条件应写入文档。
- 错误消息建议小写且不加句末标点，除非语境要求。

## 社区惯例

Rust CLI Book:

- application / CLI crate 可用 `anyhow` 简化错误传播。
- 对用户可见的错误应添加上下文，便于诊断。

Rust Cookbook:

- 展示组合错误、转换错误、传播错误的常见写法。

`thiserror` crate:

- 适合为 library crate 定义枚举错误，并自动实现 `Display` 与 `std::error::Error`。
- `#[from]` 用于来源错误转换。
- `#[error(transparent)]` 用于透明包装底层错误。

## 项目偏好

- library public API 默认不返回 `anyhow::Error`。
- crate 级错误默认放 `src/error.rs`，由 `lib.rs` re-export。
- 领域错误只在复杂或复用时拆到 `src/<module>/error.rs`。
- `Result<T>` alias 只能绑定清晰稳定的统一错误类型。
