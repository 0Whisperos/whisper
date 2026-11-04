import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { setAppAuthenticatedMock, listenMock, completeExitMock } = vi.hoisted(() => ({
  setAppAuthenticatedMock: vi.fn(), listenMock: vi.fn(), completeExitMock: vi.fn(),
}));
vi.mock("./api", () => ({
  setAppAuthenticated: setAppAuthenticatedMock,
  listenAppExitRequested: listenMock,
  completeAppExit: completeExitMock,
}));
vi.mock("../image-viewer/coordinator", () => ({ imageViewerCoordinator: { close: vi.fn() } }));
import { useAppLifecycle } from "./useAppLifecycle";

beforeEach(() => {
  vi.resetAllMocks();
  setAppAuthenticatedMock.mockResolvedValue(undefined);
  listenMock.mockResolvedValue(vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

it("synchronizes startup, login, and logout while preserving the exit listener", async () => {
  // 测试目标：验证只有真实会话存在才启用驻留，登出或会话失效会关闭驻留。
  // 构造方法：挂载未登录 hook，依次切换已登录和未登录，并观察原生 API 与退出订阅。
  // 输入数据：authenticated 为 false → true → false。
  // 预期行为：原生同步顺序为 false、true、false；只订阅一次，不执行退出清理。
  const onCleanup = vi.fn();
  const view = renderHook(({ authenticated }) => useAppLifecycle(onCleanup, authenticated), { initialProps: { authenticated: false } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledExactlyOnceWith(false));
  view.rerender({ authenticated: true });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenLastCalledWith(true));
  view.rerender({ authenticated: false });
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true], [false]]));
  expect(listenMock).toHaveBeenCalledOnce();
  expect(onCleanup).not.toHaveBeenCalled();
});

it("does not resynchronize an unchanged login status after token refresh", async () => {
  // 测试目标：验证会话刷新和清理回调变更不会产生重复登录状态 IPC。
  // 构造方法：以已登录状态挂载，再替换清理回调但保持 authenticated=true。
  // 输入数据：两个不同 cleanup 回调，相同的 true 布尔值。
  // 预期行为：仅同步一次 true，退出监听仍为一次。
  const view = renderHook(({ onCleanup }: { onCleanup: () => void }) => useAppLifecycle(onCleanup, true), { initialProps: { onCleanup: vi.fn() } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledExactlyOnceWith(true));
  view.rerender({ onCleanup: vi.fn() });
  await act(async () => {});
  expect(setAppAuthenticatedMock).toHaveBeenCalledOnce();
  expect(listenMock).toHaveBeenCalledOnce();
});

it("serializes a pending login before logout so stale true cannot overwrite false", async () => {
  // 测试目标：验证快速登出时，较慢登录同步不能覆盖较新的未登录状态。
  // 构造方法：完成初始同步，阻塞登录 IPC，切换登出，然后释放登录请求。
  // 输入数据：false → true（延迟 Promise）→ false。
  // 预期行为：登录未结束时不发送登出；结束后同步 false，最终顺序为 false、true、false。
  const login = deferred();
  const view = renderHook(({ authenticated }) => useAppLifecycle(vi.fn(), authenticated), { initialProps: { authenticated: false } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledOnce());
  setAppAuthenticatedMock.mockReturnValueOnce(login.promise);
  view.rerender({ authenticated: true });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledTimes(2));
  view.rerender({ authenticated: false });
  await act(async () => {});
  expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true]]);
  await act(async () => login.resolve());
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true], [false]]));
});

it("retries one transient synchronization failure", async () => {
  // 测试目标：验证瞬时原生失败得到一次重试，避免短暂错误使登录后托盘不可用。
  // 构造方法：首次状态同步拒绝，第二次成功，并捕获错误日志。
  // 输入数据：authenticated=true，首次错误 tray_unavailable。
  // 预期行为：记录错误并同步 true 两次，随后稳定，不重复订阅退出。
  const error = new Error("tray_unavailable");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  setAppAuthenticatedMock.mockRejectedValueOnce(error);
  renderHook(() => useAppLifecycle(vi.fn(), true));
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[true], [true]]));
  expect(log).toHaveBeenCalledWith("Failed to synchronize app authentication", error);
  expect(listenMock).toHaveBeenCalledOnce();
});

it("bounds persistent failures and allows a later authentication change", async () => {
  // 测试目标：验证持续原生错误不会无限重试，也不阻塞后续登出同步或完整退出。
  // 构造方法：登录同步连续失败两次，切换未登录，再触发已注册退出事件。
  // 输入数据：true → false，两次 tray_unavailable 错误和一次完整退出事件。
  // 预期行为：true 恰好尝试两次，false 后续成功，清理和完整退出确认正常执行。
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setAppAuthenticatedMock.mockRejectedValueOnce("tray_unavailable").mockRejectedValueOnce("tray_unavailable");
  const onCleanup = vi.fn();
  const view = renderHook(({ authenticated }) => useAppLifecycle(onCleanup, authenticated), { initialProps: { authenticated: true } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledTimes(2));
  view.rerender({ authenticated: false });
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[true], [true], [false]]));
  await act(async () => { await listenMock.mock.calls[0][0](); });
  expect(onCleanup).toHaveBeenCalledOnce();
  expect(completeExitMock).toHaveBeenCalledOnce();
});

it("does not retry an obsolete login after logout", async () => {
  // 测试目标：验证登录请求失败时若已登出，不重试过期 true 或毒化串行队列。
  // 构造方法：阻塞初始已登录同步，切换未登录，再拒绝旧请求。
  // 输入数据：true（延迟拒绝 tray_unavailable）→ false。
  // 预期行为：只尝试一次 true，随后同步 false，并记录旧请求失败。
  const login = deferred();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  setAppAuthenticatedMock.mockReturnValueOnce(login.promise);
  const view = renderHook(({ authenticated }) => useAppLifecycle(vi.fn(), authenticated), { initialProps: { authenticated: true } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledOnce());
  view.rerender({ authenticated: false });
  await act(async () => login.reject("tray_unavailable"));
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[true], [false]]));
  expect(log).toHaveBeenCalledWith("Failed to synchronize app authentication", "tray_unavailable");
});

it("resynchronizes login after a partially applied logout failure", async () => {
  // 测试目标：验证原生登出部分执行后失败，不会把更早的登录确认当作当前状态。
  // 构造方法：先成功同步登录，让登出连续失败两次，再重新登录。
  // 输入数据：true → false（两次 window_restore_failed）→ true。
  // 预期行为：最终 true 仍发送到原生，顺序为 true、false、false、true。
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const view = renderHook(({ authenticated }) => useAppLifecycle(vi.fn(), authenticated), { initialProps: { authenticated: true } });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledExactlyOnceWith(true));
  setAppAuthenticatedMock.mockRejectedValueOnce("window_restore_failed").mockRejectedValueOnce("window_restore_failed");
  view.rerender({ authenticated: false });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledTimes(3));
  view.rerender({ authenticated: true });
  await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[true], [false], [false], [true]]));
});

it("deduplicates StrictMode authentication effects and discards unmounted work", async () => {
  // 测试目标：验证严格模式不重复同步登录状态，卸载后不继续执行排队状态切换。
  // 构造方法：StrictMode 挂载并阻塞登录请求，排队登出，卸载后释放旧请求。
  // 输入数据：true → false，延迟登录 Promise 与一次卸载。
  // 预期行为：仅发送一次 true，卸载后的 false 不发送，也不清理或确认退出。
  const login = deferred();
  setAppAuthenticatedMock.mockReturnValueOnce(login.promise);
  const onCleanup = vi.fn();
  const view = renderHook(({ authenticated }) => useAppLifecycle(onCleanup, authenticated), {
    initialProps: { authenticated: true }, reactStrictMode: true,
  });
  await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledExactlyOnceWith(true));
  view.rerender({ authenticated: false });
  view.unmount();
  await act(async () => login.resolve());
  expect(setAppAuthenticatedMock).toHaveBeenCalledOnce();
  expect(onCleanup).not.toHaveBeenCalled();
  expect(completeExitMock).not.toHaveBeenCalled();
});
