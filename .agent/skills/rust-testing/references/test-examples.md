# Rust 测试组织示例

## 同文件单元测试

适合测试私有 helper：

```rust
fn normalize(input: &str) -> String {
    input.trim().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_whitespace_and_case() {
        // 测试目标：验证 normalize 会去除首尾空白并转成小写。
        // 构造方法：直接调用同模块私有 helper。
        // 输入数据："  Hello  "。
        // 预期行为：返回 "hello"。
        assert_eq!(normalize("  Hello  "), "hello");
    }
}
```

## 大型内部测试拆文件

当测试很多时：

```text
src/parser.rs
src/parser/tests.rs
```

```rust
// src/parser.rs
#[cfg(test)]
mod tests;
```

```rust
// src/parser/tests.rs
use super::*;

#[test]
fn rejects_unclosed_quote() {
    // 测试目标：验证未闭合引号会返回语法错误。
    // 构造方法：调用 parser 模块内部 parse_tokens。
    // 输入数据：包含未闭合引号的 token 序列。
    // 预期行为：返回 Error::UnclosedQuote。
    let tokens = vec![Token::Quote, Token::Text("abc".into())];

    let err = parse_tokens(tokens).unwrap_err();

    assert!(matches!(err, Error::UnclosedQuote));
}
```

## 集成测试

适合只通过 public API 测行为：

```rust
// tests/public_api.rs
use whisper::{parse_message, Error};

#[test]
fn public_api_rejects_empty_message() {
    // 测试目标：验证 crate public API 对空消息的错误契约。
    // 构造方法：从 crate 外部调用 parse_message。
    // 输入数据：空字符串 ""。
    // 预期行为：返回 Error::EmptyMessage。
    let err = parse_message("").unwrap_err();

    assert!(matches!(err, Error::EmptyMessage));
}
```

## 避免的做法

不要为了集成测试访问内部模块而公开实现细节：

```rust
// 不要这样做
pub mod parser;
pub mod tokenizer;
```

除非它们本来就是 public API，否则测试应通过 public 行为验证。
