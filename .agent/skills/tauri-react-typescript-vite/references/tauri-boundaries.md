# Tauri 边界、安全与 IPC

## Command 边界

React 到 Rust 的边界必须稳定、窄且可测试。

- command 名称集中封装，不散落在组件 JSX 中。
- command 参数和返回值使用显式 DTO；前端定义 TypeScript 类型，Rust 定义可序列化结构。
- command 负责输入校验、权限敏感操作和错误映射；复杂领域逻辑下沉到 service/domain 模块。
- 不把 Rust 内部错误、路径细节、平台差异或 crate 私有模型直接作为前端契约。

推荐形态：

```text
src/features/settings/api.ts
src/features/settings/types.ts
src-tauri/src/commands/settings.rs
src-tauri/src/state/settings.rs
src-tauri/src/errors.rs
```

## 前端 invoke 封装

React 组件默认调用 feature API，而不是直接调用 `invoke`。

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export function loadSettings(): Promise<Settings> {
  return invoke<Settings>("load_settings");
}
```

允许例外：

- 一次性探索代码，但探索结果不得直接提交为长期结构。
- 非业务 bootstrap 中的极少量基础调用，且已有封装收益很低。

## Rust 组织

`src-tauri/src/lib.rs` 只做装配：

- plugin 注册。
- state 管理注册。
- command handler 注册。
- window/menu/tray 等启动装配。

具体逻辑拆到：

- `commands/`：Tauri command 入口、DTO 映射。
- `state/`：托管状态和状态访问 API。
- `platform/`：OS 差异、路径、系统集成。
- `errors.rs`：对前端稳定的错误表示。
- 领域模块：解析、存储、同步等可测试核心逻辑。

涉及 Rust 模块、测试或错误 API 时，按入口 skill 要求加载 Rust 相关 skill。

## 错误映射

- 前端看到的错误必须稳定、可展示或可分支处理。
- Rust 内部错误可以保留细节，但 command 返回前要映射为稳定错误码或消息。
- 不要为了省事把 `anyhow::Error`、debug 字符串或 panic 泄漏给前端。

小型内部 command 可以临时使用 `Result<T, String>`，但只要错误需要被前端分支处理、测试断言或作为 public API 长期维护，就应设计显式错误类型。

## 事件、长任务与状态

- 短请求/响应：使用 command。
- 长任务进度：优先使用事件或 channel。
- 共享后端状态：使用 Tauri state 托管，前端只通过 command/event 访问。
- 前端不要用频繁轮询弥补后端缺少事件模型，除非已证明事件不可用。

## Capabilities 与 permissions

默认最小授权：

- 先确认功能需要哪个插件和哪条权限。
- 只给目标 window label 授权。
- 只开放具体 action 和 scope，不使用通配权限。
- 每次新增 `fs`、`shell`、`http`、`process`、`clipboard` 等敏感权限，都要说明用户场景和限制范围。

禁止默认做法：

```json
{
  "permissions": [
    "fs:allow-*",
    "shell:allow-*",
    "http:allow-*"
  ]
}
```

导入用户选择的本地文件时，优先让前端使用 dialog 选择路径，再由 Rust command 做校验、读取和解析。不要仅为这个场景开放广泛前端文件系统权限。

## CSP 与远程内容

- 默认不加载远程任意页面或脚本。
- 需要远程资源时，先确认业务必要性，再收紧 CSP。
- 不把 CSP 放宽作为修复前端资源加载问题的第一选择。
