# Rust 代码组织调研来源

本文件记录制定 `rust-code-organization`、`rust-testing`、`rust-error-design` 时使用的来源。使用规则时必须区分来源等级，不要把项目偏好伪装成官方规范。

## 官方共识

- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
  - 模块、函数、类型、trait、常量命名规则。
  - public error type 应有意义，实现 `std::error::Error` 和 `Display`。
  - struct 字段默认私有，public API 需要考虑未来兼容性。
  - 未直接规定文件拆分阈值、`error.rs`、测试目录细节。
- Rust Book: https://doc.rust-lang.org/book/
  - 模块用于组织代码和控制隐私。
  - 单元测试可放在 `#[cfg(test)] mod tests`。
  - 集成测试放在 `tests/`，从外部使用 public API。
  - 现代模块文件路径使用 `src/foo.rs` 与 `src/foo/bar.rs`；旧路径 `src/foo/mod.rs` 仍合法但不作为新代码默认。
- Rust Reference: https://doc.rust-lang.org/reference/items/modules.html
  - 定义模块文件路径解析规则。
  - 同一模块不能同时使用两种文件路径。
- Cargo Book: https://doc.rust-lang.org/cargo/guide/project-layout.html
  - 约定 `src/lib.rs`、`src/main.rs`、`src/bin/`、`tests/`、`examples/`、`benches/`。

## 社区惯例

- Rust CLI Book: https://rust-cli.github.io/book/
  - CLI 二进制应把核心逻辑移到 library 中，`main.rs` 只做装配和边界处理。
  - 应用程序错误边界可用 `anyhow`，并添加上下文。
- Rust Cookbook: https://rust-lang-nursery.github.io/rust-cookbook/errors.html
  - 展示常见错误处理方式和组合模式。
- rust-unofficial/patterns: https://rust-unofficial.github.io/patterns/
  - 提供 Rust idiom 与 pattern 参考，但不是项目结构手册。
- matklad 大型 workspace 经验：
  - 大型 workspace 可用扁平 `crates/*`。
  - 过多 integration test binary 可能带来重复编译和链接成本。

## 知名 crate 实践

- Tokio: `tokio/src/lib.rs` 主要包含文档、crate 配置、模块声明、re-export 和 cfg；子模块中仍存在旧路径目录入口，但新项目不应因此默认使用旧路径。
- Serde: 顶层 crate 倾向作为 facade，核心实现拆到内部 crate 和模块；错误 trait 分布在 `ser` / `de` 模块内。
- Clap: 顶层 crate re-export builder / derive，核心实现拆到 `clap_builder`；错误是独立领域目录。

## 项目偏好

- 新代码禁止创建 `mod.rs`。
- `rust-code-organization` 保持简短，只负责结构判断和路由。
- 测试和错误设计拆成独立 skill，避免每次 Rust 结构任务加载过多上下文。
- 文件拆分阈值采用经验提示：约 `300` 行、`3+` 职责、多个变化原因。
