import { beforeEach, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: listenMock }) }));
import { completeAppExit, listenAppExitRequested, setAppAuthenticated } from "./api";

beforeEach(() => { vi.resetAllMocks(); });

it("listens on the current window and acknowledges exit without arguments", async () => {
  // 测试目标：验证退出事件只监听当前窗口，确认命令不携带可伪造窗口身份参数。
  // 构造方法：替换 currentWindow.listen 和 invoke；订阅并触发事件，再确认退出。
  // 输入数据：无 payload 的 app-exit-requested 事件。
  // 预期行为：回调不接收事件参数；保留 unsubscribe；调用 complete_app_exit 且无参数。
  const stop = vi.fn();
  listenMock.mockResolvedValueOnce(stop);
  const handler = vi.fn();
  await expect(listenAppExitRequested(handler)).resolves.toBe(stop);
  expect(listenMock).toHaveBeenCalledWith("app-exit-requested", expect.any(Function));
  await listenMock.mock.calls[0][1]({ payload: undefined });
  expect(handler).toHaveBeenCalledExactlyOnceWith();
  await completeAppExit();
  expect(invokeMock).toHaveBeenCalledExactlyOnceWith("complete_app_exit");
});

it("propagates native subscription and completion failures", async () => {
  // 测试目标：验证 API 不把订阅或确认失败伪装成成功，交由生命周期层记录和原生超时处理。
  // 构造方法：让 listen 同步抛出、invoke 异步拒绝，然后调用封装。
  // 输入数据：missing_tauri 与 exit_not_pending 错误。
  // 预期行为：两个封装均拒绝对应错误。
  listenMock.mockImplementationOnce(() => { throw new Error("missing_tauri"); });
  invokeMock.mockRejectedValueOnce("exit_not_pending");
  await expect(listenAppExitRequested(vi.fn())).rejects.toThrow("missing_tauri");
  await expect(completeAppExit()).rejects.toBe("exit_not_pending");
});

it.each([false, true])("synchronizes authenticated=%s through the native command", async (authenticated) => {
  // 测试目标：验证登录状态封装使用稳定 command 和准确布尔参数。
  // 构造方法：替换 invoke 为可观察的异步函数，分别同步未登录与已登录状态。
  // 输入数据：authenticated 为 false 或 true。
  // 预期行为：仅调用 set_app_authenticated，参数为 { authenticated }，不传窗口身份。
  invokeMock.mockResolvedValueOnce(undefined);
  await setAppAuthenticated(authenticated);
  expect(invokeMock).toHaveBeenCalledExactlyOnceWith("set_app_authenticated", { authenticated });
});

it("propagates authentication synchronization errors for lifecycle retry", async () => {
  // 测试目标：验证原生同步失败不会被 API 隐藏，可由生命周期执行有界重试。
  // 构造方法：使 invoke 异步拒绝，调用登录状态同步封装。
  // 输入数据：authenticated=true，错误 tray_unavailable。
  // 预期行为：封装拒绝相同错误，不伪装为托盘已启用。
  invokeMock.mockRejectedValueOnce("tray_unavailable");
  await expect(setAppAuthenticated(true)).rejects.toBe("tray_unavailable");
});
