import { afterEach, describe, expect, it, vi } from "vitest";

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

const testSession = {
  userId: 20001,
  accessToken: "jwt-access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
  refreshTokenPersistence: "session_only" as const,
};

function authenticateSocket(socket: MockWebSocket) {
  socket.open();
  socket.receive(JSON.stringify({
    type: "auth_ok",
    request_id: "req-auth",
    payload: {
      user_id: 20001,
      connection_id: "connection-uuid",
      access_token_expires_at: "2026-08-16T12:15:00+08:00",
    },
  }));
}

describe("chat connection API", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("sends auth as the first frame after the socket opens", () => {
    // 测试目标：验证 WebSocket open 后客户端立即发送文档约定的 auth 首帧。
    // 构造方法：注入可观察的 WebSocket 测试替身和固定 requestIdFactory。
    // 输入数据：session.accessToken 为 jwt-access-token，request_id 为 req-1。
    // 预期行为：socket.send 收到 type=auth 且 payload.access_token 正确。
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();

    connectChatWebSocket({
      session: testSession,
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
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    connectChatWebSocket({
      session: testSession,
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
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
        ...testSession,
        accessToken: "expired-token",
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

  it("sends a heartbeat immediately after auth_ok with a fresh request id", () => {
    // 测试目标：验证认证成功后客户端立即发送第一包 heartbeat，且不复用 auth 的 request_id。
    // 构造方法：注入顺序 requestIdFactory，打开 socket 后注入 auth_ok，再检查发送队列。
    // 输入数据：auth request_id=req-auth，首个 heartbeat request_id=req-heartbeat-1。
    // 预期行为：第二个发送帧为 type=heartbeat，payload.sent_at 符合带毫秒和时区的扩展时间格式。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T04:00:00.123Z"));
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    const requestIds = ["req-auth", "req-heartbeat-1"];

    connectChatWebSocket({
      session: testSession,
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => requestIds.shift() ?? "req-extra",
    });

    authenticateSocket(socket);

    const heartbeat = JSON.parse(socket.sent[1]);
    expect(heartbeat).toMatchObject({
      type: "heartbeat",
      request_id: "req-heartbeat-1",
    });
    expect(heartbeat.request_id).not.toBe("req-auth");
    expect(heartbeat.payload.sent_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });

  it("continues sending heartbeat frames every ten seconds after authentication", () => {
    // 测试目标：验证 auth_ok 后客户端会按文档约定每 10s 继续发送 heartbeat。
    // 构造方法：启用 fake timers，认证成功后推进 10s，再读取发送队列。
    // 输入数据：request_id 顺序为 req-auth、req-heartbeat-1、req-heartbeat-2。
    // 预期行为：立即心跳和 10s 后心跳都被发送，并使用各自新的 request_id。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const requestIds = ["req-auth", "req-heartbeat-1", "req-heartbeat-2"];

    connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => socket,
      requestIdFactory: () => requestIds.shift() ?? "req-extra",
    });

    authenticateSocket(socket);
    vi.advanceTimersByTime(10_000);

    expect(JSON.parse(socket.sent[1])).toMatchObject({ type: "heartbeat", request_id: "req-heartbeat-1" });
    expect(JSON.parse(socket.sent[2])).toMatchObject({ type: "heartbeat", request_id: "req-heartbeat-2" });
  });

  it("keeps the socket open when heartbeat_ok is received", () => {
    // 测试目标：验证服务端 heartbeat_ok 只表示心跳响应，不会被误判为非法帧并关闭连接。
    // 构造方法：认证成功并发送首个 heartbeat 后，向 socket 注入 heartbeat_ok。
    // 输入数据：heartbeat_ok request_id=req-heartbeat-1，payload.sent_at 为服务端响应时间。
    // 预期行为：socket 保持 OPEN，onStateChange 不收到 invalid frame error。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    const requestIds = ["req-auth", "req-heartbeat-1"];

    connectChatWebSocket({
      session: testSession,
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => requestIds.shift() ?? "req-extra",
    });
    authenticateSocket(socket);

    socket.receive(JSON.stringify({
      type: "heartbeat_ok",
      request_id: "req-heartbeat-1",
      payload: { sent_at: "2026-08-16T12:00:00.100+08:00" },
    }));

    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(onStateChange).not.toHaveBeenCalledWith({ status: "error", message: "invalid chat server frame" });
  });

  it("rejects heartbeat_ok before authentication completes", () => {
    // 测试目标：验证认证完成前收到 heartbeat_ok 会被视为非法服务端帧。
    // 构造方法：建立连接但不注入 auth_ok，直接向 socket 注入 heartbeat_ok。
    // 输入数据：heartbeat_ok request_id=req-heartbeat-1，payload.sent_at 为服务端响应时间。
    // 预期行为：onStateChange 收到 invalid frame error，socket 被关闭。
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();

    connectChatWebSocket({
      session: testSession,
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    socket.open();

    socket.receive(JSON.stringify({
      type: "heartbeat_ok",
      request_id: "req-heartbeat-1",
      payload: { sent_at: "2026-08-16T12:00:00.100+08:00" },
    }));

    expect(onStateChange).toHaveBeenCalledWith({ status: "error", message: "invalid chat server frame" });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("stops heartbeat frames after the controller closes the socket", () => {
    // 测试目标：验证客户端主动关闭连接后会清理 heartbeat timer。
    // 构造方法：认证成功后记录发送数量，调用 controller.close，再推进 10s。
    // 输入数据：已认证 socket 和一次 controller.close 调用。
    // 预期行为：socket 关闭，发送队列长度不再增长。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const controller = connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);
    const sentCount = socket.sent.length;

    controller.close();
    vi.advanceTimersByTime(10_000);

    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.sent).toHaveLength(sentCount);
  });

  it("stops heartbeat frames when auth_failed closes an authenticated socket", () => {
    // 测试目标：验证已启动心跳后收到 auth_failed 时会关闭连接并停止 heartbeat timer。
    // 构造方法：认证成功启动心跳，再注入 auth_failed，随后推进 10s 检查发送队列。
    // 输入数据：auth_failed error_code=invalid_token。
    // 预期行为：socket 被关闭，后续 timer tick 不再发送 heartbeat。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);
    const sentCount = socket.sent.length;

    socket.receive(JSON.stringify({
      type: "auth_failed",
      request_id: "req-1",
      payload: { error_code: "invalid_token", message: "invalid access token" },
    }));
    vi.advanceTimersByTime(10_000);

    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.sent).toHaveLength(sentCount);
  });

  it("stops heartbeat frames when an invalid server frame closes the socket", () => {
    // 测试目标：验证非法服务端帧触发关闭时会同步清理 heartbeat timer。
    // 构造方法：认证成功启动心跳，注入无法解析的文本帧，再推进 10s。
    // 输入数据：服务端消息为 not-json。
    // 预期行为：socket 被关闭，发送队列长度不再增长。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);
    const sentCount = socket.sent.length;

    socket.receive("not-json");
    vi.advanceTimersByTime(10_000);

    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.sent).toHaveLength(sentCount);
  });

  it("stops heartbeat frames when the socket reports an error", () => {
    // 测试目标：验证 WebSocket error 进入错误状态时会停止 heartbeat timer。
    // 构造方法：认证成功启动心跳，触发 socket.onerror，再推进 10s 检查发送队列。
    // 输入数据：一个已认证 socket 的 error 事件。
    // 预期行为：onStateChange 收到 error，发送队列长度不再增长。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    connectChatWebSocket({
      session: testSession,
      onStateChange,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);
    const sentCount = socket.sent.length;

    socket.onerror?.(new Event("error"));
    vi.advanceTimersByTime(10_000);

    expect(onStateChange).toHaveBeenCalledWith({ status: "error", message: "chat connection error" });
    expect(socket.sent).toHaveLength(sentCount);
  });
});
