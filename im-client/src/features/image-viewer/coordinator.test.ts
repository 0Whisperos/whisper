import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ closeImageViewerSession: vi.fn(), prepareImageViewerSession: vi.fn(), updateImageViewerSession: vi.fn() }));
import { closeImageViewerSession, prepareImageViewerSession, updateImageViewerSession } from "./api";
import { collectViewerImages, imageViewerCoordinator } from "./coordinator";
import type { AttachmentResourceCache, AttachmentLoadContext } from "../chat/attachmentResourceCache";
import type { ChatConversation, ChatMessage } from "../chat/types";
import type { ImageViewerSession } from "./types";

const context: AttachmentLoadContext = { apiBaseUrl: "https://api", userId: 1, conversationId: 9, accessToken: "token" };
function message(id: string, sequence: number, status: ChatMessage["localStatus"] = "accepted"): ChatMessage {
  return { localKey: id, messageId: id, conversationId: 9, conversationSeq: sequence, senderUserId: 1, clientMessageId: id,
    messageType: "rich", content: { blocks: [{ type: "text", text: "before" }, { type: "image", attachment_id: "same" }, { type: "image", attachment_id: "same" }] },
    createdAt: "now", clientSentAt: "now", localStatus: status, displayTime: "", showTime: false, showAvatar: false };
}
function conversation(messages = [message("m", 1)]): ChatConversation {
  return { conversationId: 9, type: "direct", name: "chat", avatar: "a", tone: "blue", status: "", participants: {}, messages };
}
function session(): ImageViewerSession {
  return { sessionId: "s", version: 1, conversationId: 9, currentIndex: 0,
    images: collectViewerImages(conversation()).map((image) => ({ ...image, assetUrl: "asset://image" })) };
}
function cache(source: "asset" | "blob" = "asset") {
  return { loadMany: vi.fn().mockResolvedValue([{ attachmentId: "same", resource: { attachmentId: "same", src: "asset://image", source } }]),
    recoverOnce: vi.fn().mockResolvedValue({ attachmentId: "same", src: "asset://recovered", source: "asset" }) };
}
function asCache(value: ReturnType<typeof cache>): AttachmentResourceCache { return value as unknown as AttachmentResourceCache; }

beforeEach(async () => {
  vi.mocked(closeImageViewerSession).mockResolvedValue();
  await imageViewerCoordinator.close();
  vi.clearAllMocks();
  vi.mocked(prepareImageViewerSession).mockResolvedValue(session());
  vi.mocked(updateImageViewerSession).mockResolvedValue(session());
});

it("sorts formal messages and retains repeated attachment positions", () => {
  // 测试目标：验证图库顺序和重复附件标识。
  // 构造方法：构造倒序正式消息及发送中、失败消息。
  // 输入数据：序号2 b、序号1 a、发送中 c、失败 d；每条含文本及两相同附件。
  // 预期行为：只得到 a:1、a:2、b:1、b:2，保留原始 block 下标。
  expect(collectViewerImages(conversation([message("b", 2), message("a", 1), message("c", 3, "sending"), message("d", 4, "failed")])).map((image) => image.id))
    .toEqual(["a:1", "a:2", "b:1", "b:2"]);
});

it("recovers Blob resources and retries stale disk cache once before opening", async () => {
  // 测试目标：验证 Blob 与后端缓存丢失走受限恢复，不空开查看器。
  // 构造方法：先以 Blob 打开，再模拟 prepare 报缓存丢失。
  // 输入数据：m:1 图片与 image_unavailable 后成功 session。
  // 预期行为：Blob 先恢复为 asset；磁盘失效恢复一次并重试 prepare。
  const blobCache = cache("blob");
  await imageViewerCoordinator.open(context, conversation(), "m:1", asCache(blobCache));
  expect(blobCache.recoverOnce).toHaveBeenCalledTimes(1);
  const diskCache = cache();
  vi.mocked(prepareImageViewerSession).mockRejectedValueOnce("image_unavailable").mockResolvedValueOnce(session());
  await imageViewerCoordinator.open(context, conversation(), "m:1", asCache(diskCache));
  expect(diskCache.recoverOnce).toHaveBeenCalledTimes(1);
  expect(prepareImageViewerSession).toHaveBeenCalledTimes(3);
});

it("rejects unrecoverable Blob images without preparing a blank window", async () => {
  // 测试目标：验证无法持久化的图片不会开空窗口。
  // 构造方法：load 与恢复都返回 Blob。
  // 输入数据：m:1 图片。
  // 预期行为：open 拒绝，后端 prepare 从未调用。
  const value = cache("blob");
  value.recoverOnce.mockResolvedValue({ attachmentId: "same", src: "blob:still", source: "blob" });
  await expect(imageViewerCoordinator.open(context, conversation(), "m:1", asCache(value))).rejects.toThrow("image_load_failed");
  expect(prepareImageViewerSession).not.toHaveBeenCalled();
});

it("ignores an older open recovery and serializes close after an in-flight prepare", async () => {
  // 测试目标：验证旧打开请求和清理不会覆盖最新会话。
  // 构造方法：阻塞第一次缓存请求，完成第二次打开，再释放旧请求；随后阻塞 prepare 并关闭。
  // 输入数据：同会话 m:1、m:2 与 close。
  // 预期行为：旧请求不 prepare；关闭等待正在进行的 prepare 后执行。
  const old = cache();
  let release!: (value: unknown) => void;
  old.loadMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const older = imageViewerCoordinator.open(context, conversation(), "m:1", asCache(old));
  await imageViewerCoordinator.open(context, conversation(), "m:2", asCache(cache()));
  release([{ attachmentId: "same", resource: { attachmentId: "same", src: "asset://old", source: "asset" } }]);
  await older;
  expect(prepareImageViewerSession).toHaveBeenCalledTimes(1);
  expect(vi.mocked(prepareImageViewerSession).mock.calls[0][0].selectedImageId).toBe("m:2");
  let releasePrepare!: (value: ImageViewerSession) => void;
  vi.mocked(prepareImageViewerSession).mockImplementationOnce(() => new Promise((resolve) => { releasePrepare = resolve; }));
  const pending = imageViewerCoordinator.open(context, conversation(), "m:1", asCache(cache()));
  await vi.waitFor(() => expect(releasePrepare).toBeDefined());
  const closing = imageViewerCoordinator.close();
  expect(closeImageViewerSession).not.toHaveBeenCalled();
  releasePrepare(session());
  await Promise.all([pending, closing]);
  expect(closeImageViewerSession).toHaveBeenCalledTimes(2);
  expect(closeImageViewerSession).toHaveBeenNthCalledWith(1, "s");
  expect(closeImageViewerSession).toHaveBeenNthCalledWith(2);
});

it("syncs only the viewer conversation and deduplicates unchanged sequences", async () => {
  // 测试目标：验证主窗口切换会话保留图库，只同步所属会话的新已加载消息。
  // 构造方法：打开会话9，先只同步会话10，再同步会话9新增消息两次。
  // 输入数据：原 m，新 n 序号2。
  // 预期行为：其他会话不更新；新增图片只调用一次 update。
  await imageViewerCoordinator.open(context, conversation(), "m:1", asCache(cache()));
  await imageViewerCoordinator.sync({ 10: { ...conversation(), conversationId: 10 } });
  expect(updateImageViewerSession).not.toHaveBeenCalled();
  const updated = { 9: conversation([message("m", 1), message("n", 2)]) };
  await imageViewerCoordinator.sync(updated);
  await imageViewerCoordinator.sync(updated);
  expect(updateImageViewerSession).toHaveBeenCalledTimes(1);
  expect(updateImageViewerSession).toHaveBeenCalledWith("s", collectViewerImages(updated[9]));
});

it("persists new message image resources before syncing with refreshed credentials", async () => {
  // 测试目标：验证新消息同步等待缓存落盘且使用最新访问令牌。
  // 构造方法：打开图库，替换加载缓存替身并阻塞新消息资源准备，再释放。
  // 输入数据：新增n序号2、accessToken refreshed，以及重复same附件。
  // 预期行为：缓存完成前不update；loadMany使用图库会话及新token；随后update一次。
  await imageViewerCoordinator.open(context, conversation(), "m:1", asCache(cache()));
  const freshCache = cache();
  let release!: (value: unknown) => void;
  freshCache.loadMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const updated = { 9: conversation([message("m", 1), message("n", 2)]) };
  const pending = imageViewerCoordinator.sync(updated, { apiBaseUrl: context.apiBaseUrl, userId: 1, accessToken: "refreshed" }, asCache(freshCache));
  await vi.waitFor(() => expect(freshCache.loadMany).toHaveBeenCalled());
  expect(freshCache.loadMany).toHaveBeenCalledWith({ ...context, accessToken: "refreshed" }, ["same", "same", "same", "same"]);
  expect(updateImageViewerSession).not.toHaveBeenCalled();
  release([]);
  await pending;
  expect(updateImageViewerSession).toHaveBeenCalledOnce();
});

it("discards an old-token preload when a renewed-token sync is queued", async () => {
  // 测试目标：验证缓存预载期间令牌续期不会提交旧结果或锁死图库序列。
  // 构造方法：阻塞旧token新图加载，排入新token同步，然后让旧加载返回失败。
  // 输入数据：新增n图片，旧token token、新token renewed，旧加载失败条。
  // 预期行为：旧预载不update，新预载使用renewed令牌完成后才唯一update。
  const value = cache();
  await imageViewerCoordinator.open(context, conversation(), "m:1", asCache(value));
  value.loadMany.mockClear();
  let release!: (value: unknown) => void;
  value.loadMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const updated = { 9: conversation([message("m", 1), message("n", 2)]) };
  const oldSync = imageViewerCoordinator.sync(updated, context, asCache(value));
  await vi.waitFor(() => expect(value.loadMany).toHaveBeenCalledOnce());
  const renewedSync = imageViewerCoordinator.sync(updated, { ...context, accessToken: "renewed" }, asCache(value));
  release([{ attachmentId: "same", error: new Error("expired") }]);
  await Promise.all([oldSync, renewedSync]);
  expect(value.loadMany).toHaveBeenCalledTimes(2);
  expect(value.loadMany.mock.calls[1][0].accessToken).toBe("renewed");
  expect(updateImageViewerSession).toHaveBeenCalledOnce();
});
