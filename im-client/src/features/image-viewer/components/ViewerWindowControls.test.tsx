import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../windowApi", () => ({ closeViewerWindow: vi.fn(), isViewerWindowMaximized: vi.fn(),
  listenViewerWindowResized: vi.fn(), minimizeViewerWindow: vi.fn(), toggleViewerWindowMaximized: vi.fn() }));
import { closeViewerWindow, isViewerWindowMaximized, listenViewerWindowResized, minimizeViewerWindow, toggleViewerWindowMaximized } from "../windowApi";
import { ViewerWindowControls } from "./ViewerWindowControls";

beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(listenViewerWindowResized).mockResolvedValue(vi.fn());
  vi.mocked(isViewerWindowMaximized).mockResolvedValue(false);
  vi.mocked(minimizeViewerWindow).mockResolvedValue();
  vi.mocked(toggleViewerWindowMaximized).mockResolvedValue(); vi.mocked(closeViewerWindow).mockResolvedValue();
});
afterEach(cleanup);

it("offers accessible non-dragging window controls with restore state and SVG icons", async () => {
  // 测试目标：窗口控件可访问、不能触发标题栏拖动，并正确反映最大化状态。
  // 构造方法：渲染控件后点击最小化、最大化和关闭，最大化查询返回 true。
  // 输入数据：三次按钮点击及原生最大化状态 true。
  // 预期行为：各原生动作一次，按钮改名还原；所有按钮禁拖动，图标为18px SVG。
  const user = userEvent.setup(); render(<ViewerWindowControls />);
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  const minimize = screen.getByRole("button", { name: "最小化" });
  const maximize = screen.getByRole("button", { name: "最大化" });
  const close = screen.getByRole("button", { name: "关闭" });
  for (const button of [minimize, maximize, close]) {
    expect(button).toHaveAttribute("data-tauri-drag-region", "false");
    expect(button.querySelector("svg")).toHaveAttribute("width", "18");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  }
  await user.click(minimize);
  vi.mocked(isViewerWindowMaximized).mockResolvedValue(true);
  await user.click(maximize);
  expect(await screen.findByRole("button", { name: "还原" })).toBeEnabled();
  await user.click(close);
  expect(minimizeViewerWindow).toHaveBeenCalledOnce(); expect(toggleViewerWindowMaximized).toHaveBeenCalledOnce();
  expect(closeViewerWindow).toHaveBeenCalledOnce();
});

it("reports operation errors once and remains usable", async () => {
  // 测试目标：原生命令失败会反馈错误且不会破坏其他窗口按钮。
  // 构造方法：最小化命令拒绝，然后继续点击关闭。
  // 输入数据：minimize_failed 拒绝及成功的 close。
  // 预期行为：onError 一次，关闭命令仍可执行。
  const user = userEvent.setup(); const onError = vi.fn();
  vi.mocked(minimizeViewerWindow).mockRejectedValueOnce("minimize_failed");
  render(<ViewerWindowControls onError={onError} />);
  await user.click(screen.getByRole("button", { name: "最小化" }));
  expect(onError).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(closeViewerWindow).toHaveBeenCalledOnce();
});
