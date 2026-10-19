import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatConversation, ChatMessage, ChatReplyTarget } from "../types";
import { ChatPanel } from "./ChatPanel";

const { copyChatMessage } = vi.hoisted(() => ({ copyChatMessage: vi.fn(async () => undefined) }));
vi.mock("../messageClipboardApi", () => ({ copyChatMessage, readChatClipboardHtml: vi.fn(async () => null) }));
const original: ChatMessage = { localKey: "local:original", messageId: "original-id", conversationId: 42,
  conversationSeq: 1, senderUserId: 2, clientMessageId: "original-client", messageType: "text",
  content: { text: "原消息正文" }, createdAt: "2026-10-16T01:00:00Z", clientSentAt: "2026-10-16T01:00:00Z",
  localStatus: "accepted", displayTime: "09:00", showTime: false, showAvatar: true };
const target: ChatReplyTarget = { messageId: original.messageId!, senderUserId: 2, messageType: "text", content: original.content };
const answer: ChatMessage = { ...original, localKey: "reply-local", messageId: "reply-id", clientMessageId: "reply-client",
  conversationSeq: 2, senderUserId: 1, content: { text: "我的答复" }, replyToMessageId: target.messageId, replyTo: target };
const conversation: ChatConversation = { conversationId: 42, type: "direct", name: "对方", avatar: "对", tone: "blue",
  status: "在线", participants: { 2: { userId: 2, name: "小明", avatar: "明", tone: "blue" } }, messages: [original, answer] };
function Panel({ messages = conversation.messages }: { messages?: ChatMessage[] }) {
  const [replyTo, setReply] = useState<ChatReplyTarget | null>(null);
  return <ChatPanel conversation={{ ...conversation, messages }} self={{ userId: 1, account: "me", name: "我", avatar: "我", tone: "blue" }}
    connectionLabel="在线" draft="" canSend={false} statusMessage="" isHistoryLoading={false} historyError={null}
    hasMoreHistory={false} onLoadOlderHistory={vi.fn()} onRetryHistory={vi.fn()} isDetailOpen={false}
    onReturnToSessions={vi.fn()} onOpenDetail={vi.fn()} onToolPreview={vi.fn()} onSendText={vi.fn()} onRetryMessage={vi.fn()}
    replyTo={replyTo} onSelectReply={setReply} />;
}
describe("reply interactions", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("selects and cancels a reply from the message menu", async () => {
    // 测试目标：验证菜单回复显示原作者和摘要，取消后移除状态条。
    // 构造方法：右键正式消息选择回复，再点击取消。
    // 输入数据：用户小明的“原消息正文”。
    // 预期行为：状态条包含作者与原文；取消后移除，编辑器仍可用。
    render(<Panel />);
    fireEvent.contextMenu(screen.getByText("原消息正文"));
    await userEvent.click(screen.getByRole("menuitem", { name: "回复" }));
    const banner = screen.getByRole("group", { name: "回复消息" });
    expect(within(banner).getByText("回复 小明")).toBeInTheDocument();
    expect(within(banner).getByText("原消息正文")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消回复" }));
    expect(screen.queryByRole("group", { name: "回复消息" })).not.toBeInTheDocument();
  });
  it("locates an optimistic local key by the formal target id", async () => {
    // 测试目标：验证正式 ID 与 localKey 不同时仍能定位。
    // 构造方法：渲染本地 key=local:original 的原消息，点击引用条。
    // 输入数据：引用 original-id，作者小明。
    // 预期行为：引用显示正确且原消息行高亮。
    render(<Panel />);
    expect(screen.getByText("回复 小明：原消息正文")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "定位被回复消息" }));
    expect(screen.getByText("原消息正文").closest("article")).toHaveClass("is-reply-target");
  });
  it("shows a hint when the original message has not been loaded", async () => {
    // 测试目标：验证页外引用显示原文，定位给出提示。
    // 构造方法：仅渲染包含浅层引用的答复，点击引用条。
    // 输入数据：列表无 original-id，replyTo 包含其正文。
    // 预期行为：引用可见，出现加载更早记录提示。
    render(<Panel messages={[answer]} />);
    await userEvent.click(screen.getByRole("button", { name: "定位被回复消息" }));
    expect(screen.getByText("原消息尚未加载，请先加载更早记录")).toBeInTheDocument();
  });
  it("copies the selected body independently of its rendered quote", async () => {
    // 测试目标：验证复制取消息模型，不拼入引用条 DOM 文字。
    // 构造方法：右键回复气泡正文并选择复制。
    // 输入数据：本次正文“我的答复”，引用正文“原消息正文”。
    // 预期行为：复制 API 的 content 只有本次正文，菜单关闭。
    render(<Panel />);
    fireEvent.contextMenu(screen.getByText("我的答复"));
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(copyChatMessage).toHaveBeenCalledWith(expect.objectContaining({ content: { text: "我的答复" } }), expect.anything(), expect.anything());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
