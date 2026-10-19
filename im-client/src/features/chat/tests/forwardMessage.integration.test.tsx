import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const attachmentMocks = vi.hoisted(() => ({
  download: vi.fn(), fetchImage: vi.fn(), upload: vi.fn(), put: vi.fn(), complete: vi.fn(),
}));
vi.mock("../attachmentsApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../attachmentsApi")>(),
  requestDownloadAuthorizations: attachmentMocks.download,
  fetchSignedImage: attachmentMocks.fetchImage,
  requestUploadAuthorizations: attachmentMocks.upload,
  uploadSignedFile: attachmentMocks.put,
  confirmUploads: attachmentMocks.complete,
}));

import { AttachmentResourceCache } from "../attachmentResourceCache";
import { AuthenticatedShell } from "../components/AuthenticatedShell";
import { useChatMessaging } from "../hooks/useChatMessaging";
import type { ChatSendRichMessageInput } from "../../chat-connection/types";
import type { SendTextMessageInput } from "../hooks/useChatMessaging";
import type { ChatData, ChatMessage } from "../types";

const SOURCE = 42;
const TARGET = 43;
const SOURCE_TEXT = "  原正文\n尾行  ";
const sentText = vi.fn<(input: SendTextMessageInput) => void>();
const sentRich = vi.fn<(input: ChatSendRichMessageInput) => void>();
const saveProfile = async () => undefined;

function sourceMessage(rich = false): ChatMessage {
  return {
    localKey: "source", messageId: "00000000-0000-4000-8000-000000000001", conversationId: SOURCE,
    conversationSeq: 1, senderUserId: 2, clientMessageId: "source-client", messageType: rich ? "rich" : "text",
    content: rich ? { blocks: [{ type: "text", text: "图前" }, { type: "image", attachment_id: "source-a" },
      { type: "text", text: "图中" }, { type: "image", attachment_id: "source-b" }, { type: "text", text: "图后" }] }
      : { text: SOURCE_TEXT },
    replyToMessageId: "old-reference", replyTo: { messageId: "old-reference", senderUserId: 2,
      messageType: "text", content: { text: "不能跟随转发的原引用" } },
    createdAt: "2026-10-19T10:00:00+08:00", clientSentAt: "2026-10-19T10:00:00+08:00",
    localStatus: "accepted", displayTime: "10:00", showTime: true, showAvatar: true,
  };
}

function fixture(rich: boolean): ChatData {
  const profile = { userId: 2, name: "来源好友", avatar: "来", tone: "blue" as const };
  const conversation = { type: "direct" as const, avatar: "来", tone: "blue" as const,
    status: "在线", participants: { 2: profile } };
  return {
    self: { userId: 1, name: "本人", avatar: "本", tone: "blue", account: "self" },
    sessions: [
      { id: "target", conversationId: TARGET, type: "direct", name: "目标好友", avatar: "目", tone: "blue", preview: "目标空会话", time: "" },
      { id: "source", conversationId: SOURCE, type: "direct", name: "来源好友", avatar: "来", tone: "blue", preview: "来源预览", time: "" },
    ],
    conversations: {
      [SOURCE]: { ...conversation, conversationId: SOURCE, name: "来源好友", messages: [sourceMessage(rich)] },
      [TARGET]: { ...conversation, conversationId: TARGET, name: "目标好友", messages: [] },
    },
    contacts: [], contactSections: [],
  };
}

function Harness({ rich = false, ownerId = 1, targetAvailable = true }: { rich?: boolean; ownerId?: number; targetAvailable?: boolean }) {
  const [state, setState] = useState(() => fixture(rich));
  const data = { ...state, self: { ...state.self, userId: ownerId }, conversations: targetAvailable ? state.conversations
    : { [SOURCE]: state.conversations[SOURCE] } };
  const nextId = useRef(0);
  const cache = useRef<AttachmentResourceCache | null>(null);
  if (!cache.current) cache.current = new AttachmentResourceCache({
    isDesktop: () => true,
    lookup: async (_key, ids) => ids.map((attachmentId) => ({ attachmentId, filePath: `C:/cached/${attachmentId}.png` })),
    download: async () => [], invalidate: async () => undefined, toAssetUrl: (path) => `asset://${path}`,
  });
  const messaging = useChatMessaging({ data,
    updateData: (updater) => setState((current) => updater(current) ?? current),
    sendTextMessage: sentText, sendRichMessage: sentRich,
    clientMessageIdFactory: () => `new-client-${++nextId.current}`,
  });
  return <AuthenticatedShell data={data} canSendMessages connectionLabel="在线" isLoggingOut={false}
    onLogout={() => undefined} onSaveProfile={saveProfile} apiBaseUrl="https://api.test" accessToken="token"
    attachmentResourceCache={cache.current} onSendText={messaging.send} onSendRich={messaging.sendRich}
    onRetryMessage={messaging.retry} onForwardMessage={messaging.forward} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function openForward(rich = false) {
  if (rich) await screen.findAllByRole("img", { name: "聊天图片" });
  fireEvent.contextMenu(within(screen.getByLabelText("消息列表")).getByText(rich ? "图前" : "原正文 尾行"));
  await userEvent.click(screen.getByRole("menuitem", { name: "转发" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("radio", { name: /目标好友/ }));
  return dialog;
}

async function bytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  Object.values(attachmentMocks).forEach((mock) => mock.mockReset());
  sentText.mockReset(); sentRich.mockReset();
  attachmentMocks.download.mockResolvedValue(["source-b", "source-a"].map((id) => ({
    attachment_id: id, download_url: `https://download.test/${id}`, content_type: "image/png",
    size_bytes: 3, expires_at: "2099-01-01T00:00:00Z",
  })));
  attachmentMocks.fetchImage.mockImplementation(async (url: string) => new Blob([
    new Uint8Array(url.endsWith("source-a") ? [0, 255, 1] : [2, 128, 3]),
  ], { type: "image/png" }));
  attachmentMocks.upload.mockResolvedValue(["target-a", "target-b"].map((id) => ({
    attachment_id: id, upload_url: `https://upload.test/${id}`, method: "PUT", headers: {}, expires_at: "2099-01-01T00:00:00Z",
  })));
  attachmentMocks.put.mockResolvedValue(undefined);
  attachmentMocks.complete.mockResolvedValue(["target-b", "target-a"].map((id) => ({ attachment_id: id, status: "uploaded" })));
});
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe("forwarding through the authenticated shell and real messaging", () => {
  it("preserves both drafts and source reply while forwarding the exact body as a new plain message", async () => {
    // 测试目标：验证真实菜单到消息层的转发隔离草稿、保留正文，并移除原引用。
    // 构造方法：分别编辑目标与来源草稿，给来源草稿选择回复，再从来源正式消息转发到目标。
    // 输入数据：带首尾空格与换行的原正文，目标草稿“目标草稿”、来源草稿“来源草稿”。
    // 预期行为：新 client ID 仅发送原正文，不带回复；来源视图与回复状态不变，切回目标仍有原草稿。
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", { name: /目标好友 目标空会话/ }));
    await user.type(screen.getByRole("textbox", { name: "输入消息" }), "目标草稿");
    await user.click(screen.getByRole("button", { name: /来源好友 来源预览/ }));
    await user.type(screen.getByRole("textbox", { name: "输入消息" }), "来源草稿");
    fireEvent.contextMenu(screen.getByText("原正文 尾行"));
    await user.click(screen.getByRole("menuitem", { name: "回复" }));
    const dialog = await openForward();
    await user.click(within(dialog).getByRole("button", { name: "确认转发" }));
    await waitFor(() => expect(sentText).toHaveBeenCalledTimes(1));
    expect(sentText.mock.calls[0][0]).toEqual({ conversationId: TARGET, clientMessageId: "new-client-1",
      text: SOURCE_TEXT, clientSentAt: expect.any(String) });
    expect(screen.getByRole("heading", { name: "来源好友", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveTextContent("来源草稿");
    expect(screen.getByRole("group", { name: "回复消息" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: /目标好友/ }));
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveTextContent("目标草稿");
  });

  it("retries a submitted forwarding failure with the original client and attachment IDs", async () => {
    // 测试目标：验证消息提交失败后的对话框重试复用幂等标识，不重新复制附件。
    // 构造方法：完成两张图片准备与上传，令真实消息层的首次发送抛出异常，再点击重试。
    // 输入数据：新 client ID new-client-1、新附件 target-a 和 target-b，首次传输失败。
    // 预期行为：两次发送参数完全相同；源授权、目标上传授权与确认均只执行一批，未确认前不显示成功。
    sentRich.mockImplementationOnce(() => { throw new Error("offline"); });
    render(<Harness rich />); const dialog = await openForward(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认转发" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "重试转发" }));
    await waitFor(() => expect(sentRich).toHaveBeenCalledTimes(2));
    expect(sentRich.mock.calls[1][0]).toEqual(sentRich.mock.calls[0][0]);
    expect(sentRich.mock.calls[1][0].clientMessageId).toBe("new-client-1");
    expect(attachmentMocks.download).toHaveBeenCalledTimes(1);
    expect(attachmentMocks.upload).toHaveBeenCalledTimes(1);
    expect(attachmentMocks.put).toHaveBeenCalledTimes(2);
    expect(attachmentMocks.complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("转发成功")).not.toBeInTheDocument();
  });

  it("reauthorizes cached source images, uploads exact bytes and sends all blocks only after complete confirmation", async () => {
    // 测试目标：验证展示缓存命中仍重新授权，源图原字节完整上传后才发送保序正文。
    // 构造方法：使用命中所有图片的桌面缓存，乱序返回源授权与上传确认，并延迟确认结果。
    // 输入数据：两张三字节 PNG 和 text/image/text/image/text blocks，目标附件 target-a、target-b。
    // 预期行为：全量源授权与下载；确认前无消息；确认后使用新附件保序发送，不携带引用或 previewUrl。
    const confirmation = deferred<Array<{ attachment_id: string; status: string }>>();
    attachmentMocks.complete.mockReturnValueOnce(confirmation.promise);
    render(<Harness rich />); const dialog = await openForward(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认转发" }));
    await waitFor(() => expect(attachmentMocks.complete).toHaveBeenCalledTimes(1));
    expect(attachmentMocks.download).toHaveBeenCalledWith("https://api.test", "token", SOURCE, ["source-a", "source-b"]);
    expect(attachmentMocks.put).toHaveBeenCalledTimes(2);
    expect(await bytes(attachmentMocks.put.mock.calls[0][1])).toEqual([0, 255, 1]);
    expect(await bytes(attachmentMocks.put.mock.calls[1][1])).toEqual([2, 128, 3]);
    expect(sentRich).not.toHaveBeenCalled();
    await act(async () => confirmation.resolve([{ attachment_id: "target-b", status: "uploaded" }, { attachment_id: "target-a", status: "uploaded" }]));
    await waitFor(() => expect(sentRich).toHaveBeenCalledTimes(1));
    expect(sentRich.mock.calls[0][0]).toEqual({ conversationId: TARGET, clientMessageId: "new-client-1", clientSentAt: expect.any(String),
      blocks: [{ type: "text", text: "图前" }, { type: "image", attachment_id: "target-a" }, { type: "text", text: "图中" },
        { type: "image", attachment_id: "target-b" }, { type: "text", text: "图后" }] });
  });

  it.each(["cancel", "owner change", "target removed"] as const)("prevents late sends after %s during image authorization", async (reason) => {
    // 测试目标：验证取消、切换账号或目标失效后，旧异步不得上传或发送。
    // 构造方法：真实界面开始图文转发后阻塞源授权，执行当前表项的生命周期操作，再返回旧授权。
    // 输入数据：源会话两张图片、目标会话 43；切换到账号 99 或删除目标会话。
    // 预期行为：取消/换账号关闭弹窗，目标失效显示失败；均不下载、不上传、不发送，保留来源正文。
    const authorization = deferred<unknown[]>(); attachmentMocks.download.mockReturnValueOnce(authorization.promise);
    const view = render(<Harness rich />); const dialog = await openForward(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认转发" }));
    await waitFor(() => expect(attachmentMocks.download).toHaveBeenCalledTimes(1));
    if (reason === "cancel") await userEvent.click(within(dialog).getByRole("button", { name: /取消/ }));
    else if (reason === "owner change") view.rerender(<Harness rich ownerId={99} />);
    else view.rerender(<Harness rich targetAvailable={false} />);
    await act(async () => authorization.resolve(["source-a", "source-b"].map((id) => ({ attachment_id: id,
      download_url: `https://download.test/${id}`, content_type: "image/png", size_bytes: 3, expires_at: "2099-01-01T00:00:00Z" }))));
    if (reason === "target removed") expect(await within(dialog).findByText("目标会话已不可用")).toBeInTheDocument();
    else expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(attachmentMocks.fetchImage).not.toHaveBeenCalled(); expect(attachmentMocks.upload).not.toHaveBeenCalled();
    expect(sentRich).not.toHaveBeenCalled(); expect(sentText).not.toHaveBeenCalled();
    expect(screen.getByText("图前")).toBeInTheDocument();
  });
});
