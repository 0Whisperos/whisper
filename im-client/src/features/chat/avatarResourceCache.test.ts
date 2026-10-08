import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarResourceCache } from "./avatarResourceCache";

describe("AvatarResourceCache", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const createObjectURL = vi.fn(() => "blob:shared-avatar");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shares one authorization, download, and Blob URL for concurrent consumers", async () => {
    // 测试目标：验证多个头像显示点并发读取同一 object_key 时共享底层请求和 Blob URL。
    // 构造方法：创建一个缓存实例，对同一 key 连续 acquire 两次，再依次 release。
    // 输入数据：avatars/7/current.png，以及一次授权响应和一次图片下载响应。
    // 预期行为：fetch 总计两次、createObjectURL 一次；最后一个消费者释放后才 revoke。
    fetchMock
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/avatar"))
      .mockResolvedValueOnce(new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }));
    const cache = new AvatarResourceCache();

    const first = cache.acquire("http://api.test", () => "access-token", "avatars/7/current.png");
    const second = cache.acquire("http://api.test", () => "access-token", "avatars/7/current.png");

    await expect(Promise.all([first, second])).resolves.toEqual(["blob:shared-avatar", "blob:shared-avatar"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    cache.release("avatars/7/current.png");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    cache.release("avatars/7/current.png");
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("requests a fresh signed URL once after a failed object download", async () => {
    // 测试目标：验证短期下载 URL 失效或下载失败时会重新签名并只重试一次。
    // 构造方法：第一次 GET 返回 403，第二次授权后的 GET 返回图片内容。
    // 输入数据：同一 object_key 对应 expired 和 refreshed 两条预签名 URL。
    // 预期行为：调用顺序为授权、失败下载、重新授权、成功下载，最终返回 Blob URL。
    fetchMock
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/refreshed"))
      .mockResolvedValueOnce(new Response(new Blob(["image-bytes"]), { status: 200 }));
    const cache = new AvatarResourceCache();

    await expect(cache.acquire("http://api.test", () => "access-token", "avatars/7/current.png"))
      .resolves.toBe("blob:shared-avatar");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://api.test/v1/me/avatar-download-authorization",
      "https://storage.test/expired",
      "http://api.test/v1/me/avatar-download-authorization",
      "https://storage.test/refreshed",
    ]);
    cache.clear();
  });

  it("releases a primed avatar when the authenticated page cache is cleared", async () => {
    // 测试目标：验证新头像预热后无需下载，并在退出登录或页面卸载时释放 Blob URL。
    // 构造方法：用已上传 File 预热 key，随后 acquire 并调用 clear 模拟会话结束。
    // 输入数据：avatars/7/new.webp 和一个 WebP File。
    // 预期行为：不发起 fetch，返回预热 URL，并在 clear 时恰好 revoke 一次。
    const cache = new AvatarResourceCache();
    cache.prime("avatars/7/new.webp", new File(["image"], "new.webp", { type: "image/webp" }));

    await expect(cache.acquire("http://api.test", () => "access-token", "avatars/7/new.webp"))
      .resolves.toBe("blob:shared-avatar");
    expect(fetchMock).not.toHaveBeenCalled();
    cache.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:shared-avatar");
  });
});

function downloadAuthorization(downloadUrl: string) {
  return new Response(JSON.stringify({
    object_key: "avatars/7/current.png",
    download_url: downloadUrl,
    expires_at: "2026-10-06T12:05:00+08:00",
  }), { status: 200 });
}
