# 结构与文件拆分

## 证据优先

开始前先检查：

- `package.json`：脚本、依赖、测试工具、包管理器痕迹。
- `src/`：已有 React 目录、组件命名、状态管理方式。
- `src-tauri/`：Tauri 版本、`tauri.conf.*`、`capabilities/`、Rust 模块组织。
- `vite.config.*`、`tsconfig.*`、`eslint.config.*`、`vitest.config.*`：工具链约定。

如果项目还没有前端代码，使用本文件默认结构作为初始建议，但明确它来自本 skill，而不是从现有代码推导。

## 推荐初始目录

```text
src/
  main.tsx
  App.tsx
  routes/
  features/
    <feature>/
      components/
      hooks/
      api.ts
      types.ts
      tests/
  shared/
    ui/
    lib/
  test/
    setup.ts

src-tauri/
  src/
    lib.rs
    commands/
    state/
    errors.rs
    platform/
  capabilities/
  tauri.conf.json
```

目录可以随项目演化调整。不要为了空目录完整性提前创建所有目录；只创建当前 feature 真正需要的目录。

## React 文件边界

| 文件类型 | 应放内容 | 不应放内容 |
| --- | --- | --- |
| `main.tsx` | React root、全局 CSS、严格模式、根 provider 挂载 | 业务逻辑、IPC、路由配置膨胀 |
| `App.tsx` | 应用壳、顶层布局、路由出口、provider 组合 | 页面内部状态、表单逻辑、command 调用 |
| `routes/<Name>Page.tsx` | 页面组合、路由级数据流、页面状态协调 | 可复用业务 API、跨页面共享组件细节 |
| `features/<name>/api.ts` | feature 级 Tauri/HTTP API 封装、DTO 转换 | 组件 JSX、全局 invoke 杂物箱 |
| `features/<name>/hooks/` | feature 专属状态编排和副作用封装 | 跨 feature 通用工具 |
| `features/<name>/components/` | feature 专属组件 | 全局设计系统组件 |
| `shared/ui/` | 跨 feature 复用的纯 UI 基础件 | 业务规则和 Tauri API |
| `shared/lib/` | 跨 feature 工具、基础 Tauri client | 页面状态和业务流程 |

## 拆分阈值

出现以下任一情况时拆分：

- 组件包含 `3+` 明显职责，例如渲染、表单状态、IPC、数据转换、错误映射同时存在。
- 文件约 `200` 行且仍在增长，或 review 时需要频繁滚动才能理解一个行为。
- `useEffect` 里同时做加载、转换、订阅、清理和错误处理。
- 多个页面复制同一段 invoke、数据转换或错误提示。
- 测试不得不访问组件内部实现，而不是用户可见行为。

保留以下情况：

- 组件虽有 `120` 行左右，但只有一个清晰职责，且没有跨 feature 复用需求。
- 只服务一个页面的微型子组件，可以先放在页面同文件或同目录。
- 抽象名称比重复代码更难理解时，先保留重复，等待第三次真实重复再抽。

## TypeScript 与 Vite

- 默认使用 `strict` 思维写类型；不得用 `any` 绕过 DTO 或 command 返回值。
- 路径别名只在能减少跨层相对路径噪音时引入；不要让 alias 掩盖边界混乱。
- 只把可公开给前端的环境变量放进 `VITE_` 前缀；不要把密钥放入 Vite env。
- Vite 配置应保持薄，只放插件、别名、测试或构建目标；不要塞业务常量。

## 状态管理

默认顺序：

1. 组件本地 state。
2. 提升到共同父组件。
3. feature hook 或 reducer。
4. context、query cache 或外部状态库。

只有当状态跨多个远距离组件共享、缓存/同步语义明确或本地 state 已经造成真实复杂度时，才引入更重的状态方案。
