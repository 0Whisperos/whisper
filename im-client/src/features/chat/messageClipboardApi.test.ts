import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentResourceCache } from "./attachmentResourceCache";
import type { ChatMessage } from "./types";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: isTauriMock, convertFileSrc: vi.fn() }));
import { copyChatMessage, readChatClipboardHtml } from "./messageClipboardApi";

const context = { apiBaseUrl: "https://api.test///", accessToken: "secret", userId: 1, conversationId: 2 };
const message: ChatMessage = { localKey: "a", messageId: "message", conversationId: 2, conversationSeq: 1, senderUserId: 1,
  clientMessageId: "client", messageType: "rich", content: { blocks: [{ type: "text", text: "前" }, { type: "image", attachment_id: "image" }, { type: "text", text: "后" }] },
  createdAt: null, clientSentAt: "now", localStatus: "accepted", displayTime: "", showTime: false, showAvatar: true };

describe("message clipboard API", () => {
  beforeEach(() => { invokeMock.mockReset().mockResolvedValue(undefined); isTauriMock.mockReturnValue(true); vi.unstubAllGlobals(); });

  it("writes ordered body blocks with normalized cache keys and no credentials", async () => {
    // 测试目标：正式消息复制仅提交正文和受控缓存键，不泄漏凭证或引用元数据。
    // 构造方法：替身缓存返回 asset，复制前图后消息并检查一次 command。
    // 输入数据：前、image、后，服务器末尾斜杠与 secret token。
    // 预期行为：有序正文传给原生接口，地址规范化，无 token 或源路径。
    const cache = new AttachmentResourceCache();
    vi.spyOn(cache, "loadMany").mockResolvedValue([{ attachmentId: "image", resource: { attachmentId: "image", source: "asset", src: "asset://private" } }]);
    await copyChatMessage(message, context, cache);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("write_chat_message_clipboard", { apiBaseUrl: "https://api.test", userId: 1, conversationId: 2,
      blocks: [{ type: "text", text: "前" }, { type: "image", source: { kind: "cache", attachmentId: "image" } }, { type: "text", text: "后" }] });
  });

  it.each(["sending", "failed"] as const)("copies %s temporary pictures from their Blob without native arbitrary URLs", async (localStatus) => {
    // 测试目标：发送中与失败消息均可复制尚未上传的原图正文。
    // 构造方法：替身 fetch 返回本地 PNG Blob，给临时块配置 blob 预览。
    // 输入数据：sending/failed 状态、blob:local 和三字节图片 Blob。
    // 预期行为：仅前端访问 blob，原生命令只收到 MIME/Base64，不访问附件缓存。
    const cache = new AttachmentResourceCache();
    const load = vi.spyOn(cache, "loadMany");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetchMock);
    await copyChatMessage({ ...message, localStatus, messageId: null, content: { blocks: [{ type: "image", attachment_id: "local", previewUrl: "blob:local" }] } }, context, cache);
    expect(fetchMock).toHaveBeenCalledWith("blob:local"); expect(load).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("write_chat_message_clipboard", expect.objectContaining({ blocks: [{ type: "image", source: { kind: "inline", contentType: "image/png", base64: "AQID" } }] }));
  });

  it("recovers the whole cached message once and never writes a partial image subset", async () => {
    // 测试目标：磁盘缓存失效后整体恢复重试，失败时不发送部分图片。
    // 构造方法：第一次原生写入返回缓存缺失，恢复一次成功后重试完整 DTO。
    // 输入数据：正文前图后、image_not_cached、恢复后的 asset。
    // 预期行为：两次写入参数相同，恢复一次；恢复失败的第二次操作不调用 native。
    const cache = new AttachmentResourceCache();
    vi.spyOn(cache, "loadMany").mockResolvedValue([{ attachmentId: "image", resource: { attachmentId: "image", source: "asset", src: "asset://old" } }]);
    const recover = vi.spyOn(cache, "recoverOnce").mockResolvedValue({ attachmentId: "image", source: "asset", src: "asset://new" });
    invokeMock.mockRejectedValueOnce("image_not_cached").mockResolvedValueOnce(undefined);
    await copyChatMessage(message, context, cache);
    expect(recover).toHaveBeenCalledTimes(1); expect(invokeMock.mock.calls[0]).toEqual(invokeMock.mock.calls[1]);
    invokeMock.mockClear();
    vi.spyOn(cache, "loadMany").mockResolvedValue([{ attachmentId: "image", error: "missing" }]);
    recover.mockRejectedValueOnce("image_unavailable");
    await expect(copyChatMessage(message, context, cache)).rejects.toBe("image_unavailable");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads native HTML only through its explicit entrypoint", async () => {
    // 测试目标：读取 fallback 保持窄 API，浏览器环境不调用原生剪贴板。
    // 构造方法：桌面返回 HTML，再切换到浏览器环境调用读取。
    // 输入数据：<pre>源码</pre> 和非 Tauri runtime。
    // 预期行为：桌面返回原始 HTML；浏览器返回 null 且不 invoke。
    invokeMock.mockResolvedValueOnce({ html: "<pre>源码</pre>" });
    expect(await readChatClipboardHtml()).toBe("<pre>源码</pre>");
    expect(invokeMock).toHaveBeenCalledWith("read_chat_clipboard_html");
    invokeMock.mockClear(); isTauriMock.mockReturnValue(false);
    expect(await readChatClipboardHtml()).toBeNull(); expect(invokeMock).not.toHaveBeenCalled();
  });
});
