import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatMessageCreatedFrame,
  ChatSendMessageRejectedFrame,
  ChatServerAcceptedFrame,
} from "../../chat-connection/types";
import type { ChatData } from "../types";
import { useChatMessaging } from "./useChatMessaging";

const sentMessages: Array<{ clientMessageId: string; conversationId: number; text: string; clientSentAt: string }> = [];

function createData(): ChatData {
  return {
    self: { userId: 20001, account: "linxiao", name: "林晓", avatar: "林", tone: "blue" },
    sessions: [{ id: "conversation-42", conversationId: 42, name: "周然", avatar: "周", tone: "orange", type: "direct", preview: "暂无消息", time: "" }],
    conversations: {
      42: {
        conversationId: 42,
        type: "direct",
        name: "周然",
        avatar: "周",
        tone: "orange",
        status: "在线",
        participants: { 20002: { userId: 20002, name: "周然", avatar: "周", tone: "orange" } },
        messages: [],
      },
    },
    contacts: [],
    contactSections: [],
  };
}

function acceptedFrame(clientMessageId: string, sequence = 7): ChatServerAcceptedFrame {
  return {
    type: "server_accepted",
    request_id: "request-1",
    payload: {
      client_message_id: clientMessageId,
      message: {
        message_id: `message-${sequence}`,
        conversation_id: 42,
        conversation_seq: sequence,
        sender_user_id: 20001,
        client_message_id: clientMessageId,
        message_type: "text",
        content: { text: "你好" },
        created_at: "2026-08-30T08:00:01.000Z",
      },
    },
  };
}

function createdFrame(clientMessageId: string, sequence = 7, senderUserId = 20001): ChatMessageCreatedFrame {
  return {
    type: "message_created",
    payload: {
      event_id: `event-${sequence}`,
      message: { ...acceptedFrame(clientMessageId, sequence).payload.message, sender_user_id: senderUserId },
    },
  };
}

function rejectedFrame(clientMessageId: string): ChatSendMessageRejectedFrame {
  return {
    type: "send_message_rejected",
    request_id: "request-1",
    payload: { client_message_id: clientMessageId, error_code: "not_conversation_member", message: "not a member" },
  };
}

function renderMessaging(options: {
  send?: (input: { clientMessageId: string; conversationId: number; text: string; clientSentAt: string }) => void;
  initialData?: ChatData;
} = {}) {
  return renderHook(() => {
    const [data, setData] = useState(() => options.initialData ?? createData());
    const messaging = useChatMessaging({
      data,
      updateData: (updater) => setData((current) => updater(current) ?? current),
      sendTextMessage: options.send ?? ((input) => { sentMessages.push(input); }),
      clientMessageIdFactory: () => "client-7",
      now: () => new Date("2026-08-30T08:00:00.000Z"),
    });
    return { data, messaging };
  });
}

describe("useChatMessaging", () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("optimistically adds a trimmed sending message and updates the session preview", () => {
    // 测试目标：验证发送文本会立即添加本地 sending 气泡，而无需等待服务端回执。
    // 构造方法：挂载包含空会话的消息状态 hook，并注入可观察的发送 transport。
    // 输入数据：会话 42 与带首尾空格的文本 "  你好  "。
    // 预期行为：时间线只有一个保留 client_message_id 的 sending 消息，transport 和会话预览均使用裁剪后的文本。
    const { result } = renderMessaging();

    act(() => { expect(result.current.messaging.send(42, "  你好  ")).toBe(true); });

    const message = result.current.data.conversations[42].messages[0];
    expect(message).toMatchObject({ localKey: "local:client-7", clientMessageId: "client-7", messageId: null, localStatus: "sending", content: { text: "你好" } });
    expect(sentMessages).toEqual([{ clientMessageId: "client-7", conversationId: 42, text: "你好", clientSentAt: "2026-08-30T08:00:00.000Z" }]);
    expect(result.current.data.sessions[0]).toMatchObject({ preview: "你好" });
  });

  it("merges server acceptance into the existing local bubble", () => {
    // 测试目标：验证 server_accepted 按 client_message_id 原地补齐正式消息字段。
    // 构造方法：先发送一条本地消息，再将匹配的 server_accepted 帧交给 hook。
    // 输入数据：client_message_id=client-7，服务端 message_id=message-7、conversation_seq=7。
    // 预期行为：不增加气泡，localKey 保持稳定，消息变为 accepted 并拥有服务端 ID、序号和创建时间。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleServerAccepted(acceptedFrame("client-7")); });

    expect(result.current.data.conversations[42].messages).toHaveLength(1);
    expect(result.current.data.conversations[42].messages[0]).toMatchObject({ localKey: "local:client-7", messageId: "message-7", conversationSeq: 7, localStatus: "accepted" });
  });

  it("marks a rejected message as failed and retains it for retry", () => {
    // 测试目标：验证服务端拒绝不会删除本地气泡，而是提供可重试的失败状态。
    // 构造方法：先创建 sending 消息，再注入同一 client_message_id 的 send_message_rejected 帧。
    // 输入数据：error_code=not_conversation_member。
    // 预期行为：原气泡变为 failed 并暴露稳定错误码，不会产生第二条消息。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleSendMessageRejected(rejectedFrame("client-7")); });

    expect(result.current.data.conversations[42].messages).toEqual([expect.objectContaining({ localStatus: "failed", errorCode: "not_conversation_member" })]);
  });

  it("marks the local bubble as failed when the synchronous WebSocket send throws", () => {
    // 测试目标：验证 transport 在序列化或写入 socket 时同步失败也不会遗留无限 sending 状态。
    // 构造方法：挂载消息 hook，并注入会抛出异常的发送 transport 后发出一条文本。
    // 输入数据：会话 42、文本“你好”，以及 throw new Error 的 transport。
    // 预期行为：仍保留同一条本地气泡，但状态变为 failed 且错误码为 send_failed。
    const { result } = renderMessaging({ send: () => { throw new Error("socket send failed"); } });

    act(() => { expect(result.current.messaging.send(42, "你好")).toBe(true); });

    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ clientMessageId: "client-7", localStatus: "failed", errorCode: "send_failed" }),
    ]);
  });

  it("marks an unacknowledged message as failed after fifteen seconds", () => {
    // 测试目标：验证缺少任何正式回执时，15 秒确认超时会转为失败状态。
    // 构造方法：使用 fake timers 发送消息且不投递服务端帧，然后推进 15 秒。
    // 输入数据：client_message_id=client-7，确认等待时间为默认 15000ms。
    // 预期行为：本地消息从 sending 变为 failed，错误码为 acknowledgement_timeout。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { vi.advanceTimersByTime(15_000); });

    expect(result.current.data.conversations[42].messages[0]).toMatchObject({ localStatus: "failed", errorCode: "acknowledgement_timeout" });
  });

  it("retries a failed bubble with the original id and client timestamp", () => {
    // 测试目标：验证手动重试复用幂等 client_message_id 和原始 client_sent_at，而非新建气泡。
    // 构造方法：发送并拒绝消息，然后调用 retry；transport 会记录每次发送参数。
    // 输入数据：同一 client_message_id=client-7 的失败消息。
    // 预期行为：时间线仍只有一个 sending 气泡，第二次 transport 调用与第一次共享 ID 和时间戳。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleSendMessageRejected(rejectedFrame("client-7")); });
    act(() => { expect(result.current.messaging.retry("client-7")).toBe(true); });

    expect(result.current.data.conversations[42].messages).toEqual([expect.objectContaining({ localStatus: "sending", clientMessageId: "client-7" })]);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]).toEqual(sentMessages[0]);
  });

  it("merges message_created before acceptance and ignores its duplicate acceptance", () => {
    // 测试目标：验证发送方先收到 message_created 的乱序场景仍只展示一个正式气泡。
    // 构造方法：发送本地消息，先注入 message_created，再注入相同 message_id 的 server_accepted。
    // 输入数据：message_id=message-7、client_message_id=client-7 的两种正式帧。
    // 预期行为：第一帧合并本地消息，第二帧按 message_id 去重，最终仅保留序号 7 的 accepted 消息。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleServerFrame(createdFrame("client-7")); });
    act(() => { result.current.messaging.handleServerAccepted(acceptedFrame("client-7")); });

    expect(result.current.data.conversations[42].messages).toEqual([expect.objectContaining({ messageId: "message-7", conversationSeq: 7, localStatus: "accepted" })]);
  });

  it("ignores a duplicate message_created after server acceptance", () => {
    // 测试目标：验证先确认、后收到同一正式时间线事件时不会显示重复气泡。
    // 构造方法：先发送并注入 server_accepted，再注入具有相同 message_id 的 message_created。
    // 输入数据：message_id=message-7、client_message_id=client-7 的 accepted 与 created 帧。
    // 预期行为：时间线始终只有一条 accepted 消息，并保留同一个稳定 localKey。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleServerAccepted(acceptedFrame("client-7")); });
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7")); });

    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ localKey: "local:client-7", messageId: "message-7", localStatus: "accepted" }),
    ]);
  });

  it("displays another sender's message without acknowledging a colliding local id", () => {
    // 测试目标：验证他人实时事件正常展示，且不会覆盖或确认当前用户使用相同 ID 的临时气泡。
    // 构造方法：先创建 client-7 的本地 sending 消息，再注入发送者为 20002、但使用同一客户端 ID 的正式事件。
    // 输入数据：conversationId=42、client_message_id=client-7、sender_user_id=20002。
    // 预期行为：显示对方 accepted 消息，本地气泡保持 sending，15 秒后仍会确认超时。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7", 7, 20002)); });

    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ senderUserId: 20002, clientMessageId: "client-7", messageId: "message-7", localStatus: "accepted" }),
      expect.objectContaining({ senderUserId: 20001, clientMessageId: "client-7", messageId: null, localStatus: "sending" }),
    ]);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.data.conversations[42].messages[1]).toMatchObject({ localStatus: "failed", errorCode: "acknowledgement_timeout" });
    expect(result.current.data.conversations[42].messages[0].localStatus).toBe("accepted");
  });

  it("inserts a local bubble after an incoming message with the same client id", () => {
    // 测试目标：验证先收到他人消息后，同一 client_message_id 不会阻止本地临时消息创建。
    // 构造方法：注入对方正式事件，再发送己方消息，最后处理己方正式事件。
    // 输入数据：双方均使用 client-7，对方 message-7 与己方 message-8。
    // 预期行为：临时气泡独立存在并被己方正式事件合并，最终保留两个不同发送者的正式消息。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7", 7, 20002)); });
    act(() => { result.current.messaging.send(42, "我的消息"); });
    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ senderUserId: 20002, messageId: "message-7", localStatus: "accepted" }),
      expect.objectContaining({ senderUserId: 20001, messageId: null, localStatus: "sending", content: { text: "我的消息" } }),
    ]);
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7", 8)); });
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ senderUserId: 20002, messageId: "message-7", localStatus: "accepted" }),
      expect.objectContaining({ senderUserId: 20001, messageId: "message-8", localStatus: "accepted" }),
    ]);
  });

  it("deduplicates incoming messages and orders them by conversation sequence", () => {
    // 测试目标：验证对方消息重复投递和乱序到达时，时间线及会话预览正确。
    // 构造方法：先投递序号 9，再投递序号 7，最后重复序号 9 的正式事件。
    // 输入数据：对方 message-9 的文本为“最新消息”，message-7 为“你好”。
    // 预期行为：只有两条气泡且按 7、9 排序，会话预览仍是最新序号的文本。
    const { result } = renderMessaging();
    const newest = createdFrame("other-9", 9, 20002);
    newest.payload.message.content.text = "最新消息";
    act(() => { result.current.messaging.handleServerFrame(newest); });
    act(() => { result.current.messaging.handleServerFrame(createdFrame("other-7", 7, 20002)); });
    act(() => { result.current.messaging.handleServerFrame(newest); });
    expect(result.current.data.conversations[42].messages.map((message) => message.conversationSeq)).toEqual([7, 9]);
    expect(result.current.data.sessions[0].preview).toBe("最新消息");
  });

  it("clears the acknowledgement timer only for the sender's official event", () => {
    // 测试目标：验证己方正式事件清除确认计时器，即使后续收到他人同 ID 事件也不影响己方状态。
    // 构造方法：发送己方消息并处理正式事件，再投递对方同 client_message_id 消息并推进时间。
    // 输入数据：己方 message-7、对方 message-8，双方 client-7，推进 15000ms。
    // 预期行为：己方计时器已清除，双方消息均保持 accepted 且没有重复气泡。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.send(42, "你好"); });
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7")); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7", 8, 20002)); });
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.data.conversations[42].messages).toHaveLength(2);
    expect(result.current.data.conversations[42].messages.every((message) => message.localStatus === "accepted")).toBe(true);
  });

  it("never retries another sender's failed message", () => {
    // 测试目标：验证重试入口即使遇到他人的 failed 数据也不会以当前身份重发。
    // 构造方法：初始化带对方失败气泡的数据，再调用该 client_message_id 的 retry。
    // 输入数据：senderUserId=20002、clientMessageId=client-7、localStatus=failed。
    // 预期行为：retry 返回 false，不调用 transport，不更改消息且不启动确认计时器。
    const initialData = createData();
    initialData.conversations[42].messages.push({
      localKey: "other-failed", messageId: null, conversationId: 42, conversationSeq: null,
      senderUserId: 20002, clientMessageId: "client-7", messageType: "text", content: { text: "他人消息" },
      createdAt: null, clientSentAt: "2026-08-30T08:00:00.000Z", localStatus: "failed",
      errorCode: "send_failed", displayTime: "16:00", showTime: true, showAvatar: true,
    });
    const { result } = renderMessaging({ initialData });
    act(() => { expect(result.current.messaging.retry("client-7")).toBe(false); });
    expect(sentMessages).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.data.conversations[42].messages[0]).toMatchObject({ senderUserId: 20002, localStatus: "failed" });
  });

  it("retries only the local failed message when the other sender uses the same id", () => {
    // 测试目标：验证对方同 ID 正式消息不会遮蔽己方失败消息的重试，也不会被改为 sending。
    // 构造方法：先接收对方事件，发送己方消息并拒绝，再使用同一 ID 重试。
    // 输入数据：双方 client-7，对方文本“你好”、己方文本“我的消息”。
    // 预期行为：第二次 transport 只重发己方文本，对方消息仍 accepted，己方消息变为 sending。
    const { result } = renderMessaging();
    act(() => { result.current.messaging.handleMessageCreated(createdFrame("client-7", 7, 20002)); });
    act(() => { result.current.messaging.send(42, "我的消息"); });
    act(() => { result.current.messaging.handleSendMessageRejected(rejectedFrame("client-7")); });
    act(() => { expect(result.current.messaging.retry("client-7")).toBe(true); });
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1].text).toBe("我的消息");
    expect(result.current.data.conversations[42].messages).toEqual([
      expect.objectContaining({ senderUserId: 20002, localStatus: "accepted" }),
      expect.objectContaining({ senderUserId: 20001, localStatus: "sending" }),
    ]);
  });
});
