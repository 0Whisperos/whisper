import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentResourceCache } from "../attachmentResourceCache";
import type { AttachmentCacheAdapter } from "../attachmentCacheApi";
import type { ChatConversation, ChatMessage } from "../types";
import { ChatPanel } from "./ChatPanel";

const { openViewer, copyImage, saveImage, copyMessage } = vi.hoisted(() => ({ openViewer: vi.fn(), copyImage: vi.fn(), saveImage: vi.fn(), copyMessage: vi.fn() }));
vi.mock("../messageClipboardApi", () => ({ copyChatMessage: copyMessage, readChatClipboardHtml: vi.fn(async () => null) }));
vi.mock("../../image-viewer/api", () => ({ copyImage, saveImage }));
vi.mock("../../image-viewer/coordinator", () => ({ imageViewerCoordinator: { open: openViewer } }));

const official: ChatMessage = {
  localKey: "image-message", messageId: "message-1", conversationId: 42, conversationSeq: 1, senderUserId: 2,
  clientMessageId: "client-1", messageType: "rich", createdAt: "2026-10-15T01:00:00Z", clientSentAt: "2026-10-15T01:00:00Z",
  localStatus: "accepted", displayTime: "09:00", showTime: false, showAvatar: true,
  content: { blocks: [{ type: "image", attachment_id: "image-1" }, { type: "text", text: "\n" },
    { type: "image", attachment_id: "image-2" }, { type: "text", text: "正文" }] },
};

function fixture(messages: ChatMessage[] = [official], conversationId = 42) {
  const adapter: AttachmentCacheAdapter = {
    isDesktop: () => true,
    lookup: vi.fn(async (_key, ids: string[]) => ids.map((attachmentId) => ({ attachmentId, filePath: `C:/cache/${attachmentId}.png` }))),
    download: vi.fn(async () => []), invalidate: vi.fn(async () => undefined), toAssetUrl: (path) => `asset://${path}`,
  };
  const cache = new AttachmentResourceCache(adapter);
  const conversation: ChatConversation = { conversationId, type: "direct", name: "对方", avatar: "对", tone: "blue", status: "在线",
    participants: { 2: { userId: 2, name: "对方", avatar: "对", tone: "blue" } }, messages };
  const props = { conversation, self: { userId: 1, account: "me", name: "我", avatar: "我", tone: "blue" as const },
    connectionLabel: "在线", draft: "", canSend: false, statusMessage: "", isHistoryLoading: false, historyError: null,
    hasMoreHistory: false, onLoadOlderHistory: vi.fn(), onRetryHistory: vi.fn(), isDetailOpen: false, onReturnToSessions: vi.fn(),
    onOpenDetail: vi.fn(), onToolPreview: vi.fn(), onSendText: vi.fn(), onRetryMessage: vi.fn(), onSelectReply: vi.fn(), onForwardMessage: vi.fn(),
    apiBaseUrl: "https://api.test", accessToken: "token", attachmentResourceCache: cache };
  return { cache, adapter, props };
}

describe("chat image and message interactions", () => {
  beforeEach(() => { openViewer.mockReset().mockResolvedValue(undefined); copyImage.mockReset().mockResolvedValue(undefined);
    saveImage.mockReset().mockResolvedValue({ saved: true }); copyMessage.mockReset().mockResolvedValue(undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("forwards an accepted message through its own action without changing the reply", async () => {
    // 测试目标：验证正式消息转发菜单调用独立回调，不改动回复草稿。
    // 构造方法：渲染正式富文本消息，在正文右键菜单选择转发。
    // 输入数据：accepted 的 message-1，正文包含图文 blocks。
    // 预期行为：传递完整源消息一次，菜单关闭，回复与发送回调均不触发。
    const { props } = fixture(); render(<ChatPanel {...props} />);
    await screen.findAllByRole("img", { name: "聊天图片" });
    fireEvent.contextMenu(screen.getByText("正文"));
    await userEvent.click(screen.getByRole("menuitem", { name: "转发" }));
    expect(props.onForwardMessage).toHaveBeenCalledExactlyOnceWith(official, expect.any(Function));
    expect(props.onSelectReply).not.toHaveBeenCalled(); expect(props.onSendText).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("enables image actions only after load and uses the original block index", async () => {
    // 测试目标：验证图片真正加载完成后才可放大查看，且显示层省略空文字不会改变查看器图片 ID。
    // 构造方法：渲染 image/newline/image 消息，在第二张图片 load 前后分别点击，再触发 error。
    // 输入数据：message-1 原始 block index=2 的 image-2；主窗口缓存返回 asset URL。
    // 预期行为：load 前无交互；load 后使用 message-1:2 打开一次；error 后立即恢复非交互。
    const { props, cache } = fixture(); render(<ChatPanel {...props} />);
    const images = await screen.findAllByRole("img", { name: "聊天图片" });
    fireEvent.click(images[1]); expect(openViewer).not.toHaveBeenCalled(); expect(images[1]).not.toHaveClass("is-interactive");
    fireEvent.load(images[1]); expect(images[1]).toHaveClass("is-interactive");
    await userEvent.click(images[1]);
    expect(openViewer).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 42 }), props.conversation, "message-1:2", cache);
    fireEvent.error(images[1]); expect(images[1]).not.toHaveClass("is-interactive");
    fireEvent.click(images[1]); expect(openViewer).toHaveBeenCalledTimes(1);
  });

  it("keeps image menus exclusive and selects a real reply target", async () => {
    // 测试目标：验证图片右键优先且只有两项，气泡菜单回复传递真实目标。
    // 构造方法：先右击未加载图片，再加载图片并右击，随后右击文字并选择回复。
    // 输入数据：正式对方消息中的聊天图片和文字“正文”。
    // 预期行为：图片菜单独占；选择回复后菜单关闭并传递原消息正文。
    const { props } = fixture(); render(<ChatPanel {...props} />);
    const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0];
    fireEvent.contextMenu(image); expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.load(image); fireEvent.contextMenu(image, { clientX: 100, clientY: 90 });
    const imageMenu = screen.getByRole("menu", { name: "图片菜单" });
    expect(within(imageMenu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制", "下载原图"]);
    expect(screen.queryByRole("menu", { name: "消息菜单" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("正文"));
    const messageMenu = screen.getByRole("menu", { name: "消息菜单" });
    expect(within(messageMenu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制", "回复", "转发"]);
    await userEvent.click(within(messageMenu).getByRole("menuitem", { name: "回复" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(props.onSelectReply).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-1", content: official.content }));
  });

  it.each(["sending", "failed"] as const)("copies %s messages and their preview images without requiring acceptance", async (localStatus) => {
    // 测试目标：验证 sending 和 failed 图片均可复制，但不能回复或下载。
    // 构造方法：以当前表项状态渲染本人临时 rich 消息，加载预览图片后分别右击图片与文字。
    // 输入数据：messageId=null、previewUrl=blob:preview，状态为 sending 或 failed。
    // 预期行为：图片不启用放大，但有复制菜单；文字菜单也只允许复制。
    const pending: ChatMessage = { ...official, senderUserId: 1, messageId: null, conversationSeq: null, localStatus,
      content: { blocks: [{ type: "image", attachment_id: "local-image", previewUrl: "blob:preview" }, { type: "text", text: "待发" }] } };
    render(<ChatPanel {...fixture([pending]).props} />);
    const image = screen.getByRole("img", { name: "聊天图片" }); fireEvent.load(image); fireEvent.contextMenu(image);
    expect(image).not.toHaveClass("is-interactive"); expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(copyMessage).toHaveBeenCalledWith(expect.objectContaining({ content: { blocks: [{ type: "image", attachment_id: "local-image", previewUrl: "blob:preview" }] } }), expect.anything(), expect.anything());
    fireEvent.contextMenu(screen.getByText("待发")); expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制"]);
  });

  it("offers recall only for an accepted own message and dismisses menus on conversation changes", async () => {
    // 测试目标：验证本人正式消息具有撤回占位菜单，切换会话后清理菜单。
    // 构造方法：渲染本人 accepted 消息右击文字，随后把 props 的会话 ID 更换。
    // 输入数据：senderUserId=1、messageId=message-1；会话 42 切到 43。
    // 预期行为：包含撤回菜单项，切换会话后菜单不存在。
    const { props } = fixture([{ ...official, senderUserId: 1 }]); const { rerender } = render(<ChatPanel {...props} />);
    fireEvent.contextMenu(screen.getByText("正文")); expect(screen.getByRole("menuitem", { name: "撤回" })).toBeInTheDocument();
    rerender(<ChatPanel {...props} conversation={{ ...props.conversation, conversationId: 43 }} />);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("dismisses pending menus after acknowledgement so they cannot read a released local preview", async () => {
    // 测试目标：验证确认消息替换临时预览时，不允许菜单继续使用旧 Blob。
    // 构造方法：给 sending 消息打开菜单，再在相同 localKey 上替换为 accepted。
    // 输入数据：messageId=null 的本地消息，以及正式 message-1 确认。
    // 预期行为：确认后菜单自动关闭，不调用旧消息的复制操作。
    const { props } = fixture([{ ...official, messageId: null, localStatus: "sending" }]);
    const { rerender } = render(<ChatPanel {...props} />);
    fireEvent.contextMenu(screen.getByText("正文"));
    expect(screen.getByRole("menu", { name: "消息菜单" })).toBeInTheDocument();
    rerender(<ChatPanel {...props} conversation={{ ...props.conversation, messages: [official] }} />);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(copyMessage).not.toHaveBeenCalled();
  });

  it("copies and saves the logical image target and reports failures without a success claim", async () => {
    // 测试目标：验证图片操作使用附件逻辑键、用户取消保存静默结束，复制失败可见。
    // 构造方法：加载图片后依次点击复制、下载，再令下一次复制拒绝并重试菜单操作。
    // 输入数据：会话 42、用户 1、image-1；saveImage 返回 saved=false，copyImage 最后抛出 clipboard_unavailable。
    // 预期行为：API 收到 chat target；取消保存无错误；复制拒绝后显示“复制失败，请重试”。
    saveImage.mockResolvedValueOnce({ saved: false }); render(<ChatPanel {...fixture().props} />);
    const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0]; fireEvent.load(image);
    fireEvent.contextMenu(image); await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    const target = { kind: "chat", apiBaseUrl: "https://api.test", userId: 1, conversationId: 42, attachmentId: "image-1" };
    await waitFor(() => expect(copyImage).toHaveBeenCalledWith(target));
    fireEvent.contextMenu(image); await userEvent.click(screen.getByRole("menuitem", { name: "下载原图" }));
    await waitFor(() => expect(saveImage).toHaveBeenCalledWith(target)); expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
    copyImage.mockRejectedValueOnce(new Error("clipboard_unavailable")); fireEvent.contextMenu(image);
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(await screen.findByText("复制失败，请重试")).toBeInTheDocument();
  });

  it("recovers a missing native cache only once before retrying an image action", async () => {
    // 测试目标：验证原生操作发现磁盘缓存丢失时经过受限恢复再重试，避免旧 asset 记录导致永久失败。
    // 构造方法：首次复制返回 image_not_cached；替身 recoverOnce 返回新 asset，第二次复制成功。
    // 输入数据：正式附件 image-1；recoverOnce 输出 asset://recovered。
    // 预期行为：恢复以当前会话上下文调用一次，复制调用两次，成功后不出现失败反馈。
    const { props, cache } = fixture(); const recover = vi.spyOn(cache, "recoverOnce").mockResolvedValue({ attachmentId: "image-1", src: "asset://recovered", source: "asset" });
    copyImage.mockRejectedValueOnce("image_not_cached"); render(<ChatPanel {...props} />);
    const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0]; fireEvent.load(image); fireEvent.contextMenu(image);
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    await waitFor(() => expect(copyImage).toHaveBeenCalledTimes(2)); expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 42 }), "image-1");
    expect(screen.queryByText("复制失败，请重试")).not.toBeInTheDocument();
  });

  it("reports viewer and save failures while retaining the visible chat image", async () => {
    // 测试目标：验证查看器或保存操作失败时有明确反馈，不移除已经展示成功的聊天图片。
    // 构造方法：令 viewer.open 与 saveImage 拒绝，加载图片后左击，再通过右键执行下载。
    // 输入数据：正式附件 image-1；viewer_window_failed 与 save_failed。
    // 预期行为：依次显示图片加载失败、保存失败；图片仍存在且可以再次操作。
    openViewer.mockRejectedValueOnce("viewer_window_failed"); saveImage.mockRejectedValueOnce("save_failed");
    render(<ChatPanel {...fixture().props} />); const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0];
    fireEvent.load(image); await userEvent.click(image); expect(await screen.findByText("图片加载失败")).toBeInTheDocument();
    fireEvent.contextMenu(image); await userEvent.click(screen.getByRole("menuitem", { name: "下载原图" }));
    expect(await screen.findByText("保存失败")).toBeInTheDocument(); expect(image).toHaveClass("is-interactive");
  });

  it("fails explicitly when bounded recovery remains a blob and never invokes native copying", async () => {
    // 测试目标：验证恢复未能落盘时不把主窗口 Blob 资源错误地传给原生复制。
    // 构造方法：显示正常图片后让缓存下一次loadMany返回Blob，recoverOnce也只返回Blob，再选择复制。
    // 输入数据：source=blob、src=blob:unpersisted；附件 image-1。
    // 预期行为：执行一次恢复，显示复制失败；不调用 copyImage。
    const { props, cache } = fixture(); render(<ChatPanel {...props} />);
    const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0]; fireEvent.load(image);
    const resource = { attachmentId: "image-1", source: "blob" as const, src: "blob:unpersisted" };
    vi.spyOn(cache, "loadMany").mockResolvedValueOnce([{ attachmentId: "image-1", resource }]);
    const recover = vi.spyOn(cache, "recoverOnce").mockResolvedValueOnce(resource);
    fireEvent.contextMenu(image); await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(await screen.findByText("复制失败，请重试")).toBeInTheDocument(); expect(recover).toHaveBeenCalledTimes(1);
    expect(copyImage).not.toHaveBeenCalled();
  });

  it("closes the active image menu when its message is removed", async () => {
    // 测试目标：验证图片对应的消息 DOM 卸载后不残留可操作菜单。
    // 构造方法：加载图片并打开菜单，然后以空消息列表重新渲染同一会话。
    // 输入数据：会话 42 的 image-message 从消息数组删除。
    // 预期行为：图片与右键菜单都被移除。
    const { props } = fixture(); const { rerender } = render(<ChatPanel {...props} />);
    const image = (await screen.findAllByRole("img", { name: "聊天图片" }))[0]; fireEvent.load(image); fireEvent.contextMenu(image);
    expect(screen.getByRole("menu", { name: "图片菜单" })).toBeInTheDocument();
    rerender(<ChatPanel {...props} conversation={{ ...props.conversation, messages: [] }} />);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.queryByRole("img", { name: "聊天图片" })).not.toBeInTheDocument();
  });
});
