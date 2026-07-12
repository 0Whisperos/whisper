# 来源依据

## 官方来源

- Tauri project structure：`https://tauri.app/start/project-structure/`
- Tauri Vite frontend setup：`https://tauri.app/start/frontend/vite/`
- Tauri calling Rust / commands：`https://tauri.app/develop/calling-rust/`
- Tauri permissions：`https://tauri.app/security/permissions/`
- Tauri capabilities：`https://tauri.app/security/capabilities/`
- Tauri tests and mocking：`https://tauri.app/develop/tests/mocking/`
- React Thinking in React：`https://react.dev/learn/thinking-in-react`
- React sharing state：`https://react.dev/learn/sharing-state-between-components`
- React avoiding unnecessary Effects：`https://react.dev/learn/you-might-not-need-an-effect`
- React TypeScript：`https://react.dev/learn/typescript`
- TypeScript handbook：`https://www.typescriptlang.org/docs/handbook/intro.html`
- TypeScript TSConfig reference：`https://www.typescriptlang.org/tsconfig/`
- Vite guide：`https://vite.dev/guide/`
- Vite env and modes：`https://vite.dev/guide/env-and-mode`
- Vite config：`https://vite.dev/config/`
- Vitest guide：`https://vitest.dev/guide/`
- React Testing Library intro：`https://testing-library.com/docs/react-testing-library/intro/`

## 社区参考

- `tauri-apps/create-tauri-app`：作为 Tauri 官方脚手架和最小结构参考。
- `tauri-apps/tauri` examples：作为 Tauri API、capabilities、commands 示例参考。
- `spacedriveapp/spacedrive`：作为大型 Tauri + React + Rust 边界、monorepo、类型生成和本地优先桌面应用参考。
- `alan2207/bulletproof-react`：作为 feature-first React 目录组织参考；只借鉴边界思想，不照搬全部工程复杂度。
- `tw93/Pake`、`lencx/ChatGPT`：可对照 Tauri 应用形态；版本和技术栈选择不作为本项目默认规范。

## 本项目默认选择

- 首批固定技术栈范围：Tauri 2 + React + TypeScript + Vite。
- 不固定：包管理器、UI 库、CSS 方案、状态库、E2E 工具、类型生成工具、具体依赖版本、插件白名单。
- 当官方文档、社区项目和本项目 skill 冲突时，优先级为：当前代码证据、本项目 skill、官方文档、社区参考。
