import { beforeEach, expect, it, vi } from "vitest";

const { native } = vi.hoisted(() => ({ native: {
  minimize: vi.fn(), toggleMaximize: vi.fn(), isMaximized: vi.fn(), close: vi.fn(), onResized: vi.fn(),
} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
import { closeViewerWindow, isViewerWindowMaximized, listenViewerWindowResized, minimizeViewerWindow, toggleViewerWindowMaximized } from "./windowApi";

beforeEach(() => { vi.resetAllMocks(); });

it("delegates window operations and the resize subscription to the current native window", async () => {
  // 测试目标：验证窗口 adapter 使用当前窗口的原生操作而不改变图片 session。
  // 构造方法：替换 getCurrentWindow 返回的五个方法，逐个调用封装。
  // 输入数据：最小化、最大化切换、状态查询、关闭和 resize handler。
  // 预期行为：各方法恰好调用一次，查询及取消订阅函数原样返回。
  native.isMaximized.mockResolvedValue(true);
  const stop = vi.fn(); native.onResized.mockResolvedValue(stop);
  const handler = vi.fn();
  await minimizeViewerWindow(); await toggleViewerWindowMaximized();
  expect(await isViewerWindowMaximized()).toBe(true);
  await closeViewerWindow();
  expect(await listenViewerWindowResized(handler)).toBe(stop);
  expect(native.minimize).toHaveBeenCalledOnce();
  expect(native.toggleMaximize).toHaveBeenCalledOnce();
  expect(native.close).toHaveBeenCalledOnce();
  expect(native.onResized).toHaveBeenCalledWith(handler);
});

it("preserves native operation failures for the hook to handle", async () => {
  // 测试目标：原生窗口失败不会由 adapter 冒充成功。
  // 构造方法：让 native close 拒绝，再调用关闭封装。
  // 输入数据：operation_not_allowed 拒绝值。
  // 预期行为：封装 Promise 保留该失败，交由 UI hook 统一捕获。
  native.close.mockRejectedValue("operation_not_allowed");
  await expect(closeViewerWindow()).rejects.toBe("operation_not_allowed");
});
