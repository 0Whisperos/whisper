import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { CloseRequestedEvent, CloseRequestedHandler } from "./shared/tauri/appWindow";

const { destroyAppWindowMock, listenAppCloseRequestedMock, loadClientConfigMock, useAuthSessionMock } = vi.hoisted(() => ({
  destroyAppWindowMock: vi.fn(),
  listenAppCloseRequestedMock: vi.fn(),
  loadClientConfigMock: vi.fn(),
  useAuthSessionMock: vi.fn(),
}));

vi.mock("./features/client-config/api", () => ({ loadClientConfig: loadClientConfigMock }));
vi.mock("./features/login/hooks/useAuthSession", () => ({ useAuthSession: useAuthSessionMock }));
vi.mock("./shared/tauri/appWindow", () => ({
  destroyAppWindow: destroyAppWindowMock,
  listenAppCloseRequested: listenAppCloseRequestedMock,
}));
vi.mock("./routes/AuthenticatedPage", () => ({
  AuthenticatedPage: ({ session }: { session: { imChatWsUrl: string } }) => <div>chat api: {session.imChatWsUrl}</div>,
}));
vi.mock("./routes/LoginPage", () => ({
  LoginPage: ({ savedUsers }: { savedUsers: { account: string }[] }) => <div>login users: {savedUsers.map((user) => user.account).join(",")}</div>,
}));

describe("App", () => {
  const closeHandlers: CloseRequestedHandler[] = [];

  beforeEach(() => {
    closeHandlers.length = 0;
    destroyAppWindowMock.mockReset();
    listenAppCloseRequestedMock.mockReset();
    loadClientConfigMock.mockReset();
    useAuthSessionMock.mockReset();
    destroyAppWindowMock.mockResolvedValue(undefined);
    listenAppCloseRequestedMock.mockImplementation(async (handler: CloseRequestedHandler) => {
      closeHandlers.push(handler);
      return vi.fn();
    });
    useAuthSessionMock.mockReturnValue({
      session: null,
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      session: {
        userId: 20001,
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
        refreshTokenPersistence: "session_only",
      },
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText(/chat api: ws:\/\/127\.0\.0\.1:9001\/ws/)).toBeInTheDocument();
    await waitFor(() => expect(loadClientConfigMock).toHaveBeenCalled());
  });

  it("cleans up the current session before destroying the window on close request", async () => {
    // Test goal: verify Tauri close requests run session cleanup before closing the app window.
    // Construction: mock the Tauri window wrapper, render App, then trigger the captured close handler.
    // Input data: a close event with preventDefault and a cleanupBeforeAppClose mock.
    // Expected behavior: the close is intercepted, cleanup runs, and destroyAppWindow is called afterwards.
    const events: string[] = [];
    const cleanupBeforeAppClose = vi.fn(async () => {
      events.push("cleanup");
    });
    destroyAppWindowMock.mockImplementation(async () => {
      events.push("destroy");
    });
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    useAuthSessionMock.mockReturnValue({
      session: null,
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose,
    });
    render(<App />);
    await waitFor(() => expect(closeHandlers).toHaveLength(1));
    const event = closeEvent();

    await act(async () => {
      await closeHandlers[0](event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(events).toEqual(["cleanup", "destroy"]);
  });

  it("destroys the window even when close cleanup fails", async () => {
    // Test goal: verify best-effort close cleanup cannot trap the user in a window that refuses to close.
    // Construction: mock cleanupBeforeAppClose to reject, then trigger the close handler.
    // Input data: cleanup rejection Error("network_error").
    // Expected behavior: destroyAppWindow still runs after preventDefault.
    const cleanupBeforeAppClose = vi.fn().mockRejectedValueOnce(new Error("network_error"));
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    useAuthSessionMock.mockReturnValue({
      session: null,
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose,
    });
    render(<App />);
    await waitFor(() => expect(closeHandlers).toHaveLength(1));
    const event = closeEvent();

    await act(async () => {
      await closeHandlers[0](event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(destroyAppWindowMock).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated close requests while window destruction is already in progress", async () => {
    // Test goal: verify duplicate close events do not duplicate logout cleanup or destroy calls.
    // Construction: keep cleanup pending, trigger two close events, then resolve cleanup.
    // Input data: two close events fired before the first cleanup finishes.
    // Expected behavior: cleanupBeforeAppClose and destroyAppWindow are each called once.
    let resolveCleanup: () => void = () => undefined;
    const cleanupBeforeAppClose = vi.fn(() => new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    }));
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    useAuthSessionMock.mockReturnValue({
      session: null,
      savedUsers: [],
      credentialWarning: null,
      authenticateWithPassword: vi.fn(),
      loginSavedUser: vi.fn(),
      refreshSession: vi.fn(),
      isLoadingSavedUsers: false,
      isLoggingOut: false,
      logout: vi.fn(),
      cleanupBeforeAppClose,
    });
    render(<App />);
    await waitFor(() => expect(closeHandlers).toHaveLength(1));

    const firstClose = closeHandlers[0](closeEvent());
    await closeHandlers[0](closeEvent());
    resolveCleanup();
    await act(async () => {
      await firstClose;
    });

    expect(cleanupBeforeAppClose).toHaveBeenCalledTimes(1);
    expect(destroyAppWindowMock).toHaveBeenCalledTimes(1);
  });
});

function closeEvent(): CloseRequestedEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() };
}
