import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppExitRequestedHandler } from "./api";

const { completeAppExitMock, listenAppExitRequestedMock, closeViewerMock, setAppAuthenticatedMock } = vi.hoisted(() => ({
  completeAppExitMock: vi.fn(), listenAppExitRequestedMock: vi.fn(), closeViewerMock: vi.fn(), setAppAuthenticatedMock: vi.fn(),
}));
vi.mock("./api", () => ({ completeAppExit: completeAppExitMock, listenAppExitRequested: listenAppExitRequestedMock, setAppAuthenticated: setAppAuthenticatedMock }));
vi.mock("../image-viewer/coordinator", () => ({ imageViewerCoordinator: { close: closeViewerMock } }));
import { useAppLifecycle } from "./useAppLifecycle";

let handlers: AppExitRequestedHandler[];
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  handlers = [];
  stop = vi.fn();
  completeAppExitMock.mockResolvedValue(undefined);
  setAppAuthenticatedMock.mockResolvedValue(undefined);
  closeViewerMock.mockResolvedValue(undefined);
  listenAppExitRequestedMock.mockImplementation(async (handler: AppExitRequestedHandler) => {
    handlers.push(handler);
    return stop;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

it("runs both cleanups in parallel and waits for both before acknowledging exit", async () => {
  // 测试目标：完整退出等待认证和查看器清理，但两项清理并行开始。
  // 构造方法：挂载 hook，阻塞两项清理，触发退出事件，先后释放查看器和认证。
  // 输入数据：两个延迟 Promise，以及一次无 payload 的退出事件。
  // 预期行为：两项均开始；仅一项完成时不确认退出；两项完成后确认一次。
  const viewer = deferred<void>();
  const session = deferred<void>();
  closeViewerMock.mockReturnValueOnce(viewer.promise);
  const cleanSession = vi.fn(() => session.promise);
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(handlers).toHaveLength(1));
  const exiting = handlers[0]();
  await waitFor(() => expect(cleanSession).toHaveBeenCalledOnce());
  expect(closeViewerMock).toHaveBeenCalledOnce();
  await act(async () => viewer.resolve());
  expect(completeAppExitMock).not.toHaveBeenCalled();
  await act(async () => { session.resolve(); await exiting; });
  expect(completeAppExitMock).toHaveBeenCalledOnce();
});

it("uses the latest committed session cleanup without resubscribing", async () => {
  // 测试目标：登录或 token 更新后使用最新清理回调，避免重订阅造成事件空隙。
  // 构造方法：挂载旧回调，再用新回调 rerender，然后触发原先注册的事件处理器。
  // 输入数据：旧 cleanup 与新 cleanup 两个独立测试替身。
  // 预期行为：只订阅一次，只调用新 cleanup，卸载正常取消订阅。
  const oldCleanup = vi.fn();
  const newCleanup = vi.fn();
  const view = renderHook(({ onCleanup }) => useAppLifecycle(onCleanup, true), { initialProps: { onCleanup: oldCleanup } });
  await waitFor(() => expect(handlers).toHaveLength(1));
  view.rerender({ onCleanup: newCleanup });
  await act(async () => { await handlers[0](); });
  expect(listenAppExitRequestedMock).toHaveBeenCalledOnce();
  expect(oldCleanup).not.toHaveBeenCalled();
  expect(newCleanup).toHaveBeenCalledOnce();
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it("deduplicates pending and completed exit requests", async () => {
  // 测试目标：重复事件不会重复清理凭据、查看器或确认退出。
  // 构造方法：阻塞认证清理，连续触发两次退出，释放后再触发第三次。
  // 输入数据：同一挂载生命周期内三个退出事件。
  // 预期行为：认证、查看器和确认退出均仅调用一次。
  const session = deferred<void>();
  const cleanSession = vi.fn(() => session.promise);
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(handlers).toHaveLength(1));
  const first = handlers[0]();
  await handlers[0]();
  await act(async () => { session.resolve(); await first; await handlers[0](); });
  expect(cleanSession).toHaveBeenCalledOnce();
  expect(closeViewerMock).toHaveBeenCalledOnce();
  expect(completeAppExitMock).toHaveBeenCalledOnce();
});

it.each(["viewer", "session"] as const)("continues both cleanups and exit after a synchronous %s failure", async (failedCleanup) => {
  // 测试目标：任一清理同步抛出时，另一项仍运行且最终确认退出。
  // 构造方法：分别将查看器或认证清理替换为同步抛错函数，挂载后触发退出。
  // 输入数据：failedCleanup 为 viewer 或 session；Error("cleanup_failed")。
  // 预期行为：两项清理均调用一次；失败被 allSettled 消化；确认退出一次。
  const cleanSession = vi.fn();
  const fail = () => { throw new Error("cleanup_failed"); };
  if (failedCleanup === "viewer") closeViewerMock.mockImplementationOnce(fail);
  else cleanSession.mockImplementationOnce(fail);
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(handlers).toHaveLength(1));
  await act(async () => { await handlers[0](); });
  expect(cleanSession).toHaveBeenCalledOnce();
  expect(closeViewerMock).toHaveBeenCalledOnce();
  expect(completeAppExitMock).toHaveBeenCalledOnce();
});

it("acknowledges exit after asynchronous cleanup rejections", async () => {
  // 测试目标：网络或查看器异步失败不能阻止完整退出。
  // 构造方法：将两项清理均设置为拒绝，挂载后触发退出事件。
  // 输入数据：network_error 与 viewer_not_found 两个 Promise 拒绝。
  // 预期行为：事件处理正常 resolve，最终调用确认退出一次。
  closeViewerMock.mockRejectedValueOnce(new Error("viewer_not_found"));
  const cleanSession = vi.fn().mockRejectedValueOnce(new Error("network_error"));
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(handlers).toHaveLength(1));
  await act(async () => { await expect(handlers[0]()).resolves.toBeUndefined(); });
  expect(completeAppExitMock).toHaveBeenCalledOnce();
});

it("cleans late StrictMode subscriptions and ignores their disposed handlers", async () => {
  // 测试目标：StrictMode 的 setup/cleanup/setup 期间异步订阅不会泄漏或执行旧监听。
  // 构造方法：阻塞第一次订阅；StrictMode 重挂 effect 后释放旧订阅，触发新旧处理器，最后卸载。
  // 输入数据：两个订阅处理器和延迟返回的旧 unsubscribe。
  // 预期行为：旧订阅立刻取消且旧事件无效；仅新事件触发清理；卸载取消新订阅。
  const late = deferred<() => void>();
  const lateStop = vi.fn();
  listenAppExitRequestedMock.mockImplementationOnce((handler: AppExitRequestedHandler) => {
    handlers.push(handler);
    return late.promise;
  });
  const cleanSession = vi.fn();
  const view = renderHook(() => useAppLifecycle(cleanSession, true), { reactStrictMode: true });
  await waitFor(() => expect(handlers).toHaveLength(2));
  await act(async () => { late.resolve(lateStop); await handlers[0](); });
  expect(lateStop).toHaveBeenCalledOnce();
  expect(cleanSession).not.toHaveBeenCalled();
  await act(async () => { await handlers[1](); });
  expect(cleanSession).toHaveBeenCalledOnce();
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it("handles synchronous subscription failure without unhandled rejection", async () => {
  // 测试目标：浏览器环境或原生订阅错误不会变成未处理异常。
  // 构造方法：让订阅函数同步抛错，监测 console.error 后挂载 hook。
  // 输入数据：Error("missing_tauri")。
  // 预期行为：记录订阅失败，不清理会话或确认退出。
  const error = new Error("missing_tauri");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  listenAppExitRequestedMock.mockImplementationOnce(() => { throw error; });
  const cleanSession = vi.fn();
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(log).toHaveBeenCalledWith("Failed to listen for app exit", error));
  expect(cleanSession).not.toHaveBeenCalled();
  expect(completeAppExitMock).not.toHaveBeenCalled();
});

it("records acknowledgement failure without repeating cleanup", async () => {
  // 测试目标：确认 command 失败时不产生未处理拒绝，也不重复清理，交由原生 watchdog 退出。
  // 构造方法：确认退出拒绝，触发两次退出事件并监测错误日志。
  // 输入数据：Error("native_exit_failed") 与两个退出事件。
  // 预期行为：两次事件均正常 resolve，清理与 command 仅一次，日志记录确认失败。
  const error = new Error("native_exit_failed");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  completeAppExitMock.mockRejectedValueOnce(error);
  const cleanSession = vi.fn();
  renderHook(() => useAppLifecycle(cleanSession, true));
  await waitFor(() => expect(handlers).toHaveLength(1));
  await act(async () => { await handlers[0](); await handlers[0](); });
  expect(cleanSession).toHaveBeenCalledOnce();
  expect(completeAppExitMock).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith("Failed to complete app exit", error);
});
