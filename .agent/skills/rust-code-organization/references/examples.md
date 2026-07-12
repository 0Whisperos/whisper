# Rust 代码组织正反例

## `lib.rs`

✅ 应作为 crate 入口和 public facade：

```rust
//! Message parsing library.

mod error;
mod parser;

pub use error::{Error, Result};
pub use parser::{parse_message, Message};
```

❌ 不应堆具体实现：

```rust
pub fn parse_message(input: &str) -> Result<Message> {
    // 200 行解析逻辑、IO、错误映射混在一起
}
```

## `main.rs`

✅ 只做应用边界和调用：

```rust
fn main() -> anyhow::Result<()> {
    let args = cli::Args::parse();
    whisper::run(args)?;
    Ok(())
}
```

❌ 不应承载核心逻辑：

```rust
fn main() {
    // 参数解析、文件读取、协议解析、重试、输出格式化全部写在这里
}
```

## 现代模块路径

✅ 新代码使用：

```text
src/parser.rs
src/parser/token.rs
src/parser/ast.rs
```

```rust
// src/parser.rs
mod ast;
mod token;

pub use ast::Message;
```

❌ 不要为新模块创建旧路径入口：

```text
src/parser/mod.rs
src/parser/token.rs
src/parser/ast.rs
```

## 可见性

✅ 从最小可见性开始：

```rust
struct Token {
    kind: TokenKind,
}

pub(crate) fn tokenize(input: &str) -> Vec<Token> {
    Vec::new()
}

pub fn parse_message(input: &str) -> Result<Message> {
    let tokens = tokenize(input);
    parse_tokens(tokens)
}
```

❌ 不要为了方便测试或跨模块调用就公开内部细节：

```rust
pub struct Token {
    pub kind: TokenKind,
}

pub fn tokenize(input: &str) -> Vec<Token> {
    Vec::new()
}
```

## 类型与 impl

✅ 默认同文件：

```rust
pub struct Parser {
    strict: bool,
}

impl Parser {
    pub fn new(strict: bool) -> Self {
        Self { strict }
    }

    pub fn parse(&self, input: &str) -> Result<Message> {
        parse_message(input)
    }
}
```

❌ 不要机械拆成 `types.rs` 和 `impl.rs`：

```text
src/parser/types.rs
src/parser/impl.rs
```
