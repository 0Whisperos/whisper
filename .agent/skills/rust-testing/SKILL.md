---
name: rust-testing
description: 在本项目中新增、修改、迁移 Rust 测试，选择 #[cfg(test)]、tests/ 或模块测试文件，或评估 Rust 测试组织方式时使用。
---

# Rust 测试组织

## 核心原则

测试位置取决于测试目标：

- 验证私有函数、内部状态或模块不变量：放在被测代码附近。
- 验证 public API、CLI 行为或跨模块协作：放在 `tests/`。
- 内部测试过大影响阅读：拆到同模块的 `tests.rs`。

需要完整示例时，阅读 `references/test-examples.md`。

## 测试位置规则

| 测试类型 | 应放位置 | 不应做什么 | 来源 |
| --- | --- | --- | --- |
| 小型单元测试 | 同文件 `#[cfg(test)] mod tests` | 为少量测试创建额外文件 | 官方共识 |
| public API 集成测试 | `tests/*.rs` 或 `tests/<suite>/main.rs` | 访问私有模块路径 | 官方共识 |
| 大型模块内部测试 | `src/<module>/tests.rs`，由父模块 `#[cfg(test)] mod tests;` 引入 | 让源文件下半部分被大量测试淹没 | 社区惯例 |
| CLI 黑盒测试 | `tests/`，通过二进制或 public API 驱动 | 把 CLI 流程塞进 `main.rs` 私有测试 | 社区惯例 |

## 必需测试注释

每个测试用例必须包含描述性注释，说明：

1. 测试目标：验证什么。
2. 构造方法：如何搭建测试场景，步骤化说明。
3. 输入数据：具体测试输入是什么。
4. 预期行为：期望的输出或结果是什么。

示例：

```rust
#[test]
fn rejects_empty_message() {
    // 测试目标：验证空消息会被解析器拒绝。
    // 构造方法：直接调用 public parse_message API，不依赖内部 tokenizer。
    // 输入数据：空字符串 ""。
    // 预期行为：返回 Error::EmptyMessage。
    let err = parse_message("").unwrap_err();

    assert!(matches!(err, Error::EmptyMessage));
}
```

## `#[cfg(test)] mod tests`

适合：

- 测私有 helper。
- 测模块内部不变量。
- 测边界条件，且测试数量少。

不适合：

- 端到端场景。
- 只应通过 public API 验证的行为。
- 大量 fixture 或长测试流程。

## `tests/`

适合：

- 从 crate 外部视角验证 public API。
- 验证 CLI、配置、文件输入输出。
- 防止测试依赖内部模块结构。

大型 workspace 中，不要无节制创建很多 integration test binary。测试很多时，优先按 suite 收敛到少量入口，再在入口内拆模块。

## 测试 helper

- 只服务一个测试文件的 helper 放在该测试文件内。
- 多个集成测试共享的 helper 放在 `tests/common/` 或测试 support crate。
- 不要为了测试把 production 私有 API 改成 `pub`；优先通过 public API 测行为，或用同文件单元测试访问私有项。
