# Rust 错误设计示例

## library crate 错误

✅ 明确 public error enum：

```rust
// src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("empty message")]
    EmptyMessage,

    #[error("invalid message format at byte {offset}")]
    InvalidFormat { offset: usize },

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
```

```rust
// src/lib.rs
mod error;

pub use error::{Error, Result};
```

❌ 不要用无意义错误：

```rust
pub fn parse_message(input: &str) -> Result<Message, ()> {
    // 调用方无法知道失败原因
}
```

❌ 不要默认把 library API 变成动态错误：

```rust
pub fn parse_message(input: &str) -> Result<Message, Box<dyn std::error::Error>> {
    // 调用方难以匹配和处理具体失败
}
```

## application 边界错误

✅ binary 中使用 `anyhow` 聚合并增加上下文：

```rust
use anyhow::{Context, Result};

fn main() -> Result<()> {
    let config = load_config().context("failed to load config")?;
    whisper::run(config).context("failed to run whisper")?;
    Ok(())
}
```

❌ 不要把 `anyhow::Error` 泄漏到 library public API：

```rust
pub fn parse_message(input: &str) -> anyhow::Result<Message> {
    // library 调用方失去稳定错误契约
}
```

## 领域模块错误

当错误只属于一个模块，且不是 crate 级 public error：

```rust
// src/parser.rs
#[derive(Debug, thiserror::Error)]
pub(crate) enum ParseError {
    #[error("unexpected token")]
    UnexpectedToken,
}
```

当错误本身较复杂时再拆：

```text
src/parser.rs
src/parser/error.rs
```

```rust
// src/parser.rs
mod error;

pub(crate) use error::ParseError;
```

## 透明转换

只有底层错误是合理公开语义时才用透明转换：

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
```

如果底层错误只是实现细节，应映射成领域错误：

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("failed to load profile")]
    ProfileLoadFailed,
}
```
