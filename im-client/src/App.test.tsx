import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const { loadClientConfigMock, useAuthSessionMock } = vi.hoisted(() => ({
  loadClientConfigMock: vi.fn(),
  useAuthSessionMock: vi.fn(),
}));

vi.mock("./features/client-config/api", () => ({ loadClientConfig: loadClientConfigMock }));
vi.mock("./features/login/hooks/useAuthSession", () => ({ useAuthSession: useAuthSessionMock }));
vi.mock("./routes/AuthenticatedPage", () => ({
  AuthenticatedPage: ({ session }: { session: { imChatWsUrl: string } }) => <div>chat api: {session.imChatWsUrl}</div>,
}));
vi.mock("./routes/LoginPage", () => ({
  LoginPage: ({ apiBaseUrl }: { apiBaseUrl: string }) => <div>login api: {apiBaseUrl}</div>,
}));

describe("App", () => {
  beforeEach(() => {
    loadClientConfigMock.mockReset();
    useAuthSessionMock.mockReset();
    useAuthSessionMock.mockReturnValue({
      session: null,
      acceptSession: vi.fn(),
      refreshSession: vi.fn(),
      isRestoringSession: false,
      isLoggingOut: false,
      logout: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the login route after client configuration loads", async () => {
    // Test goal: verify the login route is shown only after client configuration loads.
    // Construction: mock the client configuration API to return a local API base URL, then render App.
    // Input data: { apiBaseUrl: "http://127.0.0.1:8080" }.
    // Expected behavior: the login route receives and displays the configured API base URL.
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });

    render(<App />);

    expect(await screen.findByText("login api: http://127.0.0.1:8080")).toBeInTheDocument();
  });

  it("blocks login when client configuration cannot load", async () => {
    // Test goal: verify invalid client configuration prevents the login route from rendering.
    // Construction: mock the client configuration API to reject, then render App.
    // Input data: a rejected client_config_unavailable error.
    // Expected behavior: the configuration error view is shown and the login route is absent.
    loadClientConfigMock.mockRejectedValueOnce(new Error("client_config_unavailable"));

    render(<App />);

    expect(await screen.findByText(/Whisper/)).toBeInTheDocument();
    expect(screen.queryByText(/login api:/)).not.toBeInTheDocument();
  });

  it("passes the authenticated session to the authenticated route", async () => {
    // Test goal: verify the authenticated client route receives the selected im-chat node URL.
    // Construction: mock an authenticated session and replace AuthenticatedPage with an observable route substitute.
    // Input data: session.imChatWsUrl = "ws://127.0.0.1:9001/ws".
    // Expected behavior: the authenticated route displays the im-chat WebSocket URL from session.
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });
    useAuthSessionMock.mockReturnValue({
      session: {
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
      },
      acceptSession: vi.fn(),
      refreshSession: vi.fn(),
      isRestoringSession: false,
      isLoggingOut: false,
      logout: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText(/chat api: ws:\/\/127\.0\.0\.1:9001\/ws/)).toBeInTheDocument();
    await waitFor(() => expect(loadClientConfigMock).toHaveBeenCalled());
  });
});
