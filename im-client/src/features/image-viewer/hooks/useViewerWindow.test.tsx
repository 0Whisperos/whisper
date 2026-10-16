import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../windowApi", () => ({ closeViewerWindow: vi.fn(), isViewerWindowMaximized: vi.fn(),
  listenViewerWindowResized: vi.fn(), minimizeViewerWindow: vi.fn(), toggleViewerWindowMaximized: vi.fn() }));
import { closeViewerWindow, isViewerWindowMaximized, listenViewerWindowResized, minimizeViewerWindow, toggleViewerWindowMaximized } from "../windowApi";
import { useViewerWindow } from "./useViewerWindow";

let resize: () => void;
let stop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); stop = vi.fn();
  vi.mocked(listenViewerWindowResized).mockImplementation(async (handler) => { resize = handler; return stop; });
  vi.mocked(isViewerWindowMaximized).mockResolvedValue(false);
  vi.mocked(minimizeViewerWindow).mockResolvedValue();
  vi.mocked(toggleViewerWindowMaximized).mockResolvedValue();
  vi.mocked(closeViewerWindow).mockResolvedValue();
});
afterEach(cleanup);

it("subscribes before querying and follows resize events before unsubscribing", async () => {
  // 测试目标：先订阅再读取最大化状态，并跟随系统 resize 更新按钮状态。
  // 构造方法：挂载 hook，完成初始查询，改变原生状态并触发 resize，最后卸载。
  // 输入数据：初始 false，resize 后 true。
  // 预期行为：订阅先于查询，状态变为 true，卸载时取消订阅一次。
  const view = renderHook(() => useViewerWindow());
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  expect(vi.mocked(listenViewerWindowResized).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(isViewerWindowMaximized).mock.invocationCallOrder[0]);
  vi.mocked(isViewerWindowMaximized).mockResolvedValueOnce(true);
  act(() => resize());
  await waitFor(() => expect(view.result.current.isMaximized).toBe(true));
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it("keeps the latest resize query when native responses finish out of order", async () => {
  // 测试目标：过期的异步最大化查询不会覆盖较新窗口状态。
  // 构造方法：阻塞一次 resize 查询，再触发另一次并先完成，最后释放旧查询。
  // 输入数据：旧结果 false、新结果 true。
  // 预期行为：最终状态保持 true。
  const view = renderHook(() => useViewerWindow());
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  let release!: (value: boolean) => void;
  vi.mocked(isViewerWindowMaximized).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValueOnce(true);
  act(() => { resize(); resize(); });
  await waitFor(() => expect(view.result.current.isMaximized).toBe(true));
  await act(async () => release(false));
  expect(view.result.current.isMaximized).toBe(true);
});

it("cleans a late subscription and ignores pending queries after unmount", async () => {
  // 测试目标：卸载时尚未完成的订阅/查询不会泄漏监听或报告旧失败。
  // 构造方法：第一次阻塞订阅后卸载并释放；第二次阻塞初始查询后卸载并拒绝。
  // 输入数据：延迟订阅返回 stop，以及晚到的查询失败。
  // 预期行为：延迟 stop 被调用，不再查询；晚到失败不调用 onError。
  let subscribe!: (value: () => void) => void;
  vi.mocked(listenViewerWindowResized).mockImplementationOnce(() => new Promise((resolve) => { subscribe = resolve; }));
  const first = renderHook(() => useViewerWindow()); first.unmount();
  await act(async () => subscribe(stop));
  expect(stop).toHaveBeenCalledOnce(); expect(isViewerWindowMaximized).not.toHaveBeenCalled();
  let reject!: (reason: unknown) => void;
  vi.mocked(isViewerWindowMaximized).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const onError = vi.fn(); const second = renderHook(() => useViewerWindow(onError));
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  second.unmount(); await act(async () => reject("late_error"));
  expect(onError).not.toHaveBeenCalled();
});

it("runs the three controls, refreshes after maximize and catches native rejection", async () => {
  // 测试目标：按钮动作执行对应原生命令，最大化完成后同步状态，失败不产生未处理拒绝。
  // 构造方法：挂载 hook 后依次最小化、切换最大化和关闭失败。
  // 输入数据：最大化结果 true，close 拒绝 native_failed。
  // 预期行为：最小化/切换各一次，state 为 true，关闭 action resolve 且调用 onError 一次。
  const onError = vi.fn(); const view = renderHook(() => useViewerWindow(onError));
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  vi.mocked(isViewerWindowMaximized).mockResolvedValueOnce(true);
  await act(async () => { await view.result.current.minimize(); await view.result.current.toggleMaximize(); });
  expect(minimizeViewerWindow).toHaveBeenCalledOnce(); expect(toggleViewerWindowMaximized).toHaveBeenCalledOnce();
  expect(view.result.current.isMaximized).toBe(true);
  vi.mocked(closeViewerWindow).mockRejectedValueOnce("native_failed");
  await act(async () => { await expect(view.result.current.close()).resolves.toBeUndefined(); });
  expect(onError).toHaveBeenCalledOnce();
});

it("handles unavailable Tauri subscriptions and stale action failures without rejection", async () => {
  // 测试目标：浏览器没有 Tauri 时安全捕获订阅错误，卸载后的动作失败不会调用新错误处理器。
  // 构造方法：订阅直接抛出，再恢复订阅并阻塞最小化；卸载后释放失败。
  // 输入数据：同步 missing_tauri 异常和晚到的 minimize_failed 拒绝。
  // 预期行为：首次仅报告一次错误，异步动作 resolve，卸载后没有额外错误回调。
  vi.mocked(listenViewerWindowResized).mockImplementationOnce(() => { throw new Error("missing_tauri"); });
  const onError = vi.fn(); const first = renderHook(() => useViewerWindow(onError));
  await waitFor(() => expect(onError).toHaveBeenCalledOnce()); first.unmount();
  let fail!: (reason: unknown) => void;
  vi.mocked(minimizeViewerWindow).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const second = renderHook(() => useViewerWindow(onError));
  await waitFor(() => expect(isViewerWindowMaximized).toHaveBeenCalledOnce());
  const pending = second.result.current.minimize(); second.unmount();
  await act(async () => { fail("minimize_failed"); await pending; });
  expect(onError).toHaveBeenCalledOnce();
});
