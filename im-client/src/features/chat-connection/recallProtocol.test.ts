import { afterEach, describe, expect, it, vi } from "vitest";
import { connectChatWebSocket } from "./api";
import type { ChatWebSocket } from "./types";
class Socket implements ChatWebSocket {
  sent: string[] = []; readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null; onclose: ((event: CloseEvent) => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = WebSocket.CLOSED; }
  receive(value: unknown) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
}
const state = { message_id: "m", conversation_id: 42, conversation_seq: 1, sender_user_id: 1, recalled_at: "2026-10-23T09:00:00Z" };
function fixture() {
  const socket = new Socket(); const onServerFrame = vi.fn(); const onStateChange = vi.fn();
  const controller = connectChatWebSocket({ session: { userId: 1, accessToken: "t", refreshToken: "r",
    accessTokenExpiresAt: "2099-01-01", imChatWsUrl: "ws://chat", refreshTokenPersistence: "session_only" },
    webSocketFactory: () => socket, onServerFrame, onStateChange });
  socket.readyState = WebSocket.OPEN; socket.onopen?.(new Event("open"));
  socket.receive({ type: "auth_ok", request_id: "auth", payload: { user_id: 1, connection_id: "c", access_token_expires_at: "2099-01-01" } });
  return { socket, controller, onServerFrame, onStateChange };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("recall WebSocket contract", () => {
  it("sends one narrow recall frame and parses accepted, rejected and push states", () => {
    // 测试目标：验证撤回传输格式与三类业务响应不会关闭连接。
    // 构造方法：认证替身socket，发撤回并依次注入成功、无message_id失败和主动通知。
    // 输入数据：消息m、request_id=req、完整状态字段和event_id=e。
    // 预期行为：发送仅message_id；三帧均转交业务hook，socket保持OPEN。
    vi.useFakeTimers(); const value = fixture(); value.controller.sendRecallMessage("m", "req");
    expect(JSON.parse(value.socket.sent.at(-1)!)).toEqual({ type: "recall_message", request_id: "req", payload: { message_id: "m" } });
    const frames = [{ type: "recall_message_accepted", request_id: "req", payload: state },
      { type: "recall_message_rejected", request_id: "req", payload: { error_code: "invalid_message_id", message: "invalid" } },
      { type: "message_recalled", payload: { ...state, event_id: "e" } }];
    frames.forEach((frame) => value.socket.receive(frame));
    expect(value.onServerFrame.mock.calls.map((call) => call[0])).toEqual(frames);
    expect(value.socket.readyState).toBe(WebSocket.OPEN);
  });
  it.each([null, "invalid", 3])("rejects malformed terminal recall time %j", (recalled_at) => {
    // 测试目标：验证不完整或非法撤回终态不会进入客户端状态合并。
    // 构造方法：向已认证socket发送有缺陷的message_recalled。
    // 输入数据：recalled_at分别为null、无效日期及数字。
    // 预期行为：解析失败关闭连接，业务回调不接收该事件。
    vi.useFakeTimers(); const value = fixture();
    value.socket.receive({ type: "message_recalled", payload: { ...state, event_id: "e", recalled_at } });
    expect(value.onServerFrame).not.toHaveBeenCalled(); expect(value.socket.readyState).toBe(WebSocket.CLOSED);
  });
  it("preserves recalled body and quoted target structures on message creation", () => {
    // 测试目标：验证创建协议保留content原结构与引用撤回字段，兼容缺失撤回字段。
    // 构造方法：发送带正文/引用recalled_at的创建帧，再发送不带新字段的旧帧。
    // 输入数据：m原文、引用q原文及有效撤回时间。
    // 预期行为：两帧均通过，正文和引用原文不被清除。
    vi.useFakeTimers(); const value = fixture();
    const message = { ...state, client_message_id: "cm", message_type: "text", content: { text: "原文" }, created_at: "2020-01-01",
      reply_to_message_id: "q", reply_to: { message_id: "q", sender_user_id: 2, message_type: "text", content: { text: "引用原文" }, recalled_at: state.recalled_at } };
    value.socket.receive({ type: "message_created", payload: { event_id: "e", message } });
    const { recalled_at: _recalled, ...legacy } = message;
    value.socket.receive({ type: "message_created", payload: { event_id: "e2", message: legacy } });
    expect(value.onServerFrame).toHaveBeenCalledTimes(2);
    expect(value.onServerFrame.mock.calls[0][0].payload.message).toEqual(message);
  });
});
