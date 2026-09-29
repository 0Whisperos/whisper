import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation, ChatMessage, ChatSelfProfile } from "../types";
import { formatHoverMessageTime } from "../hooks/messageTimeline";
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
        hasMoreHistory={false}
        onLoadOlderHistory={vi.fn()}
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

  it("loads older messages near the top and keeps the visible message anchored", () => {
    // 测试目标：验证列表接近顶部时触发旧页加载，前置消息后当前可见消息仍处于相同视口位置。
    // 构造方法：渲染一条最新消息，模拟可控的列表/消息几何位置，触发 scroll，再重渲染加入更早消息。
    // 输入数据：scrollTop=10、顶部阈值内；旧消息序号 8 前置到当前序号 9 之前。
    // 预期行为：加载回调触发一次，序号 9 消息相对列表顶部的偏移保持不变。
    const recent = createMessage();
    const older: ChatMessage = {
      ...recent,
      localKey: "message-8",
      messageId: "message-8",
      conversationSeq: 8,
      clientMessageId: "client-8",
      content: { text: "更早消息" },
    };
    const conversation: ChatConversation = {
      conversationId: 42,
      type: "direct",
      name: "周然",
      avatar: "周",
      tone: "orange",
      status: "在线",
      participants: { 20002: { userId: 20002, name: "周然", avatar: "周", tone: "orange" } },
      messages: [recent],
    };
    const self: ChatSelfProfile = { userId: 20001, account: "linxiao", name: "林晓", avatar: "林", tone: "blue" };
    const onLoadOlderHistory = vi.fn();
    const { container, rerender } = render(
      <ChatPanel
        conversation={conversation}
        self={self}
        connectionLabel="在线"
        draft=""
        canSend={false}
        statusMessage=""
        isHistoryLoading={false}
        historyError={null}
        hasMoreHistory
        onLoadOlderHistory={onLoadOlderHistory}
        onRetryHistory={vi.fn()}
        isDetailOpen={false}
        onReturnToSessions={vi.fn()}
        onOpenDetail={vi.fn()}
        onToolPreview={vi.fn()}
        onChangeDraft={vi.fn()}
        onSendText={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    );

    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => list.querySelectorAll("[data-message-key]").length * 100,
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 300, left: 0, right: 300, width: 300, height: 200, x: 0, y: 100, toJSON: () => ({}) });
    const messageTop = (message: HTMLElement) => {
      const index = Array.from(list.querySelectorAll<HTMLElement>("[data-message-key]")).indexOf(message);
      return 100 + index * 100 + 40 - list.scrollTop;
    };
    container.querySelectorAll<HTMLElement>("[data-message-key]").forEach((message) => {
      vi.spyOn(message, "getBoundingClientRect").mockImplementation(() => {
        const top = messageTop(message);
        return { top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) };
      });
    });

    list.scrollTop = 10;
    const recentMessage = container.querySelector<HTMLElement>('[data-message-key="message-9"]')!;
    const originalOffset = recentMessage.getBoundingClientRect().top - list.getBoundingClientRect().top;
    fireEvent.scroll(list);
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);

    rerender(
      <ChatPanel
        conversation={{ ...conversation, messages: [older, recent] }}
        self={self}
        connectionLabel="在线"
        draft=""
        canSend={false}
        statusMessage=""
        isHistoryLoading
        historyError={null}
        hasMoreHistory
        onLoadOlderHistory={onLoadOlderHistory}
        onRetryHistory={vi.fn()}
        isDetailOpen={false}
        onReturnToSessions={vi.fn()}
        onOpenDetail={vi.fn()}
        onToolPreview={vi.fn()}
        onChangeDraft={vi.fn()}
        onSendText={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    );

    const anchoredMessage = container.querySelector<HTMLElement>('[data-message-key="message-9"]')!;
    expect(anchoredMessage.getBoundingClientRect().top - list.getBoundingClientRect().top).toBe(originalOffset);
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
  });

  it("shows contextual time above group starts and side times for compact messages", async () => {
    // 测试目标：验证组首完整时间位于气泡上方，组内后续时间分别位于左右气泡外侧且不覆盖前条消息。
    // 构造方法：渲染对方和自己的短间隔消息组，悬浮各组首与后续气泡，再移出当前消息。
    // 输入数据：四条消息时间依次为今天 08:00、08:03、08:04 和 08:05，发送者按对方、自己分组。
    // 预期行为：组首显示带秒的上下文时间，组内消息只显示时分秒；左/右方向正确，移出后标签隐藏，悬浮不替换气泡或改变行类名。
    const user = userEvent.setup();
    const todayAt = (minute: number) => new Date(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8, minute, 0,
    ).toISOString();
    const first: ChatMessage = {
      ...createMessage(),
      createdAt: null,
      clientSentAt: todayAt(0),
    };
    const second: ChatMessage = {
      ...first,
      localKey: "message-10",
      messageId: "message-10",
      conversationSeq: 10,
      clientMessageId: "client-10",
      content: { text: "第二条消息" },
      createdAt: todayAt(3),
      clientSentAt: todayAt(3),
      displayTime: "08:03",
      showTime: false,
    };
    const selfFirst: ChatMessage = {
      ...second,
      localKey: "message-11",
      messageId: "message-11",
      conversationSeq: 11,
      senderUserId: 20001,
      clientMessageId: "client-11",
      content: { text: "自己的第一条" },
      createdAt: todayAt(4),
      clientSentAt: todayAt(4),
      showTime: false,
    };
    const selfSecond: ChatMessage = {
      ...selfFirst,
      localKey: "message-12",
      messageId: "message-12",
      conversationSeq: 12,
      clientMessageId: "client-12",
      content: { text: "自己的第二条" },
      createdAt: todayAt(5),
      clientSentAt: todayAt(5),
    };
    const conversation: ChatConversation = {
      conversationId: 42,
      type: "direct",
      name: "周然",
      avatar: "周",
      tone: "orange",
      status: "在线",
      participants: { 20002: { userId: 20002, name: "周然", avatar: "周", tone: "orange" } },
      messages: [first, second, selfFirst, selfSecond],
    };
    const self: ChatSelfProfile = { userId: 20001, account: "linxiao", name: "林晓", avatar: "林", tone: "blue" };

    render(
      <ChatPanel
        conversation={conversation}
        self={self}
        connectionLabel="在线"
        draft=""
        canSend={false}
        statusMessage=""
        isHistoryLoading={false}
        historyError={null}
        hasMoreHistory={false}
        onLoadOlderHistory={vi.fn()}
        onRetryHistory={vi.fn()}
        isDetailOpen={false}
        onReturnToSessions={vi.fn()}
        onOpenDetail={vi.fn()}
        onToolPreview={vi.fn()}
        onChangeDraft={vi.fn()}
        onSendText={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    );

    const firstTimestamp = formatHoverMessageTime(first.createdAt ?? first.clientSentAt, true)!;
    const secondTimestamp = formatHoverMessageTime(second.createdAt!, false)!;
    const selfFirstTimestamp = formatHoverMessageTime(selfFirst.createdAt!, true)!;
    const selfSecondTimestamp = formatHoverMessageTime(selfSecond.createdAt!, false)!;
    const secondRow = screen.getByText("第二条消息").closest("article");
    const firstRow = screen.getByText("你好").closest("article");
    const selfFirstRow = screen.getByText("自己的第一条").closest("article");
    const selfSecondRow = screen.getByText("自己的第二条").closest("article");
    const secondBubble = screen.getByText("第二条消息").closest(".auth-message-bubble-line");
    const firstBubble = screen.getByText("你好").closest(".auth-message-bubble-line");
    const selfFirstBubble = screen.getByText("自己的第一条").closest(".auth-message-bubble-line");
    const selfSecondBubble = screen.getByText("自己的第二条").closest(".auth-message-bubble-line");
    const firstRowClass = firstRow?.className;
    const firstBubbleElement = firstBubble?.querySelector(".auth-message-bubble");

    expect(secondRow).toHaveClass("compact");
    expect(firstRow).not.toHaveClass("compact");
    expect(selfFirstRow).not.toHaveClass("compact");
    expect(selfSecondRow).toHaveClass("compact");
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.queryByText(firstTimestamp)).not.toBeInTheDocument();
    expect(screen.queryByText(secondTimestamp)).not.toBeInTheDocument();
    await user.hover(secondBubble!);
    expect(screen.getByText(secondTimestamp)).toHaveClass("auth-message-side-time", "left");
    expect(screen.getByText(secondTimestamp).parentElement).toHaveClass("auth-message-bubble-line");
    expect(screen.queryByText(firstTimestamp)).not.toBeInTheDocument();

    await user.hover(firstBubble!);
    expect(screen.getByText(firstTimestamp)).toHaveClass("auth-message-hover-time");
    expect(screen.getByText(firstTimestamp).parentElement).toHaveClass("auth-message-bubble-wrap");
    expect(screen.getByText(firstTimestamp).nextElementSibling).toHaveClass("auth-message-bubble");
    expect(screen.getByText("你好").closest("article")).toHaveClass(firstRowClass!);
    expect(firstBubble?.querySelector(".auth-message-bubble")).toBe(firstBubbleElement);
    expect(screen.queryByText(secondTimestamp)).not.toBeInTheDocument();
    await user.unhover(firstBubble!);
    expect(screen.queryByText(firstTimestamp)).not.toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();

    await user.hover(selfSecondBubble!);
    expect(screen.getByText(selfSecondTimestamp)).toHaveClass("auth-message-side-time", "right");
    expect(screen.queryByText(selfFirstTimestamp)).not.toBeInTheDocument();
    await user.hover(selfFirstBubble!);
    expect(screen.getByText(selfFirstTimestamp)).toHaveClass("auth-message-hover-time");
    expect(screen.queryByText(selfSecondTimestamp)).not.toBeInTheDocument();
  });
});
