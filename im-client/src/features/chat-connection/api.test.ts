import { describe, expect, it, vi } from "vitest";

import { connectChatWebSocket } from "./api";
import type { ChatWebSocket } from "./types";

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

describe("chat connection API", () => {
  it("sends auth as the first frame after the socket opens", () => {
    // 测试目标：验证 WebSocket open 后客户端立即发送文档约定的 auth 首帧。
    // 构造方法：注入可观察的 WebSocket 测试替身和固定 requestIdFactory。
    // 输入数据：session.accessToken 为 jwt-access-token，request_id 为 req-1。
    // 预期行为：socket.send 收到 type=auth 且 payload.access_token 正确。
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();

    connectChatWebSocket({
      session: {
        userId: 20001,
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
        refreshTokenPersistence: "session_only",
      },
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    socket.open();

    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "auth",
      request_id: "req-1",
      payload: { access_token: "jwt-access-token" },
    });
    expect(onStateChange).toHaveBeenCalledWith({ status: "authenticating", requestId: "req-1" });
  });

  it("maps auth_ok into the authenticated state", () => {
    // 测试目标：验证服务端 auth_ok 会转换为客户端 authenticated 状态。
    // 构造方法：建立连接后向测试 socket 注入 auth_ok 文本帧。
    // 输入数据：user_id=20001，connection_id=connection-uuid。
    // 预期行为：onStateChange 收到 authenticated 状态和服务端返回字段。
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    connectChatWebSocket({
      session: {
        userId: 20001,
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
        refreshTokenPersistence: "session_only",
      },
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });

    socket.receive(JSON.stringify({
      type: "auth_ok",
      request_id: "req-1",
      payload: {
        user_id: 20001,
        connection_id: "connection-uuid",
        access_token_expires_at: "2026-08-16T12:15:00+08:00",
      },
    }));

    expect(onStateChange).toHaveBeenCalledWith({
      status: "authenticated",
      userId: 20001,
      connectionId: "connection-uuid",
      accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
    });
  });

  it("maps auth_failed into a branchable auth_failed state", () => {
    // 测试目标：验证服务端 auth_failed 的稳定错误码会暴露给业务分支。
    // 构造方法：建立连接后注入 token_expired 的 auth_failed 文本帧。
    // 输入数据：error_code=token_expired，message=access token expired。
    // 预期行为：onStateChange 收到 auth_failed 状态，socket 被关闭。
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    connectChatWebSocket({
      session: {
        userId: 20001,
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
        refreshTokenPersistence: "session_only",
      },
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });

    socket.receive(JSON.stringify({
      type: "auth_failed",
      request_id: "req-1",
      payload: {
        error_code: "token_expired",
        message: "access token expired",
      },
    }));

    expect(onStateChange).toHaveBeenCalledWith({
      status: "auth_failed",
      errorCode: "token_expired",
      message: "access token expired",
    });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
