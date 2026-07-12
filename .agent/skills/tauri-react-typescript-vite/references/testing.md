# 测试组织

## 核心原则

测试位置取决于测试目标：

- 组件用户行为：Vitest + React Testing Library，放在组件附近或 feature `tests/`。
- feature API 封装：测试 TypeScript 调用参数、返回转换和错误映射。
- Tauri API：使用官方 mock 或本项目测试 helper，不直接依赖真实桌面环境。
- Rust command 内部逻辑：按 Rust skill 放到同文件、模块测试或 `tests/`。
- 关键桌面流程：按风险选择 E2E，不用 E2E 覆盖所有细节。

## 必需测试注释

每个测试用例必须包含描述性注释，说明：

1. 测试目标：验证什么。
2. 构造方法：如何搭建测试场景，步骤化说明。
3. 输入数据：具体测试输入是什么。
4. 预期行为：期望的输出或结果是什么。

TypeScript 示例：

```ts
it("saves edited settings", async () => {
  // 测试目标：验证用户修改设置并点击保存后会调用保存 API。
  // 构造方法：渲染 SettingsForm，注入可观察的 saveSettings 测试替身。
  // 输入数据：用户名 "alice" 和开启通知 true。
  // 预期行为：saveSettings 收到完整 settings 对象，并显示保存成功状态。
});
```

## 前端测试放置

| 测试类型 | 推荐位置 | 不应做什么 |
| --- | --- | --- |
| 单个组件行为 | 组件同目录 `*.test.tsx` | 断言内部 state 变量 |
| feature 流程 | `src/features/<feature>/tests/` | 跨多个无关 feature 建巨大测试文件 |
| shared UI | `src/shared/ui/<component>.test.tsx` | 引入业务 API |
| API 封装 | `src/features/<feature>/api.test.ts` | 在组件测试里重复断言 command 字符串 |
| 测试工具 | `src/test/` | 为测试把 production 私有 API 改成公开 |

## React Testing Library

- 优先按用户可见文本、角色、label 查询。
- 不使用实现细节选择器测试内部 DOM 结构。
- 用户交互使用 `user-event` 风格，而不是直接调用事件 handler。
- 异步 UI 使用 `findBy*` 或 `waitFor`，不写任意 sleep。

## Tauri mock

- 对 `invoke`、dialog、event 等 Tauri API 建集中 mock。
- 测试 feature API 时验证 command 名称、参数结构和返回转换。
- 组件测试优先 mock feature API，而不是 mock 原始 Tauri API。

## Rust 衔接

涉及 `src-tauri/` 下 Rust 测试时，加载 `.agent/skills/rust-testing/SKILL.md`。涉及 command 错误类型、DTO 错误映射或 `Result<T, E>` 设计时，加载 `.agent/skills/rust-error-design/SKILL.md`。

## E2E 默认

E2E 适合：

- 首次启动、窗口/菜单/tray 等桌面行为。
- 前端与 command 集成的关键主路径。
- 权限或文件选择这类单元测试难以覆盖的用户流程。

E2E 不适合：

- 所有表单边界条件。
- 纯函数、数据转换和小组件交互。
- 替代 Rust/React 单元测试。
