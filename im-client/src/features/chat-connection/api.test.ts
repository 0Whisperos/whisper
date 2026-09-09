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

  it("sends an authenticated text message with a fresh request id", () => {
    // 测试目标：验证认证完成后的文本消息按协议编码，并为这次发送生成新的 request_id。
    // 构造方法：使用顺序 requestIdFactory 建立并认证测试 socket，再调用 controller 的发送方法。
    // 输入数据：conversationId=10001、clientMessageId=client-message-1、text="hello"、clientSentAt 为带时区时间。
    // 预期行为：第三个发送帧是 send_message，完整保留业务字段且 request_id 不复用认证和心跳 ID。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const requestIds = ["req-auth", "req-heartbeat", "req-message"];
    const controller = connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => socket,
      requestIdFactory: () => requestIds.shift() ?? "req-extra",
    });
    authenticateSocket(socket);

    controller.sendTextMessage({
      clientMessageId: "client-message-1",
      conversationId: 10001,
      text: "hello",
      clientSentAt: "2026-08-16T12:00:00.000+08:00",
    });

    expect(JSON.parse(socket.sent[2])).toEqual({
      type: "send_message",
      request_id: "req-message",
      payload: {
        client_message_id: "client-message-1",
        conversation_id: 10001,
        message_type: "text",
        content: { text: "hello" },
        client_sent_at: "2026-08-16T12:00:00.000+08:00",
      },
    });
  });

  it("rejects sending messages until the socket is authenticated and open", () => {
    // 测试目标：验证业务消息不会在认证前或 socket 已关闭时被写入 WebSocket。
    // 构造方法：分别对刚创建的 controller 和认证后主动关闭的 controller 调用发送方法。
    // 输入数据：两次均使用 conversationId=10001、clientMessageId=client-message-1 和文本 "hello"。
    // 预期行为：两次调用均抛出连接未认证错误，且发送数组中没有 send_message 帧。
    const beforeAuthSocket = new MockWebSocket();
    const beforeAuthController = connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => beforeAuthSocket,
      requestIdFactory: () => "req-1",
    });
    const input = {
      clientMessageId: "client-message-1",
      conversationId: 10001,
      text: "hello",
      clientSentAt: "2026-08-16T12:00:00.000+08:00",
    };

    expect(() => beforeAuthController.sendTextMessage(input)).toThrow("not authenticated");

    const closedSocket = new MockWebSocket();
    const closedController = connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      webSocketFactory: () => closedSocket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(closedSocket);
    closedController.close();

    expect(() => closedController.sendTextMessage(input)).toThrow("not authenticated");
    expect(beforeAuthSocket.sent).not.toContainEqual(expect.stringContaining("send_message"));
    expect(closedSocket.sent).not.toContainEqual(expect.stringContaining("send_message"));
  });

  it("forwards every valid authenticated business frame to the typed callback", () => {
    // 测试目标：验证 accepted、rejected 和 message_created 三类业务帧都会交给聊天数据层。
    // 构造方法：认证 socket 后依次注入三种符合协议的服务端 JSON 帧，并观察 onServerFrame。
    // 输入数据：client_message_id=client-message-1，正式消息 message_id=message-1，事件 event_id=event-1。
    // 预期行为：回调按接收顺序获得三个原始且类型正确的业务帧，连接保持打开。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onServerFrame = vi.fn();
    connectChatWebSocket({
      session: testSession,
      onStateChange: vi.fn(),
      onServerFrame,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);
    const message = {
      message_id: "message-1",
      conversation_id: 10001,
      conversation_seq: 42,
      sender_user_id: 20001,
      client_message_id: "client-message-1",
      message_type: "text",
      content: { text: "hello" },
      created_at: "2026-08-16T12:00:01.123+08:00",
    };

    socket.receive(JSON.stringify({
      type: "server_accepted",
      request_id: "req-message",
      payload: { client_message_id: "client-message-1", message },
    }));
    socket.receive(JSON.stringify({
      type: "send_message_rejected",
      request_id: "req-rejected",
      payload: { client_message_id: "client-message-1", error_code: "invalid_message", message: "invalid" },
    }));
    socket.receive(JSON.stringify({
      type: "message_created",
      payload: { event_id: "event-1", message },
    }));

    expect(onServerFrame).toHaveBeenCalledTimes(3);
    expect(onServerFrame).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "server_accepted" }));
    expect(onServerFrame).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "send_message_rejected" }));
    expect(onServerFrame).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: "message_created" }));
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("rejects server_accepted when its envelope and message client ids disagree", () => {
    // 测试目标：验证请求关联字段不一致的 accepted 帧不能被当作合法确认处理。
    // 构造方法：认证测试 socket 后注入外层和内层 client_message_id 不同的 server_accepted JSON。
    // 输入数据：外层 client_message_id=client-1，内层 client_message_id=client-2。
    // 预期行为：连接报告非法服务端帧并关闭，业务帧回调不被调用。
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onStateChange = vi.fn();
    const onServerFrame = vi.fn();
    connectChatWebSocket({
      session: testSession,
      onStateChange,
      onServerFrame,
      webSocketFactory: () => socket,
      requestIdFactory: () => "req-1",
    });
    authenticateSocket(socket);

    socket.receive(JSON.stringify({
      type: "server_accepted",
      request_id: "req-message",
      payload: {
        client_message_id: "client-1",
        message: {
          message_id: "message-1",
          conversation_id: 10001,
          conversation_seq: 42,
          sender_user_id: 20001,
          client_message_id: "client-2",
          message_type: "text",
          content: { text: "hello" },
          created_at: "2026-08-16T12:00:01.123+08:00",
        },
      },
    }));

    expect(onStateChange).toHaveBeenCalledWith({ status: "error", message: "invalid chat server frame" });
    expect(onServerFrame).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("closes an authenticated connection for an unknown server frame", () => {
    // 测试目标：验证认证后仍严格拒绝未声明的服务端帧，避免静默忽略协议不兼容。
    // 构造方法：完成认证并启动心跳后，向测试 socket 注入 type=unknown_frame 的 JSON。
    // 输入数据：未知 type="unknown_frame" 和空 payload。
    // 预期行为：状态变为 invalid chat server frame，socket 被关闭且不再继续发送心跳。
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

    socket.receive(JSON.stringify({ type: "unknown_frame", payload: {} }));
    vi.advanceTimersByTime(10_000);

    expect(onStateChange).toHaveBeenCalledWith({ status: "error", message: "invalid chat server frame" });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.sent).toHaveLength(sentCount);
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
