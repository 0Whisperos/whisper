import { beforeEach, describe, expect, it, vi } from "vitest";
import { canForwardMessage, forwardMessageBody, prepareForwardMessage } from "./messageForwarding";
import type { ChatMessage } from "./types";

const { requestDownloadAuthorizations, fetchSignedImage } = vi.hoisted(() => ({
  requestDownloadAuthorizations: vi.fn(), fetchSignedImage: vi.fn(),
}));
vi.mock("./attachmentsApi", () => ({ requestDownloadAuthorizations, fetchSignedImage }));
const source = (content: ChatMessage["content"] = { text: " 原文\n保留 " }): ChatMessage => ({
  localKey: "source", messageId: "source", conversationId: 1, conversationSeq: 1, senderUserId: 2,
  clientMessageId: "old-client", messageType: "text" in content! ? "text" : "rich", content,
  replyToMessageId: "quoted", createdAt: "2026-10-19", clientSentAt: "2026-10-19",
  localStatus: "accepted", displayTime: "", showTime: true, showAvatar: true,
});
const grant = (id: string, size = 3, type = "image/png") => ({
  attachment_id: id, download_url: `https://oss/${id}`, expires_at: "later", content_type: type, size_bytes: size,
});
beforeEach(() => vi.clearAllMocks());

describe("forward message body preparation", () => {
  it("clones text verbatim without references or authorship", async () => {
    // 测试目标：验证纯文字转发保持正文且不带原作者、来源和回复。
    // 构造方法：准备带 replyToMessageId 的正式消息，调用准备和载荷转换函数。
    // 输入数据：含前后空格及换行的“ 原文\n保留 ”。
    // 预期行为：新载荷仅含 messageType/content，原消息和引用不变，不请求附件。
    const message = source();
    expect(forwardMessageBody(await prepareForwardMessage(message, "https://api", () => "token")))
      .toEqual({ messageType: "text", content: { text: " 原文\n保留 " } });
    expect(message.replyToMessageId).toBe("quoted");
    expect(requestDownloadAuthorizations).not.toHaveBeenCalled();
  });

  it("authorizes all images freshly and maps reordered grants while preserving blocks", async () => {
    // 测试目标：验证整批新授权、按附件 ID 映射与原图文顺序和字节保留。
    // 构造方法：令授权按 b/a 反序返回，下载两个原始 Blob，再替换目标上传 ID。
    // 输入数据：text/a/text/b/a 混排、两个 image/png 原始字节 abc。
    // 预期行为：一次授权 a/b，文件大小类型不变，重复图只下载一次，载荷新 ID 按原序。
    requestDownloadAuthorizations.mockResolvedValue([grant("b"), grant("a")]);
    fetchSignedImage.mockResolvedValue(new Blob(["abc"], { type: "image/png" }));
    const draft = await prepareForwardMessage(source({ blocks: [{ type: "text", text: "前" },
      { type: "image", attachment_id: "a", previewUrl: "blob:old" }, { type: "text", text: "后" },
      { type: "image", attachment_id: "b" }, { type: "image", attachment_id: "a" }] }), "https://api", () => "fresh");
    expect(requestDownloadAuthorizations).toHaveBeenCalledWith("https://api", "fresh", 1, ["a", "b"]);
    expect(fetchSignedImage.mock.calls.map(([url]) => url)).toEqual(["https://oss/a", "https://oss/b"]);
    for (const block of draft.blocks) if (block.type === "image") {
      expect(block.file.size).toBe(3); expect(block.file.type).toBe("image/png"); expect(block.previewUrl).toBe("");
      block.attachmentId = block.file.name.startsWith("a.") ? "new-a" : "new-b"; block.uploaded = true;
    }
    expect(forwardMessageBody(draft)).toEqual({ messageType: "rich", content: { blocks: [
      { type: "text", text: "前" }, { type: "image", attachment_id: "new-a" }, { type: "text", text: "后" },
      { type: "image", attachment_id: "new-b" }, { type: "image", attachment_id: "new-a" },
    ] } });
  });

  it.each([
    { name: "missing", grants: [grant("a")], ids: ["a", "b"] },
    { name: "duplicate", grants: [grant("a"), grant("a")], ids: ["a", "b"] },
    { name: "foreign", grants: [grant("a"), grant("foreign")], ids: ["a", "b"] },
    { name: "mime", grants: [grant("a", 3, "image/svg+xml")], ids: ["a"] },
    { name: "empty", grants: [grant("a", 0)], ids: ["a"] },
    { name: "oversized", grants: [grant("a", 20 * 1024 * 1024 + 1)], ids: ["a"] },
    { name: "total", grants: [grant("a", 18 * 1024 * 1024), grant("b", 18 * 1024 * 1024), grant("c", 18 * 1024 * 1024)], ids: ["a", "b", "c"] },
  ])("rejects invalid authorization $name before downloading", async ({ grants, ids }) => {
    // 测试目标：验证当前场景的授权覆盖、媒体类型或大小错误会整条失败。
    // 构造方法：返回该行 grants，将 ids 构造成图片消息后准备转发。
    // 输入数据：本行给定的缺失/重复/外来授权、不支持类型、空图或超限大小。
    // 预期行为：准备失败，下载从未开始，不返回部分正文。
    requestDownloadAuthorizations.mockResolvedValue(grants);
    await expect(prepareForwardMessage(source({ blocks: ids.map((attachment_id) => ({ type: "image", attachment_id })) }),
      "https://api", () => "token")).rejects.toThrow();
    expect(fetchSignedImage).not.toHaveBeenCalled();
  });

  it.each([{ name: "size", blob: new Blob(["short"], { type: "image/png" }) },
    { name: "mime", blob: new Blob(["abc"], { type: "image/jpeg" }) }])("rejects downloaded $name mismatch", async ({ blob }) => {
    // 测试目标：验证下载字节长度和 MIME 均须与授权一致。
    // 构造方法：授权 png/3 字节，下载该行给定的不匹配 Blob。
    // 输入数据：5 字节 PNG 或 3 字节 JPEG。
    // 预期行为：整条失败，不能生成可上传草稿。
    requestDownloadAuthorizations.mockResolvedValue([grant("a")]); fetchSignedImage.mockResolvedValue(blob);
    await expect(prepareForwardMessage(source({ blocks: [{ type: "image", attachment_id: "a" }] }),
      "https://api", () => "token")).rejects.toThrow("校验失败");
  });

  it("rejects too many images and nonofficial messages", async () => {
    // 测试目标：验证图片数量与正式消息前置条件。
    // 构造方法：分别构造 11 张图、sending、failed 和无 ID 消息。
    // 输入数据：11 个 a 图片块，以及带各状态的文字消息。
    // 预期行为：图片超限失败；其余消息均不可转发，未请求授权。
    await expect(prepareForwardMessage(source({ blocks: Array.from({ length: 11 }, () => ({ type: "image", attachment_id: "a" })) }),
      "https://api", () => "token")).rejects.toThrow();
    expect(canForwardMessage({ ...source(), localStatus: "sending" })).toBe(false);
    expect(canForwardMessage({ ...source(), localStatus: "failed" })).toBe(false);
    expect(canForwardMessage({ ...source(), messageId: null })).toBe(false);
    expect(requestDownloadAuthorizations).not.toHaveBeenCalled();
  });

  it("stops before the next download after cancellation", async () => {
    // 测试目标：验证取消后旧授权结果不会启动下载。
    // 构造方法：授权替身完成时取消，再由 assertActive 拒绝继续。
    // 输入数据：一张 a 图片及已取消标记。
    // 预期行为：准备失败且不下载图片。
    let canceled = false;
    requestDownloadAuthorizations.mockImplementation(async () => { canceled = true; return [grant("a")]; });
    await expect(prepareForwardMessage(source({ blocks: [{ type: "image", attachment_id: "a" }] }), "https://api", () => "token",
      () => { if (canceled) throw new Error("canceled"); })).rejects.toThrow("canceled");
    expect(fetchSignedImage).not.toHaveBeenCalled();
  });
});
