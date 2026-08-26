import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../api";
import { useAuthSession } from "./useAuthSession";

const {
  deleteRefreshTokenMock,
  listSavedUsersMock,
  loadSavedRefreshTokenMock,
  loginMock,
  logoutMock,
  refreshMock,
  saveRefreshTokenMock,
} = vi.hoisted(() => ({
  deleteRefreshTokenMock: vi.fn(),
  listSavedUsersMock: vi.fn(),
  loadSavedRefreshTokenMock: vi.fn(),
  loginMock: vi.fn(),
  logoutMock: vi.fn(),
  refreshMock: vi.fn(),
  saveRefreshTokenMock: vi.fn(),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    AuthApiError: actual.AuthApiError,
    login: loginMock,
    logout: logoutMock,
    refresh: refreshMock,
  };
});
vi.mock("../credentials", () => ({
  deleteRefreshToken: deleteRefreshTokenMock,
  listSavedUsers: listSavedUsersMock,
  loadSavedRefreshToken: loadSavedRefreshTokenMock,
  saveRefreshToken: saveRefreshTokenMock,
}));

describe("useAuthSession", () => {
  beforeEach(() => {
    deleteRefreshTokenMock.mockReset();
    listSavedUsersMock.mockReset();
    loadSavedRefreshTokenMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    refreshMock.mockReset();
    saveRefreshTokenMock.mockReset();
    deleteRefreshTokenMock.mockResolvedValue(undefined);
    listSavedUsersMock.mockResolvedValue([]);
    logoutMock.mockResolvedValue(undefined);
    saveRefreshTokenMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads saved users without automatically refreshing a session", async () => {
    // Test goal: verify startup keeps the app on the login page and only loads the saved-user index.
    // Construction: mock one saved user, render the hook, and wait for saved-user loading to finish.
    // Input data: saved user { userId: 20001, account: "00123456" }.
    // Expected behavior: savedUsers is populated, session remains null, and refresh is not called automatically.
    listSavedUsersMock.mockResolvedValueOnce([{ userId: 20001, account: "00123456" }]);

    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));

    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    expect(result.current.savedUsers).toEqual([{ userId: 20001, account: "00123456" }]);
    expect(result.current.session).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("uses normal login and deletes local credentials when auto-login is off", async () => {
    // Test goal: verify password login without the auto-login flag does not save refresh-token credentials.
    // Construction: render with no saved users, mock login success, and call authenticateWithPassword with autoLogin=false.
    // Input data: account 00123456, password secret, returned session userId 20001.
    // Expected behavior: login is called, saveRefreshToken is not called, and deleteRefreshToken targets user 20001.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", false);
    });

    expect(loginMock).toHaveBeenCalledWith("http://127.0.0.1:8080", { account: "00123456", password: "secret" });
    expect(saveRefreshTokenMock).not.toHaveBeenCalled();
    expect(deleteRefreshTokenMock).toHaveBeenCalledWith(20001);
    expect(result.current.session?.refreshToken).toBe("refresh-token");
    expect(result.current.session?.refreshTokenPersistence).toBe("session_only");
  });

  it("saves refresh-token credentials when auto-login is on", async () => {
    // Test goal: verify password login with auto-login persists the refresh token under the returned user id.
    // Construction: render with no saved users, mock login success, and call authenticateWithPassword with autoLogin=true.
    // Input data: account 00123456, password secret, returned refresh token refresh-token.
    // Expected behavior: saveRefreshToken receives user id, account label, and refresh token.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", true);
    });

    expect(saveRefreshTokenMock).toHaveBeenCalledWith(20001, "00123456", "refresh-token");
    expect(deleteRefreshTokenMock).not.toHaveBeenCalled();
    expect(result.current.session?.userId).toBe(20001);
    expect(result.current.session?.refreshTokenPersistence).toBe("saved");
  });

  it("keeps the session and exposes a warning when auto-login saving fails", async () => {
    // Test goal: verify credential-save failures do not block the current password login.
    // Construction: mock login success and make saveRefreshToken reject.
    // Input data: account 00123456, autoLogin=true, saveRefreshToken rejection.
    // Expected behavior: authenticateWithPassword resolves, session is set, and credentialWarning explains the save failure.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    saveRefreshTokenMock.mockRejectedValueOnce(new Error("credential_unavailable"));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await expect(result.current.authenticateWithPassword("00123456", "secret", true)).resolves.toBeUndefined();
    });

    expect(deleteRefreshTokenMock).toHaveBeenCalledWith(20001);
    expect(result.current.session?.refreshToken).toBe("refresh-token");
    expect(result.current.session?.refreshTokenPersistence).toBe("session_only");
    expect(result.current.credentialWarning).toBe("自动登录未保存，请稍后重试。");
  });

  it("uses normal login even when password login matches a saved account", async () => {
    // Test goal: verify password login always uses /login and leaves old-token replacement to im-api.
    // Construction: load one saved user, mock login success, and call authenticateWithPassword for the same account.
    // Input data: saved account 00123456, password secret, returned session userId 20001.
    // Expected behavior: local old refresh token is not loaded and login is called normally.
    listSavedUsersMock.mockResolvedValueOnce([{ userId: 20001, account: "00123456" }]);
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "new-refresh-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", true);
    });

    expect(loadSavedRefreshTokenMock).not.toHaveBeenCalled();
    expect(loginMock).toHaveBeenCalledWith("http://127.0.0.1:8080", { account: "00123456", password: "secret" });
    expect(saveRefreshTokenMock).toHaveBeenCalledWith(20001, "00123456", "new-refresh-token");
  });

  it("logs in with a selected saved user refresh token", async () => {
    // Test goal: verify selecting a saved user explicitly refreshes a session with that user's saved refresh token.
    // Construction: mock loadSavedRefreshToken and refresh success, then call loginSavedUser.
    // Input data: userId 20001 and saved refresh token refresh-token.
    // Expected behavior: refresh receives the saved token and the hook session is updated.
    loadSavedRefreshTokenMock.mockResolvedValueOnce("refresh-token");
    refreshMock.mockResolvedValueOnce(session({ userId: 20001, accessToken: "new-jwt-access-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await result.current.loginSavedUser(20001);
    });

    expect(refreshMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(result.current.session?.accessToken).toBe("new-jwt-access-token");
    expect(result.current.session?.refreshTokenPersistence).toBe("saved");
  });

  it("keeps the refresh-token persistence marker after refreshing the active session", async () => {
    // Test goal: verify access-token refresh does not downgrade a saved refresh token into a session-only token.
    // Construction: login with auto-login enabled, then mock refresh success and call refreshSession.
    // Input data: saved session for user 20001 and refreshed access token new-jwt-access-token.
    // Expected behavior: returned and stored sessions keep refreshTokenPersistence=saved.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    refreshMock.mockResolvedValueOnce(session({ userId: 20001, accessToken: "new-jwt-access-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));
    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", true);
    });

    let refreshed = null as Awaited<ReturnType<typeof result.current.refreshSession>>;
    await act(async () => {
      refreshed = await result.current.refreshSession();
    });

    expect(refreshed?.accessToken).toBe("new-jwt-access-token");
    expect(refreshed?.refreshTokenPersistence).toBe("saved");
    expect(result.current.session?.refreshTokenPersistence).toBe("saved");
  });

  it("deletes saved credentials when selected saved login is invalid", async () => {
    // Test goal: verify invalid saved refresh tokens are removed from local credentials.
    // Construction: mock loadSavedRefreshToken success and refresh rejection with invalid_refresh_token.
    // Input data: userId 20001, saved refresh token refresh-token, AuthApiError("invalid_refresh_token").
    // Expected behavior: loginSavedUser rejects and deleteRefreshToken removes user 20001.
    loadSavedRefreshTokenMock.mockResolvedValueOnce("refresh-token");
    refreshMock.mockRejectedValueOnce(new AuthApiError("invalid_refresh_token"));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));

    await act(async () => {
      await expect(result.current.loginSavedUser(20001)).rejects.toMatchObject({ code: "invalid_refresh_token" });
    });

    expect(deleteRefreshTokenMock).toHaveBeenCalledWith(20001);
    expect(result.current.session).toBeNull();
  });

  it("clears local credentials for the current user even when logout request fails", async () => {
    // Test goal: verify active logout always clears the local saved credential for the current user.
    // Construction: establish a session, make logout reject with network_error, and call logout.
    // Input data: session userId 20001 with refresh token refresh-token.
    // Expected behavior: deleteRefreshToken is called for user 20001 and session becomes null.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    logoutMock.mockRejectedValueOnce(new AuthApiError("network_error"));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));
    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", false);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(logoutMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(deleteRefreshTokenMock).toHaveBeenCalledWith(20001);
    expect(result.current.session).toBeNull();
  });

  it("logs out a session-only refresh token before app close", async () => {
    // Test goal: verify closing the app revokes a temporary refresh token that was not saved for auto-login.
    // Construction: login with autoLogin=false and call cleanupBeforeAppClose.
    // Input data: session-only refresh token refresh-token.
    // Expected behavior: logout is called with refresh-token and the in-memory session is cleared.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));
    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", false);
    });

    await act(async () => {
      await result.current.cleanupBeforeAppClose();
    });

    expect(logoutMock).toHaveBeenCalledWith("http://127.0.0.1:8080", "refresh-token");
    expect(result.current.session).toBeNull();
  });

  it("keeps saved refresh tokens when app close cleanup runs", async () => {
    // Test goal: verify closing the app does not revoke a refresh token that is persisted for saved-user login.
    // Construction: login with autoLogin=true and call cleanupBeforeAppClose.
    // Input data: saved refresh token refresh-token.
    // Expected behavior: logout is not called and the saved session remains available until the process closes.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));
    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", true);
    });

    await act(async () => {
      await result.current.cleanupBeforeAppClose();
    });

    expect(logoutMock).not.toHaveBeenCalled();
    expect(result.current.session?.refreshTokenPersistence).toBe("saved");
  });

  it("resolves app close cleanup when session-only logout fails", async () => {
    // Test goal: verify best-effort close cleanup does not reject when the server logout request fails.
    // Construction: login with autoLogin=false, make logout reject, and call cleanupBeforeAppClose.
    // Input data: session-only refresh token and AuthApiError("network_error").
    // Expected behavior: cleanupBeforeAppClose resolves and clears the in-memory session.
    loginMock.mockResolvedValueOnce(session({ userId: 20001, refreshToken: "refresh-token" }));
    logoutMock.mockRejectedValueOnce(new AuthApiError("network_error"));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));
    await waitFor(() => expect(result.current.isLoadingSavedUsers).toBe(false));
    await act(async () => {
      await result.current.authenticateWithPassword("00123456", "secret", false);
    });

    await act(async () => {
      await expect(result.current.cleanupBeforeAppClose()).resolves.toBeUndefined();
    });

    expect(result.current.session).toBeNull();
  });
});

function session(overrides: Partial<ReturnType<typeof sessionShape>> = {}) {
  return { ...sessionShape(), ...overrides };
}

function sessionShape() {
  return {
    userId: 20001,
    accessToken: "jwt-access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
    imChatWsUrl: "ws://127.0.0.1:9001/ws",
    refreshTokenPersistence: "session_only" as const,
  };
}
