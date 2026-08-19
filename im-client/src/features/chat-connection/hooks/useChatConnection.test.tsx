import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useChatConnection } from "./useChatConnection";
import type { AuthSession } from "../../login/types";
import type { ChatWebSocket } from "../types";

class MockWebSocket implements ChatWebSocket {
  readonly sent: string[] = [];
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  receive(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

const initialSession: AuthSession = {
  accessToken: "expired-access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
};

describe("useChatConnection", () => {
  it("opens a WebSocket when a session is available and closes it on unmount", () => {
    // 测试目标：验证已登录 session 会触发聊天 WebSocket 连接，并在组件卸载时关闭。
    // 构造方法：渲染 hook，注入收集 socket 实例的 webSocketFactory。
    // 输入数据：imChatWsUrl 为 ws://127.0.0.1:9001/ws。
    // 预期行为：创建一个 socket，unmount 后该 socket readyState 为 CLOSED。
    const sockets: MockWebSocket[] = [];
    const webSocketFactory = () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    };
    const requestIdFactory = () => "req-1";
    const { unmount } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession: vi.fn(),
      webSocketFactory,
      requestIdFactory,
    }));

    expect(sockets).toHaveLength(1);

    unmount();

    expect(sockets[0].readyState).toBe(WebSocket.CLOSED);
  });

  it("refreshes the session and reconnects when auth fails because the token expired", async () => {
    // 测试目标：验证 auth_failed token_expired 会调用 refreshSession 并用新 session 重连。
    // 构造方法：渲染 hook，第一条 socket 注入 token_expired，refreshSession 返回新 access token 和 ws_url。
    // 输入数据：第一次连接使用 expired-access-token，刷新后使用 new-access-token。
    // 预期行为：创建第二条 socket，第二条 auth 首帧携带 new-access-token。
    const sockets: MockWebSocket[] = [];
    const webSocketFactory = () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    };
    const requestIdFactory = () => `req-${sockets.length}`;
    const refreshSession = vi.fn().mockResolvedValueOnce({
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
    });

    const refreshedSession: AuthSession = {
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
    };
    const { result, rerender } = renderHook(
      ({ session }) => useChatConnection({
        session,
        refreshSession,
        webSocketFactory,
        requestIdFactory,
      }),
      { initialProps: { session: initialSession } },
    );

    await act(async () => {
      sockets[0].receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "token_expired", message: "access token expired" },
      }));
    });
    rerender({ session: refreshedSession });

    await waitFor(() => expect(sockets).toHaveLength(2));
    act(() => {
      sockets[1].onopen?.(new Event("open"));
    });

    expect(refreshSession).toHaveBeenCalled();
    expect(result.current.state.status).toBe("authenticating");
    expect(JSON.parse(sockets[1].sent[0]).payload.access_token).toBe("new-access-token");
  });

  it("does not refresh when auth fails for a non-expiration error", async () => {
    // 测试目标：验证 invalid_token 等非过期错误不会进入自动 refresh 循环。
    // 构造方法：渲染 hook 后注入 auth_failed invalid_token。
    // 输入数据：error_code=invalid_token。
    // 预期行为：refreshSession 不被调用，状态保持 auth_failed。
    const socket = new MockWebSocket();
    const refreshSession = vi.fn();
    const webSocketFactory = () => socket;
    const requestIdFactory = () => "req-1";
    const { result } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
      requestIdFactory,
    }));

    await act(async () => {
      socket.receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "invalid_token", message: "invalid access token" },
      }));
    });

    expect(refreshSession).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ status: "auth_failed", errorCode: "invalid_token" });
  });
});
