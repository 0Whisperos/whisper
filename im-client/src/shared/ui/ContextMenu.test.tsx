import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("fits inside the viewport and allows keyboard selection without selecting disabled items", async () => {
    // 测试目标：验证靠窗口右下角菜单限制在可视区，并可通过键盘跳过禁用项选择操作。
    // 构造方法：替身菜单尺寸，使用窗口右下坐标渲染菜单，按向下和 Enter。
    // 输入数据：菜单尺寸 160x90、位置 innerWidth/innerHeight；第一项复制、第二项禁用、第三项下载。
    // 预期行为：left/top 保留 4px 边距；键盘选择下载，先关闭菜单再执行操作。
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 160, 90));
    const events: string[] = [];
    render(<ContextMenu position={{ x: window.innerWidth, y: window.innerHeight }} onClose={() => events.push("close")}
      items={[{ label: "复制", onSelect: () => events.push("copy") }, { label: "禁用", disabled: true, onSelect: vi.fn() },
        { label: "下载", onSelect: () => events.push("save") }]} />);
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe(`${window.innerWidth - 164}px`); expect(menu.style.top).toBe(`${window.innerHeight - 94}px`);
    expect(screen.getByRole("menuitem", { name: "复制" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}"); expect(events).toEqual(["close", "save"]);
  });

  it.each(["escape", "outside", "blur", "scroll"] as const)("dismisses on %s", (action) => {
    // 测试目标：验证表中每个独立关闭动作都会关闭菜单。
    // 构造方法：渲染菜单，在当前表项场景分别发出 Escape、外部 pointerdown、window blur 或外部 scroll。
    // 输入数据：action 为 escape/outside/blur/scroll；菜单只有复制项。
    // 预期行为：每种动作均且仅调用一次 onClose。
    const close = vi.fn(); render(<ContextMenu position={{ x: 20, y: 30 }} onClose={close} items={[{ label: "复制", onSelect: vi.fn() }]} />);
    if (action === "escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (action === "outside") fireEvent.pointerDown(document.body);
    else if (action === "blur") fireEvent.blur(window);
    else fireEvent.scroll(document.body);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("inherits a supplied theme root and ignores scrolling inside its own menu", () => {
    // 测试目标：验证菜单可挂载于主题容器，菜单自身滚动不会关闭。
    // 构造方法：把菜单 portal 到渲染得到的主题 root，再发出内部 scroll。
    // 输入数据：root 带 data-auth-theme=dark，菜单只有复制项。
    // 预期行为：菜单存在于主题 root 内，内部滚动后 onClose 未调用。
    const close = vi.fn(); const root = document.createElement("div"); root.dataset.authTheme = "dark"; document.body.append(root);
    const { unmount } = render(<ContextMenu position={{ x: 20, y: 30 }} onClose={close} portalRoot={root} items={[{ label: "复制", onSelect: vi.fn() }]} />);
    const menu = screen.getByRole("menu"); expect(root).toContainElement(menu); fireEvent.scroll(menu); expect(close).not.toHaveBeenCalled();
    unmount(); root.remove();
  });
});
