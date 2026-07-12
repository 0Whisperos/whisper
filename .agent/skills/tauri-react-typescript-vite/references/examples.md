# 正反例

## IPC 封装

反例：组件里散落 command 字符串。

```tsx
import { invoke } from "@tauri-apps/api/core";

export function SettingsPage() {
  async function onSave() {
    await invoke("save_settings", { settings: collectForm() });
  }

  return <button onClick={onSave}>Save</button>;
}
```
正例：组件调用 feature API。

```ts
// src/features/settings/api.ts
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}
```

```tsx
// src/features/settings/components/SettingsForm.tsx
import { saveSettings } from "../api";

export function SettingsForm() {
  async function onSave(settings: Settings) {
    await saveSettings(settings);
  }

  return <button onClick={() => onSave(readForm())}>Save</button>;
}
```

## App.tsx 边界

反例：`App.tsx` 同时做布局、状态、IPC 和表单。

```tsx
export function App() {
  const [name, setName] = useState("");

  useEffect(() => {
    invoke("load_settings").then((settings) => setName(settings.name));
  }, []);

  return <input value={name} onChange={(event) => setName(event.target.value)} />;
}
```

正例：`App.tsx` 只装配。

```tsx
import { SettingsPage } from "./routes/SettingsPage";

export function App() {
  return <SettingsPage />;
}
```

## Tauri command 拆分

反例：`lib.rs` 堆业务逻辑。

```rust
#[tauri::command]
fn load_settings() -> Result<Settings, String> {
    // read file, parse, validate, map errors, return defaults...
}
```

正例：`lib.rs` 注册，command 文件做边界，领域逻辑再下沉。

```rust
// src-tauri/src/lib.rs
mod commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::settings::load_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```rust
// src-tauri/src/commands/settings.rs
#[tauri::command]
pub async fn load_settings(state: tauri::State<'_, SettingsStore>) -> Result<SettingsDto, AppErrorDto> {
    state.load().await.map(SettingsDto::from).map_err(AppErrorDto::from)
}
```

## 权限

反例：为导入一个配置文件开放通配权限。

```json
{
  "permissions": ["fs:allow-*", "shell:allow-*"]
}
```

正例：只开放选择文件所需能力，读取和解析留在 Rust command 中做校验。

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:allow-open"]
}
```

## 测试注释

```tsx
it("loads settings when the page opens", async () => {
  // 测试目标：验证设置页打开时会加载已保存设置并显示到表单。
  // 构造方法：mock feature API 的 loadSettings，渲染 SettingsPage。
  // 输入数据：loadSettings 返回 { name: "alice", notifications: true }。
  // 预期行为：名称输入框显示 "alice"，通知开关处于开启状态。
});
```
