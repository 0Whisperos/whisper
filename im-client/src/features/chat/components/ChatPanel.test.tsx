import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation, ChatMessage, ChatSelfProfile } from "../types";
import { ChatPanel } from "./ChatPanel";

let intersectionCallback: IntersectionObserverCallback | null = null;

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0.5];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function createMessage(): ChatMessage {
  return {
    localKey: "message-9",
    messageId: "message-9",
    conversationId: 42,
    conversationSeq: 9,
    senderUserId: 20002,
    clientMessageId: "client-9",
    messageType: "text",
    content: { text: "你好" },
    createdAt: "2026-08-30T08:00:00.000Z",
    clientSentAt: "2026-08-30T08:00:00.000Z",
    localStatus: "accepted",
    displayTime: "08:00",
    showTime: true,
    showAvatar: true,
  };
}

describe("ChatPanel read visibility", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    intersectionCallback = null;
  });

  it("reports the highest visible conversation sequence", () => {
    // 测试目标：验证消息进入聊天列表可视区域时会报告其 conversation_seq，供 read_ack 推进。
    // 构造方法：用可触发回调的 IntersectionObserver 替身渲染单条已接收消息，再模拟其进入可见区域。
    // 输入数据：conversation_id=42，消息 conversation_seq=9，intersectionRatio 达到观察阈值。
    // 预期行为：onReadThrough 收到会话 42 和序号 9。
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver as unknown as typeof IntersectionObserver);
    const conversation: ChatConversation = {
      conversationId: 42,
      type: "direct",
      name: "周然",
      avatar: "周",
      tone: "orange",
      status: "在线",
      participants: { 20002: { userId: 20002, name: "周然", avatar: "周", tone: "orange" } },
      messages: [createMessage()],
    };
    const self: ChatSelfProfile = { userId: 20001, account: "linxiao", name: "林晓", avatar: "林", tone: "blue" };
    const onReadThrough = vi.fn();
    const { container } = render(
      <ChatPanel
        conversation={conversation}
        self={self}
        connectionLabel="在线"
        draft=""
        canSend={false}
        statusMessage=""
        isHistoryLoading={false}
        historyError={null}
        onRetryHistory={vi.fn()}
        isDetailOpen={false}
        onReturnToSessions={vi.fn()}
        onOpenDetail={vi.fn()}
        onToolPreview={vi.fn()}
        onChangeDraft={vi.fn()}
        onSendText={vi.fn()}
        onRetryMessage={vi.fn()}
        onReadThrough={onReadThrough}
      />,
    );

    const message = container.querySelector<HTMLElement>('[data-conversation-seq="9"]');
    expect(message).not.toBeNull();
    act(() => {
      intersectionCallback?.([{ target: message!, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(onReadThrough).toHaveBeenCalledWith(42, 9);
  });
});
