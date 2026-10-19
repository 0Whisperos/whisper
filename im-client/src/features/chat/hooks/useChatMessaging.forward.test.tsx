import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatServerAcceptedFrame } from "../../chat-connection/types";
import type { ChatData } from "../types";
import { chatMockData } from "../mockData";
import { useChatMessaging } from "./useChatMessaging";

const TARGET = 10005;
const SOURCE = 10002;
const CLIENT_ID = "d6f93190-eef3-4f94-899a-1ef9ce853ba0";

function fixture() {
  const sendTextMessage = vi.fn();
  const sendRichMessage = vi.fn();
  const initial = structuredClone(chatMockData);
  initial.conversations[TARGET].messages = [];
  const hook = renderHook(() => {
    const [data, setData] = useState<ChatData>(initial);
    const messaging = useChatMessaging({ data, updateData: (update) => setData((current) => update(current) ?? current),
      sendTextMessage, sendRichMessage, clientMessageIdFactory: () => CLIENT_ID,
      now: () => new Date("2026-10-19T01:02:03Z") });
    return { data, messaging };
  });
  return { ...hook, sendTextMessage, sendRichMessage, initial };
}

function acceptance(): ChatServerAcceptedFrame {
  return { type: "server_accepted", request_id: "forward-request", payload: {
    client_message_id: CLIENT_ID, message: { message_id: "official-forward", conversation_id: TARGET,
      conversation_seq: 1, sender_user_id: 20001, client_message_id: CLIENT_ID, message_type: "text",
      content: { text: "  原文\n " }, created_at: "2026-10-19T09:02:04+08:00" },
  } };
}

describe("forward message submission", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates a tracked text copy without trimming or inheriting a reply", () => {
    // 测试目标：验证转发文字按原样发送，拥有新消息身份且不带引用关系。
    // 构造方法：挂载真实消息 hook，将正文转发到空目标会话，并保存源会话快照。
    // 输入数据：会话 10005、正文“  原文\n ”，当前用户 20001。
    // 预期行为：返回固定新 client ID，pending 与 transport 正文不变、引用为空，源会话不变。
    const { result, sendTextMessage, initial } = fixture();
    act(() => expect(result.current.messaging.forward(TARGET, { messageType: "text", content: { text: "  原文\n " } })).toBe(CLIENT_ID));
    expect(sendTextMessage).toHaveBeenCalledExactlyOnceWith({ clientMessageId: CLIENT_ID, conversationId: TARGET,
      text: "  原文\n ", clientSentAt: "2026-10-19T01:02:03.000Z" });
    const message = result.current.data.conversations[TARGET].messages[0];
    expect(message).toMatchObject({ senderUserId: 20001, messageId: null, localStatus: "sending", content: { text: "  原文\n " } });
    expect(message.replyToMessageId).toBeUndefined();
    expect(message.replyTo).toBeUndefined();
    expect(result.current.data.conversations[SOURCE]).toEqual(initial.conversations[SOURCE]);
  });

  it("submits rich blocks in order with only destination attachments", () => {
    // 测试目标：验证图文转发保留块顺序并只发送正式附件字段。
    // 构造方法：向消息 hook 提交已上传的目标图文副本，包含不应对外传输的预览 URL。
    // 输入数据：文字“前”、目标附件 target-image、文字“后”及 blob:source 预览。
    // 预期行为：新消息保序，transport 和本地转发消息均无源预览或引用元数据。
    const { result, sendRichMessage } = fixture();
    act(() => result.current.messaging.forward(TARGET, { messageType: "rich", content: { blocks: [
      { type: "text", text: "前" }, { type: "image", attachment_id: "target-image", previewUrl: "blob:source" }, { type: "text", text: "后" },
    ] } }));
    const blocks = [{ type: "text", text: "前" }, { type: "image", attachment_id: "target-image" }, { type: "text", text: "后" }];
    expect(sendRichMessage).toHaveBeenCalledExactlyOnceWith({ clientMessageId: CLIENT_ID, conversationId: TARGET,
      blocks, clientSentAt: "2026-10-19T01:02:03.000Z" });
    expect(result.current.data.conversations[TARGET].messages[0].content).toEqual({ blocks });
  });

  it("retries a rejected forward using its original client ID and body", () => {
    // 测试目标：验证转发被服务端拒绝后复用同一幂等键和正文重试。
    // 构造方法：发送文字转发、注入 send_message_rejected，再调用既有 retry。
    // 输入数据：固定 client ID、正文“原文”以及 not_conversation_member 拒绝码。
    // 预期行为：两次发送参数完全相同，目标只有一条消息且恢复 sending 状态。
    const { result, sendTextMessage } = fixture();
    act(() => result.current.messaging.forward(TARGET, { messageType: "text", content: { text: "原文" } }));
    act(() => result.current.messaging.handleSendMessageRejected({ type: "send_message_rejected", request_id: "reject", payload: {
      client_message_id: CLIENT_ID, error_code: "not_conversation_member", message: "unavailable",
    } }));
    expect(result.current.data.conversations[TARGET].messages[0].localStatus).toBe("failed");
    act(() => expect(result.current.messaging.retry(CLIENT_ID)).toBe(true));
    expect(sendTextMessage.mock.calls[1]).toEqual(sendTextMessage.mock.calls[0]);
    expect(result.current.data.conversations[TARGET].messages).toHaveLength(1);
    expect(result.current.data.conversations[TARGET].messages[0].localStatus).toBe("sending");
  });

  it("merges a late confirmation after timeout without duplicating the copy", () => {
    // 测试目标：验证超时的转发在晚到确认后仍收敛为唯一正式消息。
    // 构造方法：发送转发、推进默认 15 秒确认计时器，再注入两次相同成功确认。
    // 输入数据：带空格正文、固定 client ID 及 official-forward 消息 ID。
    // 预期行为：超时暂为 failed，确认后只有一条 accepted 消息，正文和本地稳定键保留。
    const { result } = fixture();
    act(() => result.current.messaging.forward(TARGET, { messageType: "text", content: { text: "  原文\n " } }));
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.data.conversations[TARGET].messages[0]).toMatchObject({ localStatus: "failed", errorCode: "acknowledgement_timeout" });
    act(() => { result.current.messaging.handleServerAccepted(acceptance()); result.current.messaging.handleServerAccepted(acceptance()); });
    expect(result.current.data.conversations[TARGET].messages).toHaveLength(1);
    expect(result.current.data.conversations[TARGET].messages[0]).toMatchObject({ localKey: `local:${CLIENT_ID}`,
      messageId: "official-forward", localStatus: "accepted", content: { text: "  原文\n " } });
  });

  it("keeps a local failed message when the transport throws", () => {
    // 测试目标：验证转发传输异常时仍可按返回的 client ID 追踪和重试。
    // 构造方法：令文字 transport 同步抛错，再从转发入口提交。
    // 输入数据：目标会话 10005 与正文“原文”。
    // 预期行为：返回 client ID 并保留 send_failed 消息，不伪装成未提交或成功。
    const { result, sendTextMessage } = fixture();
    sendTextMessage.mockImplementation(() => { throw new Error("disconnected"); });
    act(() => expect(result.current.messaging.forward(TARGET, { messageType: "text", content: { text: "原文" } })).toBe(CLIENT_ID));
    expect(result.current.data.conversations[TARGET].messages[0]).toMatchObject({ localStatus: "failed", errorCode: "send_failed" });
  });

  it("rejects unsupported destinations and blank bodies without a pending message", () => {
    // 测试目标：验证不支持的转发目标与空白文字不会进入发送链路。
    // 构造方法：分别向群聊、助手、未知会话及有效会话提交非法转发。
    // 输入数据：群聊 10003、助手 10001、未知 99999，以及仅空白的正文。
    // 预期行为：均返回 null，两个 transport 没有调用，目标会话仍为空。
    const { result, sendTextMessage, sendRichMessage } = fixture();
    act(() => {
      expect(result.current.messaging.forward(10003, { messageType: "text", content: { text: "原文" } })).toBeNull();
      expect(result.current.messaging.forward(10001, { messageType: "text", content: { text: "原文" } })).toBeNull();
      expect(result.current.messaging.forward(99999, { messageType: "text", content: { text: "原文" } })).toBeNull();
      expect(result.current.messaging.forward(TARGET, { messageType: "text", content: { text: " \n " } })).toBeNull();
    });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendRichMessage).not.toHaveBeenCalled();
    expect(result.current.data.conversations[TARGET].messages).toHaveLength(0);
  });
});
