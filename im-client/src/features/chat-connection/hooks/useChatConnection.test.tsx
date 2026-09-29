import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

const initialSession: AuthSession = {
  userId: 20001,
  accessToken: "expired-access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
  refreshTokenPersistence: "session_only",
};

describe("useChatConnection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

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

  it("refreshes sixty seconds before the server-reported token expiration and reconnects", async () => {
    // 测试目标：验证客户端使用 auth_ok 提供的过期时间提前 60 秒续期，并用新 token 建立新连接。
    // 构造方法：冻结系统时间，认证第一条 socket，推进到续期边界，再将刷新后的 session 传回 hook。
    // 输入数据：token 在 12:15:00Z 过期，当前时间为 12:00:00Z，刷新后 token 为 new-access-token。
    // 预期行为：14 分钟 59.999 秒内不刷新，边界到达时只刷新一次，第二条 socket 使用新 token。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const sockets: MockWebSocket[] = [];
    const webSocketFactory = () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    };
    const refreshedSession: AuthSession = {
      ...initialSession,
      accessToken: "new-access-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00Z",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
    };
    const refreshSession = vi.fn().mockResolvedValue(refreshedSession);
    const { rerender } = renderHook(
      ({ session }) => useChatConnection({ session, refreshSession, webSocketFactory }),
      { initialProps: { session: initialSession } },
    );

    act(() => {
      sockets[0].open();
      sockets[0].receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "old-connection",
          access_token_expires_at: "2026-08-16T12:15:00Z",
        },
      }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000 - 1);
    });
    expect(refreshSession).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    await act(async () => undefined);
    expect(refreshSession).toHaveBeenCalledTimes(1);

    rerender({ session: refreshedSession });
    expect(sockets).toHaveLength(2);
    act(() => sockets[1].open());
    expect(JSON.parse(sockets[1].sent[0]).payload.access_token).toBe("new-access-token");
  });

  it.each([
    ["already expired", "2026-08-16T11:59:00Z"],
    ["invalid", "not-a-timestamp"],
  ])("refreshes immediately when auth_ok has an %s expiration time", (_description, expiresAt) => {
    // 测试目标：验证已过期或无法解析的服务端到期时间会立即触发续期。
    // 构造方法：冻结系统时间，认证 socket 并推进零延时定时器。
    // 输入数据：access_token_expires_at 分别为过去时间或无效时间文本。
    // 预期行为：refreshSession 被调用一次，不等待正常的 60 秒提前窗口。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const socket = new MockWebSocket();
    const webSocketFactory = () => socket;
    const refreshSession = vi.fn(() => new Promise<AuthSession | null>(() => undefined));
    renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
    }));

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "connection-1",
          access_token_expires_at: expiresAt,
        },
      }));
    });
    act(() => vi.advanceTimersByTime(1));

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("coalesces scheduled renewal and the token_expired server fallback", async () => {
    // 测试目标：验证定时续期和服务端过期通知同时到达时只发起一次 refresh 请求。
    // 构造方法：让无效到期时间安排零延时续期，在该定时器运行前注入 auth_failed(token_expired)，并保持刷新请求未完成。
    // 输入数据：auth_ok 的到期时间为无效文本，随后收到 token_expired；刷新请求由测试控制完成。
    // 预期行为：两个触发共用同一个 refreshSession 请求。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const socket = new MockWebSocket();
    const webSocketFactory = () => socket;
    let finishRefresh: ((session: AuthSession | null) => void) | null = null;
    const refreshSession = vi.fn(() => new Promise<AuthSession | null>((resolve) => {
      finishRefresh = resolve;
    }));
    const { result } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
    }));

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "connection-1",
          access_token_expires_at: "invalid-time",
        },
      }));
      socket.receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "token_expired", message: "access token expired" },
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    await act(async () => finishRefresh?.(null));
    expect(result.current.state).toMatchObject({ status: "auth_failed", errorCode: "token_expired" });
  });

  it("cancels the scheduled renewal when the hook unmounts", async () => {
    // 测试目标：验证组件卸载后已安排的续期定时器不会再访问认证 session。
    // 构造方法：认证 socket 安排未来续期，卸载 hook 后将虚拟时间推进到过期之后。
    // 输入数据：token 在虚拟时间 12:15:00Z 过期，hook 在续期提前量到达前卸载。
    // 预期行为：旧 socket 关闭，refreshSession 不被调用。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const socket = new MockWebSocket();
    const webSocketFactory = () => socket;
    const refreshSession = vi.fn();
    const { unmount } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
    }));

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "connection-1",
          access_token_expires_at: "2026-08-16T12:15:00Z",
        },
      }));
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });

    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("cancels the scheduled renewal when the connection is manually closed", async () => {
    // 测试目标：验证用户主动关闭聊天连接后，不会因残留续期定时器再次刷新 token。
    // 构造方法：认证 socket 以安排未来续期，调用 hook 的 close 方法，再推进虚拟时间。
    // 输入数据：token 在虚拟时间 12:15:00Z 过期，用户在 12:00:00Z 主动关闭连接。
    // 预期行为：socket 关闭，refreshSession 不被调用。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const socket = new MockWebSocket();
    const webSocketFactory = () => socket;
    const refreshSession = vi.fn();
    const { result } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
    }));

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "connection-1",
          access_token_expires_at: "2026-08-16T12:15:00Z",
        },
      }));
      result.current.close();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });

    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("exposes text sending and business server frames through the hook", () => {
    // 测试目标：验证页面可通过 hook 发送认证后的文本消息，并接收业务帧回调。
    // 构造方法：渲染 hook、打开并认证测试 socket，调用返回的 sendTextMessage 后注入 server_accepted。
    // 输入数据：clientMessageId=client-message-1、conversationId=10001、text="hello" 和正式 message_id=message-1。
    // 预期行为：socket 发送 send_message，onServerFrame 收到 server_accepted，且 hook 保持 authenticated。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onServerFrame = vi.fn();
    const webSocketFactory = () => socket;
    const requestIdFactory = () => "req-1";
    const { result } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession: vi.fn(),
      onServerFrame,
      webSocketFactory,
      requestIdFactory,
    }));
    act(() => {
      socket.open();
      socket.receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "connection-uuid",
          access_token_expires_at: "2026-08-16T12:15:00+08:00",
        },
      }));
      result.current.sendTextMessage({
        clientMessageId: "client-message-1",
        conversationId: 10001,
        text: "hello",
        clientSentAt: "2026-08-16T12:00:00.000+08:00",
      });
      socket.receive(JSON.stringify({
        type: "server_accepted",
        request_id: "req-message",
        payload: {
          client_message_id: "client-message-1",
          message: {
            message_id: "message-1",
            conversation_id: 10001,
            conversation_seq: 42,
            sender_user_id: 20001,
            client_message_id: "client-message-1",
            message_type: "text",
            content: { text: "hello" },
            created_at: "2026-08-16T12:00:01.123+08:00",
          },
        },
      }));
    });

    expect(JSON.parse(socket.sent[2])).toMatchObject({ type: "send_message" });
    expect(onServerFrame).toHaveBeenCalledWith(expect.objectContaining({ type: "server_accepted" }));
    expect(result.current.state.status).toBe("authenticated");
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
      userId: 20001,
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00Z",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
      refreshTokenPersistence: "session_only",
    });

    const refreshedSession: AuthSession = {
      userId: 20001,
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
      refreshTokenPersistence: "session_only",
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

  it("reports a failed token refresh without retrying", async () => {
    // 测试目标：验证 refresh API 返回失败后连接进入认证失败状态，且不会自动循环重试。
    // 构造方法：渲染 hook，注入 auth_failed(token_expired)，让 refreshSession 返回 null，再重复投递过期帧。
    // 输入数据：error_code=token_expired，refreshSession 结果为 null。
    // 预期行为：状态显示 token_expired，refreshSession 总共只调用一次。
    const socket = new MockWebSocket();
    const refreshSession = vi.fn().mockResolvedValue(null);
    const webSocketFactory = () => socket;
    const { result } = renderHook(() => useChatConnection({
      session: initialSession,
      refreshSession,
      webSocketFactory,
    }));

    await act(async () => {
      socket.receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "token_expired", message: "access token expired" },
      }));
    });
    await act(async () => {
      socket.receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "token_expired", message: "access token expired" },
      }));
    });

    expect(result.current.state).toMatchObject({ status: "auth_failed", errorCode: "token_expired" });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("stops the old heartbeat and starts a new one after token refresh reconnects", async () => {
    // 测试目标：验证 token 过期重连时旧 socket 的 heartbeat 停止，新 socket 认证后重新启动 heartbeat。
    // 构造方法：先让第一条 socket 认证并启动心跳，再注入 token_expired，刷新 session 后重渲染并认证第二条 socket。
    // 输入数据：旧连接收到 auth_failed token_expired，新 session 使用 new-access-token 和 ws://127.0.0.1:9002/ws。
    // 预期行为：旧 socket 发送数量不再增长，新 socket 在 auth_ok 后发送 heartbeat。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const sockets: MockWebSocket[] = [];
    let requestId = 0;
    const webSocketFactory = () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    };
    const requestIdFactory = () => `req-${requestId += 1}`;
    const refreshedSession: AuthSession = {
      userId: 20001,
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9002/ws",
      refreshTokenPersistence: "session_only",
    };
    const refreshSession = vi.fn().mockResolvedValueOnce(refreshedSession);
    const { rerender } = renderHook(
      ({ session }) => useChatConnection({
        session,
        refreshSession,
        webSocketFactory,
        requestIdFactory,
      }),
      { initialProps: { session: initialSession } },
    );

    act(() => {
      sockets[0].open();
      sockets[0].receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-1",
        payload: {
          user_id: 20001,
          connection_id: "old-connection",
          access_token_expires_at: "2026-08-16T12:15:00Z",
        },
      }));
    });
    const oldSentCount = sockets[0].sent.length;

    await act(async () => {
      sockets[0].receive(JSON.stringify({
        type: "auth_failed",
        payload: { error_code: "token_expired", message: "access token expired" },
      }));
    });
    rerender({ session: refreshedSession });
    expect(sockets).toHaveLength(2);
    act(() => {
      sockets[1].open();
      sockets[1].receive(JSON.stringify({
        type: "auth_ok",
        request_id: "req-3",
        payload: {
          user_id: 20001,
          connection_id: "new-connection",
          access_token_expires_at: "2026-08-16T12:30:00Z",
        },
      }));
      vi.advanceTimersByTime(10_000);
    });

    expect(refreshSession).toHaveBeenCalled();
    expect(sockets[0].sent).toHaveLength(oldSentCount);
    expect(JSON.parse(sockets[1].sent[0]).payload.access_token).toBe("new-access-token");
    expect(JSON.parse(sockets[1].sent[1])).toMatchObject({ type: "heartbeat" });
    expect(JSON.parse(sockets[1].sent[2])).toMatchObject({ type: "heartbeat" });
  });
});
