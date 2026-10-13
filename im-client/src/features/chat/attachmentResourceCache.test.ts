import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, fetchImageMock } = vi.hoisted(() => ({ authorizeMock: vi.fn(), fetchImageMock: vi.fn() }));
vi.mock("./attachmentsApi", () => ({
  requestDownloadAuthorizations: authorizeMock,
  fetchSignedImage: fetchImageMock,
}));

import { AttachmentResourceCache, type AttachmentLoadContext } from "./attachmentResourceCache";
import type { AttachmentCacheAdapter } from "./attachmentCacheApi";

const context: AttachmentLoadContext = {
  apiBaseUrl: "https://api.test/", accessToken: "token", userId: 7, conversationId: 9,
};

function makeAdapter(overrides: Partial<AttachmentCacheAdapter> = {}): AttachmentCacheAdapter {
  return {
    isDesktop: vi.fn(() => true),
    lookup: vi.fn(async (_key, ids: string[]) => ids.map((attachmentId: string) => ({ attachmentId, filePath: null }))),
    download: vi.fn(async (_key, auths: Array<{ attachmentId: string }>) => auths.map((auth) => ({ attachmentId: auth.attachmentId, filePath: `C:/cache/${auth.attachmentId}.png` }))),
    invalidate: vi.fn(async () => undefined),
    toAssetUrl: vi.fn((path) => `asset://${path}`),
    ...overrides,
  };
}

function authorizations(ids: string[]) {
  return ids.map((attachment_id) => ({
    attachment_id, download_url: `https://cdn.test/${attachment_id}`, expires_at: "never",
    content_type: "image/png", size_bytes: 12,
  }));
}

describe("AttachmentResourceCache", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    fetchImageMock.mockReset();
    authorizeMock.mockImplementation(async (_url: string, _token: string, _conversation: number, ids: string[]) => authorizations(ids));
    fetchImageMock.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:image-${Math.random()}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("uses disk hits without requesting authorization and reuses a resource across sessions", async () => {
    // 测试目标：验证有效磁盘缓存直接转为 asset URL，并在同一协调器生命周期内跨会话切换复用资源。
    // 构造方法：令 SQLite 查询返回附件路径，先从会话 9 加载，再从同一用户的会话 10 请求同附件。
    // 输入数据：image-a 的本地路径为 C:/cache/image-a.png，两个会话 ID 分别为 9 和 10。
    // 预期行为：首次得到 asset URL 且不申请下载授权；不同会话键隔离，因此会话 10 重新查询自己的缓存。
    const adapter = makeAdapter({ lookup: vi.fn(async (_key, ids: string[]) => ids.map((attachmentId: string) => ({ attachmentId, filePath: `C:/cache/${attachmentId}.png` }))) });
    const cache = new AttachmentResourceCache(adapter);
    const [first] = await cache.loadMany(context, ["image-a"]);
    expect(first.resource).toEqual({ attachmentId: "image-a", src: "asset://C:/cache/image-a.png", source: "asset" });
    const [second] = await cache.loadMany({ ...context, conversationId: 10 }, ["image-a"]);
    expect(second.resource).toBeDefined();
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(adapter.lookup).toHaveBeenCalledTimes(2);
  });

  it("deduplicates overlapping requests and caps authorization batches at ten", async () => {
    // 测试目标：验证同一逻辑键的并发消费者共享任务，并且每个下载授权请求最多包含十张图片。
    // 构造方法：一次提交 11 个附件，随后在首批未完成时再请求 image-0；以延迟授权 Promise 保持并发窗口。
    // 输入数据：image-0 至 image-10，第二个消费者重复请求 image-0。
    // 预期行为：授权分批为 10 张和 1 张，image-0 只出现在授权中一次，两个消费者得到相同 asset src。
    let release!: () => void;
    authorizeMock.mockImplementationOnce(async (_url: string, _token: string, _conversation: number, ids: string[]) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return authorizations(ids);
    });
    const adapter = makeAdapter();
    const cache = new AttachmentResourceCache(adapter);
    const firstPromise = cache.loadMany(context, Array.from({ length: 11 }, (_, index) => `image-${index}`));
    const duplicatePromise = cache.loadMany(context, ["image-0"]);
    await vi.waitFor(() => expect(authorizeMock).toHaveBeenCalledTimes(2));
    release();
    const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise]);
    expect(first).toHaveLength(11);
    expect(duplicate[0].resource?.src).toBe(first[0].resource?.src);
    expect(authorizeMock.mock.calls.map((call) => call[3].length)).toEqual([10, 1]);
    expect(authorizeMock.mock.calls.flatMap((call) => call[3]).filter((id) => id === "image-0")).toHaveLength(1);
  });

  it("keeps a refreshed-token task when an older authorization finishes later", async () => {
    // 测试目标：验证访问令牌刷新后，新授权任务替换旧任务；旧任务迟到时不能覆盖新资源或触发重复加载。
    // 构造方法：让旧令牌和新令牌的授权分别等待独立闸门，先启动旧任务，再启动并完成新任务，最后放行旧任务。
    // 输入数据：相同用户、会话和附件 token-image，旧令牌 old-token 与新令牌 new-token；浏览器适配器返回 Blob URL。
    // 预期行为：新令牌资源留在协调器中，旧 Blob 被撤销，后续新令牌请求复用新资源且不再请求授权。
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    authorizeMock.mockImplementation((_url: string, token: string, _conversation: number, ids: string[]) => new Promise<ReturnType<typeof authorizations>>((resolve) => {
      if (token === "old-token") releaseOld = () => resolve(authorizations(ids));
      else releaseNew = () => resolve(authorizations(ids));
    }));
    let blobSequence = 0;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:image-${++blobSequence}`) });
    const adapter = makeAdapter({ isDesktop: vi.fn(() => false) });
    const cache = new AttachmentResourceCache(adapter);

    const oldRequest = cache.loadMany({ ...context, accessToken: "old-token" }, ["token-image"]);
    await vi.waitFor(() => expect(authorizeMock).toHaveBeenCalledTimes(1));
    const newRequest = cache.loadMany({ ...context, accessToken: "new-token" }, ["token-image"]);
    await vi.waitFor(() => expect(authorizeMock).toHaveBeenCalledTimes(2));
    releaseNew();
    const [newResult] = await newRequest;
    releaseOld();
    const [oldResult] = await oldRequest;

    expect(newResult.resource?.src).toBe("blob:image-1");
    expect(oldResult.resource?.src).toBe("blob:image-2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-2");
    const [cachedResult] = await cache.loadMany({ ...context, accessToken: "new-token" }, ["token-image"]);
    expect(cachedResult.resource?.src).toBe("blob:image-1");
    expect(authorizeMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to an in-memory Blob in browser mode and revokes it when the authenticated page clears", async () => {
    // 测试目标：验证纯浏览器开发环境绕过 Rust 命令，仍可通过授权和 Blob URL 显示图片，并在登出清理。
    // 构造方法：设置适配器 isDesktop=false，加载一张图片后调用 clear。
    // 输入数据：附件 browser-image 与 fetchSignedImage 返回的 PNG Blob。
    // 预期行为：资源来源为 blob、磁盘方法不调用，clear 撤销该 Blob URL。
    const adapter = makeAdapter({ isDesktop: vi.fn(() => false) });
    const cache = new AttachmentResourceCache(adapter);
    const [result] = await cache.loadMany(context, ["browser-image"]);
    expect(result.resource?.source).toBe("blob");
    expect(adapter.lookup).not.toHaveBeenCalled();
    expect(adapter.download).not.toHaveBeenCalled();
    cache.clear();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.resource?.src);
  });

  it("falls back to network when SQLite is unavailable and allows one automatic recovery", async () => {
    // 测试目标：验证 SQLite/磁盘命令故障不阻断本次网络显示，并将自动失效恢复限制为一次。
    // 构造方法：让查询和磁盘下载均拒绝，首次加载使用 Blob 回退，再调用 recoverOnce 两次。
    // 输入数据：附件 fallback-image，cache_unavailable 错误，授权仍返回有效签名 URL。
    // 预期行为：首次和一次修复可得到 Blob 资源；第二次自动修复拒绝为 recovery_exhausted，失效命令仅尝试一次。
    const adapter = makeAdapter({
      lookup: vi.fn(async () => { throw new Error("cache_unavailable"); }),
      download: vi.fn(async () => { throw new Error("cache_unavailable"); }),
    });
    const cache = new AttachmentResourceCache(adapter);
    const [initial] = await cache.loadMany(context, ["fallback-image"]);
    expect(initial.resource?.source).toBe("blob");
    const recovered = await cache.recoverOnce(context, "fallback-image");
    expect(recovered.source).toBe("blob");
    expect(recovered.src).not.toContain("?retry=");
    await expect(cache.recoverOnce(context, "fallback-image")).rejects.toThrow("image_recovery_exhausted");
    expect(adapter.invalidate).toHaveBeenCalledTimes(1);
  });

  it("shares one bounded decode recovery for multiple consumers of the same attachment key", async () => {
    // 测试目标：验证同一附件被多个 img 同时报告解码失败时共享单个恢复任务，避免预算被并发消费者重复消耗。
    // 构造方法：首次加载 asset 命中后并发调用两次 recoverOnce，使用同一缓存键和延迟失效命令形成重叠。
    // 输入数据：会话 9 中重复引用的附件 shared-image，SQLite 返回固定文件路径。
    // 预期行为：两次恢复获得相同带 cache-buster 的 asset URL，invalidate 只执行一次，后续额外自动恢复被拒绝。
    let release!: () => void;
    const adapter = makeAdapter({
      lookup: vi.fn(async (_key, ids: string[]) => ids.map((attachmentId: string) => ({ attachmentId, filePath: `C:/cache/${attachmentId}.png` }))),
      invalidate: vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); }),
    });
    const cache = new AttachmentResourceCache(adapter);
    await cache.loadMany(context, ["shared-image"]);
    const first = cache.recoverOnce(context, "shared-image");
    const second = cache.recoverOnce(context, "shared-image");
    await vi.waitFor(() => expect(adapter.invalidate).toHaveBeenCalledTimes(1));
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.src).toBe(secondResult.src);
    expect(firstResult.src).toContain("?retry=");
    await expect(cache.recoverOnce(context, "shared-image")).rejects.toThrow("image_recovery_exhausted");
  });

  it("does not restart a recovery after logout clears the coordinator", async () => {
    // 测试目标：验证登出时清空协调器会阻止尚未完成的解码恢复继续申请授权或重建内存资源。
    // 构造方法：先加载一张 asset 图片，暂停失效命令，再清空协调器并放行该命令。
    // 输入数据：附件 logout-image，以及一次等待中的 recoverOnce 请求。
    // 预期行为：恢复以 cache_cleared 结束，不再次申请下载授权，也不创建 Blob URL。
    let release!: () => void;
    const adapter = makeAdapter({
      lookup: vi.fn(async (_key, ids: string[]) => ids.map((attachmentId) => ({ attachmentId, filePath: `C:/cache/${attachmentId}.png` }))),
      invalidate: vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); }),
    });
    const cache = new AttachmentResourceCache(adapter);
    await cache.loadMany(context, ["logout-image"]);
    const recovery = cache.recoverOnce(context, "logout-image");
    await vi.waitFor(() => expect(adapter.invalidate).toHaveBeenCalledTimes(1));

    cache.clear();
    release();

    await expect(recovery).rejects.toThrow("cache_cleared");
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("keeps per-image failures independent and uses a fresh signed authorization for a manual retry", async () => {
    // 测试目标：验证批次中的单张图片失败不会丢弃其他成功资源，且手动重试会重新授权该图片。
    // 构造方法：首轮授权失败，第二次授权成功并由磁盘下载保存；另让另一个附件的签名下载失败。
    // 输入数据：bad-image 和 retry-image；retry-image 的首轮授权 API 暂时拒绝，手动重试返回成功授权。
    // 预期行为：错误只属于失败项，手动重试最终得到 asset URL，授权调用只处理当前请求的附件。
    let downloadCount = 0;
    const adapter = makeAdapter({ download: vi.fn(async (_key, auths: Array<{ attachmentId: string }>) => {
      downloadCount += 1;
      return auths.map((auth) => ({ attachmentId: auth.attachmentId, filePath: auth.attachmentId === "bad-image" && downloadCount === 1 ? null : `C:/cache/${auth.attachmentId}` }));
    }) });
    authorizeMock.mockImplementationOnce(async (_url: string, _token: string, _conversation: number, ids: string[]) => authorizations(ids));
    fetchImageMock.mockRejectedValueOnce(new Error("download_failed"));
    const cache = new AttachmentResourceCache(adapter);
    const [bad, good] = await cache.loadMany(context, ["bad-image", "retry-image"]);
    expect(bad.error).toBeDefined();
    expect(good.resource?.source).toBe("asset");
    const retried = await cache.retry(context, "bad-image");
    expect(retried.source).toBe("asset");
    expect(authorizeMock).toHaveBeenCalledTimes(2);
  });
});
