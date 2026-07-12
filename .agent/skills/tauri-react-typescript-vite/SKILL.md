---
name: tauri-react-typescript-vite
description: 在本项目中处理 Tauri 2、React、TypeScript、Vite、桌面 UI、前端测试、IPC 边界、安全权限、组件拆分或前端代码组织时使用。
---

# Tauri React TypeScript Vite

## 核心原则

先从当前 `package.json`、`src/`、`src-tauri/`、`tauri.conf.*`、`vite.config.*`、`tsconfig.*`、测试配置和已有目录收集证据，再判断结构。不要凭记忆套模板。

本 skill 是 Tauri + React + TypeScript + Vite 的结构入口，只保留高频规则。需要细节时按需读取 references，避免一次加载过多上下文。

## 必须同时加载的内容

- 涉及前端或 Tauri 目录组织、组件拆分、hooks、API client、Vite/TS 配置时，阅读 `references/structure.md`。
- 涉及 `invoke`、Tauri command、DTO、事件、state、capabilities、permissions、CSP 或插件权限时，阅读 `references/tauri-boundaries.md`。
- 涉及 Vitest、React Testing Library、Tauri mock、E2E 或测试文件放置时，阅读 `references/testing.md`。
- 需要正反例时，阅读 `references/examples.md`。
- 需要来源依据时，阅读 `references/research-sources.md`。
- 涉及 `src-tauri/` 下 Rust 模块拆分、Rust 测试或 Rust 错误 API 时，还必须加载现有 Rust skill：
  - `.agent/skills/rust-code-organization/SKILL.md`
  - `.agent/skills/rust-testing/SKILL.md`（涉及 Rust 测试时）
  - `.agent/skills/rust-error-design/SKILL.md`（涉及错误类型、public error API 或 `Result<T, E>` 时）

## 默认边界

| 区域 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| `src/App.tsx` | 应用壳、路由挂载、全局 provider 装配 | 页面业务状态、IPC 调用、复杂表单、数据转换 |
| `src/routes/` 或 `src/pages/` | 页面入口、路由级布局和组合 | 可复用业务规则、跨页面 API 细节 |
| `src/features/<feature>/` | 单个业务能力的组件、hooks、types、api、测试 | 与该 feature 无关的共享 UI 或全局工具 |
| `src/shared/` 或 `src/lib/` | 跨 feature 共享的基础 UI、工具、Tauri invoke 封装 | 具体页面流程和业务状态 |
| `src-tauri/src/lib.rs` | Tauri builder、插件注册、command 注册、少量装配 | 具体业务逻辑、文件 IO、长流程实现 |
| `src-tauri/src/commands/` | 稳定 command 入口和 DTO 映射 | 复杂领域逻辑、平台细节、未经映射的内部错误 |

## 拆分判断

优先按职责和变化原因拆分，行数只作为提示。出现任一信号时必须评估拆分：

- `App.tsx` 或单个页面开始同时承载布局、状态、IPC、转换和错误处理。
- 一个 React 组件约 `200` 行且仍在增长，或包含 `3+` 个明显职责。
- 同一文件既定义 UI，又散落多个 `invoke` 调用和 command 字符串。
- 一个 feature 的 types、api、hooks、组件、测试互相挤在同一文件里，导致测试或修改需要理解过多上下文。
- `src-tauri/src/lib.rs` 或单个 command 文件同时承载注册、IO、解析、权限相关逻辑和领域规则。

不要机械拆分小文件；如果一个组件短小、职责单一、只服务当前页面，可以留在页面附近。

## IPC 与权限默认

- React 组件默认不直接调用 `invoke`；先在 feature api 或共享 Tauri client 中集中封装 command 名称、参数和返回类型。
- Tauri command 只暴露稳定 DTO，不把 Rust 内部模型、内部错误或平台路径细节直接泄漏给前端。
- 长任务、进度和异步通知优先评估事件或 channel，不要用前端轮询堆出复杂状态。
- capabilities、permissions、scopes 必须最小化；不要为了方便开启 `fs:*`、`shell:*`、`http:*` 或通配权限。

## 测试默认

- 前端组件行为优先使用 Vitest + React Testing Library，从用户可见行为断言。
- Tauri API 调用必须通过封装层测试；需要模拟 Tauri API 时使用官方 mock 方式或本项目测试工具。
- 关键桌面流程按风险选择 E2E；不要把所有细节都推给 E2E。
- 每个测试用例必须包含项目要求的描述性注释：测试目标、构造方法、输入数据、预期行为。

## 未固定的选择

以下内容不要在没有项目证据或用户确认时写死：包管理器、UI 库、CSS 方案、状态库、E2E 工具、类型生成工具、Node/Rust 最低版本、具体依赖版本和插件白名单。
