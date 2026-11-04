import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { AppExitRequestedHandler } from "./features/app-lifecycle/api";

const { completeAppExitMock, listenAppExitRequestedMock, loadClientConfigMock, useAuthSessionMock, closeViewerMock, setAppAuthenticatedMock } = vi.hoisted(() => ({
  completeAppExitMock: vi.fn(),
  listenAppExitRequestedMock: vi.fn(),
  loadClientConfigMock: vi.fn(),
  useAuthSessionMock: vi.fn(),
  closeViewerMock: vi.fn(),
  setAppAuthenticatedMock: vi.fn(),
}));

vi.mock("./features/image-viewer/coordinator", () => ({ imageViewerCoordinator: { close: closeViewerMock } }));
vi.mock("./features/client-config/api", () => ({ loadClientConfig: loadClientConfigMock }));
vi.mock("./features/login/hooks/useAuthSession", () => ({ useAuthSession: useAuthSessionMock }));
vi.mock("./features/app-lifecycle/api", () => ({
  completeAppExit: completeAppExitMock,
  listenAppExitRequested: listenAppExitRequestedMock,
  setAppAuthenticated: setAppAuthenticatedMock,
}));
vi.mock("./routes/AuthenticatedPage", () => ({
  AuthenticatedPage: ({ session }: { session: { imChatWsUrl: string } }) => <div>chat api: {session.imChatWsUrl}</div>,
}));
vi.mock("./routes/LoginPage", () => ({
  LoginPage: ({ savedUsers }: { savedUsers: { account: string }[] }) => <div>login users: {savedUsers.map((user) => user.account).join(",")}</div>,
}));

describe("App", () => {
  const exitHandlers: AppExitRequestedHandler[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    exitHandlers.length = 0;
    closeViewerMock.mockResolvedValue(undefined);
    completeAppExitMock.mockResolvedValue(undefined);
    setAppAuthenticatedMock.mockResolvedValue(undefined);
    listenAppExitRequestedMock.mockImplementation(async (handler: AppExitRequestedHandler) => {
      exitHandlers.push(handler);
      return vi.fn();
    });
    useAuthSessionMock.mockReturnValue({
      session: null,
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      registerAccount: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose: vi.fn(),
    });
  });

  it("renders the login route after client configuration loads", async () => {
    // Test goal: verify the login route is shown only after client configuration loads.
    // Construction: mock the client configuration API to return a local API base URL, then render App.
    // Input data: { apiBaseUrl: "http://127.0.0.1:8080" }.
    // Expected behavior: the login route renders after config loading instead of auto-restoring a session.
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    render(<App />);
    expect(await screen.findByText("login users:")).toBeInTheDocument();
  });

  it("blocks login when client configuration cannot load", async () => {
    // Test goal: verify invalid client configuration prevents the login route from rendering.
    // Construction: mock the client configuration API to reject, then render App.
    // Input data: a rejected client_config_unavailable error.
    // Expected behavior: the configuration error view is shown and the login route is absent.
    loadClientConfigMock.mockRejectedValueOnce(new Error("client_config_unavailable"));
    render(<App />);
    expect(await screen.findByText(/Whisper/)).toBeInTheDocument();
    expect(screen.queryByText(/login users:/)).not.toBeInTheDocument();
  });

  it("passes the authenticated session to the authenticated route", async () => {
    // Test goal: verify the authenticated client route receives the selected im-chat node URL.
    // Construction: mock an authenticated session and replace AuthenticatedPage with an observable route substitute.
    // Input data: session.imChatWsUrl = "ws://127.0.0.1:9001/ws".
    // Expected behavior: the authenticated route displays the im-chat WebSocket URL from session.
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    useAuthSessionMock.mockReturnValue({
      ...useAuthSessionMock(),
      session: {
        userId: 20001,
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
        refreshTokenPersistence: "session_only",
      },
    });
    render(<App />);
    expect(await screen.findByText(/chat api: ws:\/\/127\.0\.0\.1:9001\/ws/)).toBeInTheDocument();
  });

  it("preserves the session until the native tray requests full exit", async () => {
    // 测试目标：验证 App 装配生命周期，但只有托盘退出事件触发认证和查看器清理。
    // 构造方法：使用真实生命周期 hook，替换认证和原生 API；加载登录页后触发捕获的退出事件。
    // 输入数据：客户端 API 地址和无 payload 的 app-exit-requested 事件。
    // 预期行为：挂载不清理；收到退出事件后两项清理各一次，并确认完整退出。
    const cleanupBeforeAppClose = vi.fn().mockResolvedValue(undefined);
    useAuthSessionMock.mockReturnValue({ ...useAuthSessionMock(), cleanupBeforeAppClose });
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    render(<App />);
    await screen.findByText("login users:");
    await waitFor(() => expect(exitHandlers).toHaveLength(1));
    expect(cleanupBeforeAppClose).not.toHaveBeenCalled();
    expect(closeViewerMock).not.toHaveBeenCalled();
    await act(async () => { await exitHandlers[0](); });
    expect(cleanupBeforeAppClose).toHaveBeenCalledOnce();
    expect(closeViewerMock).toHaveBeenCalledOnce();
    expect(completeAppExitMock).toHaveBeenCalledOnce();
  });

  it("synchronizes session presence through login, refresh, and session invalidation", async () => {
    // 测试目标：验证 App 将真实会话存在状态传给生命周期，而不是页面或 token 对象身份。
    // 构造方法：挂载登录页，替换认证 hook 的 session 为已登录、刷新会话及 null，逐次重渲染。
    // 输入数据：null → access-token-1 → access-token-2 → null；同一服务器 WebSocket 地址。
    // 预期行为：页面随会话切换；仅同步 false、true、false，刷新不新增 IPC。
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    const authState = useAuthSessionMock();
    const session = { userId: 20001, accessToken: "access-token-1", imChatWsUrl: "ws://127.0.0.1:9001/ws" };
    const view = render(<App />);
    await screen.findByText("login users:");
    await waitFor(() => expect(setAppAuthenticatedMock).toHaveBeenCalledExactlyOnceWith(false));
    useAuthSessionMock.mockReturnValue({ ...authState, session });
    view.rerender(<App />);
    await screen.findByText(/chat api:/);
    await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true]]));
    useAuthSessionMock.mockReturnValue({ ...authState, session: { ...session, accessToken: "access-token-2" } });
    view.rerender(<App />);
    await act(async () => {});
    expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true]]);
    useAuthSessionMock.mockReturnValue(authState);
    view.rerender(<App />);
    await screen.findByText("login users:");
    await waitFor(() => expect(setAppAuthenticatedMock.mock.calls).toEqual([[false], [true], [false]]));
  });
});
