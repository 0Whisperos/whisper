# Rust Workspace 组织

只有在单 crate 已经无法清晰表达边界时，才升级为多 crate workspace。不要为了“看起来架构完整”提前拆分。

## 小型二进制

适用于 CLI、工具脚本、单一服务入口。

```text
Cargo.toml
src/main.rs
src/config.rs
src/error.rs
src/app.rs
```

规则：

- `main.rs` 做参数解析、日志、依赖装配、调用 `app::run`。
- 可测试核心逻辑放到 `app.rs` 或 library crate。
- 如果核心逻辑开始被测试、复用或变复杂，增加 `src/lib.rs`。

## 中型 library crate

适用于有明确 public API 的库。

```text
Cargo.toml
src/lib.rs
src/error.rs
src/parser.rs
src/parser/token.rs
src/transport.rs
tests/public_api.rs
```

规则：

- `lib.rs` 作为 facade，集中 public re-export。
- 领域模块按职责拆分，不按“工具层 / service 层”机械分层。
- public API 应稳定、最小、可文档化。

## 多 crate workspace

适用于边界稳定、编译依赖明显不同、需要单独发布或复用的项目。

```text
Cargo.toml
crates/core/
crates/cli/
crates/protocol/
crates/test-support/
```

规则：

- workspace 根 `Cargo.toml` 管理成员和共享依赖。
- `core` 不依赖 `cli`。
- `cli` 负责参数解析和进程边界。
- `test-support` 只放测试工具，不进入生产依赖。
- 不要为了绕过模块可见性而拆 crate；先整理模块边界。

## 何时拆 crate

可以拆：

- 子系统可独立发布、复用或测试。
- 编译依赖明显不同，拆分能降低构建成本。
- public API 边界稳定，且不是临时实现细节。
- 团队需要独立 ownership。

不应拆：

- 只是单文件太长。
- 只是想隐藏复杂度。
- 只是为了模拟其他大型项目结构。
- 边界仍频繁变化。
