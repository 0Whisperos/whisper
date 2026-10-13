import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation, ChatMessage, ChatSelfProfile } from "../types";
import { formatHoverMessageTime } from "../hooks/messageTimeline";
import { ChatPanel } from "./ChatPanel";
import * as attachmentsApi from "../attachmentsApi";

let intersectionCallback: IntersectionObserverCallback | null = null;

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this);
  }
}

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

function createPeerMessage(sequence: number): ChatMessage {
  return {
    ...createMessage(),
    localKey: `message-${sequence}`,
    messageId: `message-${sequence}`,
    conversationSeq: sequence,
    clientMessageId: `client-${sequence}`,
    content: { text: `消息 ${sequence}` },
  };
}

function createConversation(messages: ChatMessage[], readSeq = 0): ChatConversation {
  return {
    conversationId: 42,
    type: "direct",
    name: "周然",
    avatar: "周",
    tone: "orange",
    status: "在线",
    participants: { 20002: { userId: 20002, name: "周然", avatar: "周", tone: "orange" } },
    messages,
    readSeq,
  };
}

const testSelf: ChatSelfProfile = { userId: 20001, account: "linxiao", name: "林晓", avatar: "林", tone: "blue" };

function renderChatPanel(
  conversation: ChatConversation,
  onReadThrough = vi.fn(),
) {
  return render(chatPanelElement(conversation, onReadThrough));
}

function chatPanelElement(conversation: ChatConversation, onReadThrough = vi.fn(), isHistoryLoading = false) {
  return (
    <ChatPanel
      conversation={conversation}
      self={testSelf}
      connectionLabel="在线"
      draft=""
      canSend={false}
      statusMessage=""
      isHistoryLoading={isHistoryLoading}
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
      apiBaseUrl="https://api.test"
      accessToken="test-token"
    />
  );
}

function setListScrollMetrics(list: HTMLElement, messageHeight = 100, clientHeight = 100) {
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    get: () => list.querySelectorAll("[data-message-key]").length * messageHeight,
  });
  Object.defineProperty(list, "clientHeight", { configurable: true, value: clientHeight });
}

describe("ChatPanel read visibility", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    intersectionCallback = null;
    TestResizeObserver.instances = [];
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

  it("follows a new incoming message when the list was already at the bottom", () => {
    // 测试目标：验证用户正在看最新消息时，对方发来新消息会自动跟随到底部。
    // 构造方法：渲染一条已读消息，设置列表尺寸并将滚动位置置于底部后，再追加一条对方消息。
    // 输入数据：原消息序号 9 且 readSeq=9，新消息序号 10。
    // 预期行为：新消息插入后列表滚动位置更新为最新内容的底部。
    const initial = createConversation([createPeerMessage(9)], 9);
    const { container, rerender } = renderChatPanel(initial);
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    setListScrollMetrics(list);
    list.scrollTop = 0;
    fireEvent.scroll(list);

    rerender(chatPanelElement(createConversation([createPeerMessage(9), createPeerMessage(10)], 9)));

    expect(list.scrollTop).toBe(200);
  });

  it("preserves a history position and shows the count of unread incoming messages", async () => {
    // 测试目标：验证浏览历史时收到对方消息不会打断阅读，并显示当前已加载的未读条数。
    // 构造方法：渲染四条已读消息，将列表滚到中间并模拟滚动，再连续追加两条对方消息。
    // 输入数据：readSeq=9，新增对方消息序号 10 和 11。
    // 预期行为：滚动位置保持不变，向下按钮显示两条未读。
    const initialMessages = [6, 7, 8, 9].map(createPeerMessage);
    const initial = createConversation(initialMessages, 9);
    const { container, rerender } = renderChatPanel(initial);
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    setListScrollMetrics(list);
    list.scrollTop = 100;
    fireEvent.scroll(list);

    const firstIncoming = createConversation([...initialMessages, createPeerMessage(10)], 9);
    rerender(chatPanelElement(firstIncoming));
    expect(list.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "跳转到最新消息，1 条未读" })).toBeInTheDocument();

    rerender(chatPanelElement(createConversation([...initialMessages, createPeerMessage(10), createPeerMessage(11)], 9)));
    expect(list.scrollTop).toBe(100);
    const jumpButton = screen.getByRole("button", { name: "跳转到最新消息，2 条未读" });
    expect(jumpButton).toBeInTheDocument();
    expect(jumpButton.querySelectorAll("svg path")).toHaveLength(2);
    expect(jumpButton).toHaveTextContent("2");
  });

  it("jumps to the bottom from the unread button and reports visible messages as read", async () => {
    // 测试目标：验证点击未读提示会定位到最新消息，最新消息可见后仍通过现有回调推进已读游标。
    // 构造方法：安装 IntersectionObserver 替身，浏览历史时追加对方消息，点击按钮并触发最新消息的可见回调。
    // 输入数据：readSeq=9，新增对方消息序号 10。
    // 预期行为：列表定位到底部，按钮消失，onReadThrough 收到会话 42 和序号 10。
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver as unknown as typeof IntersectionObserver);
    const initialMessages = [6, 7, 8, 9].map(createPeerMessage);
    const onReadThrough = vi.fn();
    const { container, rerender } = renderChatPanel(createConversation(initialMessages, 9), onReadThrough);
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    setListScrollMetrics(list);
    list.scrollTop = 100;
    fireEvent.scroll(list);

    rerender(chatPanelElement(createConversation([...initialMessages, createPeerMessage(10)], 9), onReadThrough));

    await userEvent.click(screen.getByRole("button", { name: "跳转到最新消息，1 条未读" }));
    expect(list.scrollTop).toBe(500);
    expect(screen.queryByRole("button", { name: "跳转到最新消息，1 条未读" })).not.toBeInTheDocument();

    const latestMessage = container.querySelector<HTMLElement>('[data-conversation-seq="10"]')!;
    act(() => {
      intersectionCallback?.([{ target: latestMessage, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(onReadThrough).toHaveBeenCalledWith(42, 10);
  });

  it("always follows the bottom when the user sends a message from history", () => {
    // 测试目标：验证用户正在浏览历史时发送自己的消息仍会定位到最新消息。
    // 构造方法：渲染四条对方消息并将列表滚到中间，然后在时间线末尾加入本地发送中的消息。
    // 输入数据：已有消息序号 6 到 9，自己的新消息 clientMessageId 为 client-self-1。
    // 预期行为：列表滚动到包含自己新消息的底部。
    const initialMessages = [6, 7, 8, 9].map(createPeerMessage);
    const { container, rerender } = renderChatPanel(createConversation(initialMessages, 9));
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    setListScrollMetrics(list);
    list.scrollTop = 100;
    fireEvent.scroll(list);

    const ownMessage: ChatMessage = {
      ...createPeerMessage(10),
      localKey: "local:client-self-1",
      messageId: null,
      conversationSeq: null,
      senderUserId: testSelf.userId,
      clientMessageId: "client-self-1",
      content: { text: "我发出的消息" },
      createdAt: null,
      localStatus: "sending",
    };
    rerender(chatPanelElement(createConversation([...initialMessages, ownMessage], 9)));

    expect(list.scrollTop).toBe(500);
    expect(screen.getByText("我发出的消息")).toBeInTheDocument();
  });

  it("scrolls to the latest message when initial history finishes even if the latest message is unchanged", () => {
    // 测试目标：验证首屏已有缓存消息时，即使历史请求只补充旧页且最新消息 key 未变化，历史加载完成仍会贴底。
    // 构造方法：以 isHistoryLoading=true 渲染序号 9 的已有消息，设置列表尺寸后仅把加载状态切换为 false。
    // 输入数据：会话 42 已有最新消息 seq=9，scrollHeight=100、clientHeight=40，初始位置在列表顶部。
    // 预期行为：历史加载完成后 scrollTop 被定位到最新消息的底部。
    const conversation = createConversation([createPeerMessage(9)]);
    const { container, rerender } = render(chatPanelElement(conversation, vi.fn(), true));
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 100 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 40 });
    list.scrollTop = 0;

    rerender(chatPanelElement(conversation, vi.fn(), false));

    expect(list.scrollTop).toBe(100);
  });

  it("keeps the latest image layout at bottom but preserves a position the user scrolled to", async () => {
    // 测试目标：验证多图布局变化或图片失败时仅在用户仍贴底的情况下继续滚动到底部。
    // 构造方法：安装 ResizeObserver 替身渲染含两张图片的 rich 消息，模拟图片增高、加载失败及用户上滑后的再次增高。
    // 输入数据：会话 42 的 seq=9 含两张图片；列表高度依次为 200、300、400，clientHeight=100，失败后用户滚至 50。
    // 预期行为：贴底时尺寸变为 300 或图片失败均保持在底部；用户上滑后尺寸变为 400，scrollTop 仍为 50。
    vi.stubGlobal("ResizeObserver", TestResizeObserver as unknown as typeof ResizeObserver);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:chat-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const downloadAuth = vi.spyOn(attachmentsApi, "requestDownloadAuthorizations").mockImplementation(async (_url, _token, _conversation, ids) => ids.map((attachment_id) => ({
      attachment_id, download_url: `https://cdn.test/${attachment_id}`, expires_at: "later", content_type: "image/png", size_bytes: 12,
    })));
    vi.spyOn(attachmentsApi, "fetchSignedImage").mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    const richMessage: ChatMessage = {
      ...createPeerMessage(9),
      messageType: "rich",
      content: { blocks: [
        { type: "text", text: "图片说明" },
        { type: "image", attachment_id: "image-one", previewUrl: "blob:image-one" },
        { type: "image", attachment_id: "image-two", previewUrl: "blob:image-two" },
      ] },
    };
    const { container } = renderChatPanel(createConversation([richMessage]));
    const list = container.querySelector<HTMLElement>(".auth-message-list")!;
    await waitFor(() => expect(downloadAuth).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector(".auth-message-image")).not.toBeNull());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let contentHeight = 200;
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => contentHeight });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 100 });
    list.scrollTop = 200;
    fireEvent.scroll(list);

    contentHeight = 300;
    act(() => TestResizeObserver.instances.forEach((observer) => observer.trigger()));
    expect(list.scrollTop).toBe(300);

    fireEvent.error(container.querySelector<HTMLImageElement>(".auth-message-image")!);
    await waitFor(() => expect(downloadAuth).toHaveBeenCalledTimes(2));
    expect(list.scrollTop).toBe(300);

    list.scrollTop = 50;
    fireEvent.scroll(list);
    contentHeight = 400;
    act(() => TestResizeObserver.instances.forEach((observer) => observer.trigger()));
    expect(list.scrollTop).toBe(50);
  });

  it("renders ordered rich blocks inside one shared message bubble", async () => {
    // 测试目标：验证富文本消息中的文字和图片按 block 顺序共享同一个气泡容器。
    // 构造方法：替身下载授权请求后渲染 text/image/text/image 四个连续 block 的已接受消息。
    // 输入数据：文字“图片前”“图片间”“图片后”与两张图片按此顺序排列。
    // 预期行为：一个可访问的富文本消息组包含全部文字和图片占位，子块顺序不变且不存在嵌套文字气泡。
    vi.spyOn(attachmentsApi, "requestDownloadAuthorizations").mockResolvedValue([]);
    const richMessage: ChatMessage = {
      ...createPeerMessage(9),
      messageType: "rich",
      content: { blocks: [
        { type: "text", text: "图片前" },
        { type: "image", attachment_id: "image-one" },
        { type: "text", text: "图片间" },
        { type: "image", attachment_id: "image-two" },
        { type: "text", text: "图片后" },
      ] },
    };
    render(<ChatPanel {...{
      conversation: createConversation([richMessage]), self: testSelf, connectionLabel: "在线", draft: "", canSend: false,
      statusMessage: "", isHistoryLoading: false, historyError: null, hasMoreHistory: false,
      onLoadOlderHistory: vi.fn(), onRetryHistory: vi.fn(), isDetailOpen: false, onReturnToSessions: vi.fn(),
      onOpenDetail: vi.fn(), onToolPreview: vi.fn(), onChangeDraft: vi.fn(), onSendText: vi.fn(), onRetryMessage: vi.fn(),
      apiBaseUrl: "https://api.test", accessToken: "token",
    }} />);

    const bubble = screen.getByRole("group", { name: "富文本消息" });
    const textNodes = [within(bubble).getByText("图片前"), within(bubble).getByText("图片间"), within(bubble).getByText("图片后")];
    const imageNodes = within(bubble).getAllByRole("img", { name: "图片加载中" });
    const blockNodes = Array.from(bubble.querySelector(".auth-rich-message-blocks")!.children);

    await waitFor(() => expect(attachmentsApi.requestDownloadAuthorizations).toHaveBeenCalledWith(
      "https://api.test", "token", 42, ["image-one", "image-two"],
    ));
    expect(bubble).toHaveClass("auth-message-bubble", "auth-rich-message-bubble");
    expect(textNodes.every((node) => bubble.contains(node))).toBe(true);
    expect(imageNodes).toHaveLength(2);
    expect(blockNodes.map((node) => node.tagName.toLowerCase())).toEqual(["p", "span", "p", "span", "p"]);
    expect(bubble.querySelectorAll(".auth-message-bubble")).toHaveLength(0);
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

describe("ChatPanel attachment authorization", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requests downloads only for accepted messages and excludes optimistic local images", async () => {
    // 测试目标：验证本地 sending 消息的 uploaded 附件不会进入下载授权批次，避免未关联附件导致整批拒绝。
    // 构造方法：渲染一条服务端 accepted rich 图片消息和一条带本地预览的 sending rich 图片消息，并替身下载授权 API。
    // 输入数据：正式附件 ID 为 attached-image，本地待发附件 ID 为 uploaded-image。
    // 预期行为：下载授权只收到正式消息的 attached-image，不请求 uploaded-image。
    const downloadAuth = vi.spyOn(attachmentsApi, "requestDownloadAuthorizations").mockResolvedValue([]);
    const official: ChatMessage = {
      ...createMessage(),
      messageId: "message-rich",
      messageType: "rich",
      content: { blocks: [{ type: "image", attachment_id: "attached-image" }] },
    };
    const optimistic: ChatMessage = {
      ...createMessage(),
      localKey: "local:pending-rich",
      messageId: null,
      clientMessageId: "pending-rich",
      conversationSeq: null,
      messageType: "rich",
      localStatus: "sending",
      content: { blocks: [{ type: "image", attachment_id: "uploaded-image", previewUrl: "blob:local-preview" }] },
    };
    render(<ChatPanel {...{
      conversation: createConversation([official, optimistic]), self: testSelf, connectionLabel: "在线", draft: "", canSend: false,
      statusMessage: "", isHistoryLoading: false, historyError: null, hasMoreHistory: false,
      onLoadOlderHistory: vi.fn(), onRetryHistory: vi.fn(), isDetailOpen: false, onReturnToSessions: vi.fn(),
      onOpenDetail: vi.fn(), onToolPreview: vi.fn(), onChangeDraft: vi.fn(), onSendText: vi.fn(), onRetryMessage: vi.fn(),
      apiBaseUrl: "https://api.test", accessToken: "token",
    }} />);

    await waitFor(() => expect(downloadAuth).toHaveBeenCalledWith("https://api.test", "token", 42, ["attached-image"]));
    expect(downloadAuth).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 42, expect.arrayContaining(["uploaded-image"]));
  });

  it("shows a retry control when an image fails both its initial load and automatic recovery", async () => {
    // 测试目标：验证图片初次显示后解码失败且一次自动恢复也失败时，界面展示可操作的失败提示。
    // 构造方法：渲染一条正式图片消息，让首次签名图片下载成功、自动恢复下载失败，再触发 img error。
    // 输入数据：附件 broken-image；第一次 fetchSignedImage 返回 PNG Blob，恢复请求抛出网络错误。
    // 预期行为：自动恢复失败后移除已损坏的 img，显示“图片加载失败”和“重试图片”按钮。
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:broken-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(attachmentsApi, "requestDownloadAuthorizations").mockImplementation(async (_url, _token, _conversation, ids) => ids.map((attachment_id) => ({
      attachment_id, download_url: `https://cdn.test/${attachment_id}`, expires_at: "later", content_type: "image/png", size_bytes: 12,
    })));
    vi.spyOn(attachmentsApi, "fetchSignedImage")
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))
      .mockRejectedValueOnce(new Error("download_failed"));
    const message: ChatMessage = {
      ...createMessage(),
      messageId: "message-broken-image",
      messageType: "rich",
      content: { blocks: [{ type: "image", attachment_id: "broken-image" }] },
    };
    const { container } = renderChatPanel(createConversation([message]));

    const image = await screen.findByRole("img", { name: "聊天图片" });
    fireEvent.error(image);

    expect(await screen.findByRole("group", { name: "图片加载失败" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试图片" })).toBeInTheDocument();
    expect(container.querySelector(".auth-message-image")).toBeNull();
  });
});
