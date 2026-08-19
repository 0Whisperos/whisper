import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthSession } from "./useAuthSession";

const { deleteRefreshTokenMock, loadSavedRefreshTokenMock, logoutMock, refreshMock, saveRefreshTokenMock } = vi.hoisted(() => ({
  deleteRefreshTokenMock: vi.fn(),
  loadSavedRefreshTokenMock: vi.fn(),
  logoutMock: vi.fn(),
  refreshMock: vi.fn(),
  saveRefreshTokenMock: vi.fn(),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { AuthApiError: actual.AuthApiError, logout: logoutMock, refresh: refreshMock };
});
vi.mock("../credentials", () => ({
  deleteRefreshToken: deleteRefreshTokenMock,
  loadSavedRefreshToken: loadSavedRefreshTokenMock,
  saveRefreshToken: saveRefreshTokenMock,
}));

describe("useAuthSession", () => {
  beforeEach(() => {
    deleteRefreshTokenMock.mockReset();
    loadSavedRefreshTokenMock.mockReset();
    logoutMock.mockReset();
    refreshMock.mockReset();
    saveRefreshTokenMock.mockReset();
    deleteRefreshTokenMock.mockResolvedValue(undefined);
    saveRefreshTokenMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a saved refresh token on startup", async () => {
    // 测试目标：验证启动时存在本地 refresh token 会自动调用 refresh 并进入已登录态。
    // 构造方法：mock 本地凭证读取和 refresh API 成功，再渲染 hook。
    // 输入数据：本地 refresh-token，refresh 返回 new-jwt-access-token。
    // 预期行为：session 更新为 refresh 返回的会话，恢复状态结束。
    loadSavedRefreshTokenMock.mockResolvedValueOnce("refresh-token");
    refreshMock.mockResolvedValueOnce({
      accessToken: "new-jwt-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9001/ws",
    });

    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));

    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

    expect(refreshMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(result.current.session?.accessToken).toBe("new-jwt-access-token");
    expect(result.current.session?.imChatWsUrl).toBe("ws://127.0.0.1:9001/ws");
  });

  it("deletes saved refresh token when refresh is invalid", async () => {
    // 测试目标：验证 refresh token 无效或过期时清理本地凭证并回到登录态。
    // 构造方法：mock 本地凭证存在，refresh API 拒绝为 invalid_refresh_token。
    // 输入数据：AuthApiError("invalid_refresh_token")。
    // 预期行为：deleteRefreshToken 被调用，session 保持 null，恢复状态结束。
    loadSavedRefreshTokenMock.mockResolvedValueOnce("refresh-token");
    refreshMock.mockRejectedValueOnce({ code: "invalid_refresh_token" });

    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));

    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

    expect(deleteRefreshTokenMock).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it("keeps saved refresh token when refresh fails due to network", async () => {
    // 测试目标：验证启动 refresh 遇到网络错误时不删除 refresh token，便于下次启动继续尝试。
    // 构造方法：mock 本地凭证存在，refresh API 拒绝为 network_error。
    // 输入数据：AuthApiError("network_error")。
    // 预期行为：deleteRefreshToken 不被调用，session 保持 null。
    loadSavedRefreshTokenMock.mockResolvedValueOnce("refresh-token");
    refreshMock.mockRejectedValueOnce({ code: "network_error" });

    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));

    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

    expect(deleteRefreshTokenMock).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it("saves refresh token when accepting a login session", async () => {
    // 测试目标：验证登录成功交给 hook 后会持久化 refresh token 并设置内存会话。
    // 构造方法：渲染 hook，调用 acceptSession。
    // 输入数据：包含 refreshToken 的 AuthSession。
    // 预期行为：saveRefreshToken 收到 refresh-token，session 更新。
    loadSavedRefreshTokenMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

    await act(async () => {
      await result.current.acceptSession({
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
      });
    });

    expect(saveRefreshTokenMock).toHaveBeenCalledWith("refresh-token");
    expect(result.current.session?.refreshToken).toBe("refresh-token");
    expect(result.current.session?.imChatWsUrl).toBe("ws://127.0.0.1:9001/ws");
  });

  it("refreshes the current session and keeps the saved refresh token", async () => {
    // 测试目标：验证 refreshSession 复用当前 refresh token 并更新内存 session。
    // 构造方法：先 acceptSession 建立当前会话，再 mock refresh API 成功返回新 access token。
    // 输入数据：当前 refreshToken=refresh-token，刷新响应 accessToken=new-jwt-access-token。
    // 预期行为：refresh API 收到原 refresh token，hook session 更新为新 access token 和 ws_url。
    loadSavedRefreshTokenMock.mockResolvedValueOnce(null);
    refreshMock.mockResolvedValueOnce({
      accessToken: "new-jwt-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
    });
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));
    await act(async () => {
      await result.current.acceptSession({
        accessToken: "old-jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
      });
    });

    await act(async () => {
      await expect(result.current.refreshSession()).resolves.toMatchObject({
        accessToken: "new-jwt-access-token",
        imChatWsUrl: "ws://127.0.0.1:9002/ws",
      });
    });

    expect(refreshMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(result.current.session?.accessToken).toBe("new-jwt-access-token");
  });

  it("clears local credentials even when logout request fails", async () => {
    // 测试目标：验证主动退出登录时即使服务端不可达，也会删除本地 refresh token 和内存会话。
    // 构造方法：建立内存会话，让 logout API 拒绝后调用 hook 的 logout。
    // 输入数据：会话 refreshToken refresh-token，logout rejection 为 network_error。
    // 预期行为：deleteRefreshToken 被调用，session 为 null。
    loadSavedRefreshTokenMock.mockResolvedValueOnce(null);
    logoutMock.mockRejectedValueOnce({ code: "network_error" });
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

    await act(async () => {
      await result.current.acceptSession({
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
      });
    });
    await act(async () => {
      await result.current.logout();
    });

    expect(logoutMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(deleteRefreshTokenMock).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });
});
