import { expect, it } from "vitest";
import { installContextMenuPolicy } from "./contextMenuPolicy";

it("suppresses native menus without blocking custom handlers or keyboard clipboard events", () => {
  // 测试目标：验证全局菜单禁用保持自定义菜单与键盘剪贴板能力。
  // 构造方法：安装捕获策略，为元素添加自定义菜单监听并派发事件。
  // 输入数据：可取消 contextmenu 和 Ctrl+C keydown 事件。
  // 预期行为：菜单被取消但元素监听执行，键盘未被取消，卸载后恢复。
  const remove = installContextMenuPolicy();
  const input = document.createElement("input");
  document.body.append(input);
  let handled = false;
  input.addEventListener("contextmenu", () => { handled = true; });
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  input.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  expect(handled).toBe(true);
  const keyboard = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
  input.dispatchEvent(keyboard);
  expect(keyboard.defaultPrevented).toBe(false);
  remove();
  const subsequent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  input.dispatchEvent(subsequent);
  expect(subsequent.defaultPrevented).toBe(false);
  input.remove();
});
