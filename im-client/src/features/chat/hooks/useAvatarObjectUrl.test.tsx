import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarResourceCache } from "../avatarResourceCache";
import { useAvatarObjectUrl } from "./useAvatarObjectUrl";

describe("useAvatarObjectUrl", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:avatar") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the cached Blob URL when only the access token is refreshed", async () => {
    // 测试目标：验证 accessToken 续期不会释放并重新下载仍在使用的同一头像。
    // 构造方法：渲染头像 URL hook，等待首次下载完成后仅替换 token 并重新渲染。
    // 输入数据：固定 object_key，access-token-1 更新为 access-token-2。
    // 预期行为：URL 保持不变且 fetch 仍只有授权和图片下载两次；卸载时释放一次。
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object_key: "avatars/7/current.png",
        download_url: "https://storage.test/avatar",
        expires_at: "2026-10-06T12:05:00+08:00",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(["image"]), { status: 200 }));
    const cache = new AvatarResourceCache();
    const { result, rerender, unmount } = renderHook(
      ({ token }) => useAvatarObjectUrl(cache, "http://api.test", token, "avatars/7/current.png"),
      { initialProps: { token: "access-token-1" } },
    );

    await waitFor(() => expect(result.current).toBe("blob:avatar"));
    rerender({ token: "access-token-2" });

    expect(result.current).toBe("blob:avatar");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("uses the latest access token when a pending download requests a second authorization", async () => {
    // 测试目标：验证下载仍在进行时 token 更新，下一次重新签名会读取最新 token。
    // 构造方法：暂停第一次对象 GET，更新 hook 的 token 后让 GET 返回 403，触发第二次授权。
    // 输入数据：access-token-1 更新为 access-token-2，第一条下载 URL 失效，第二条成功。
    // 预期行为：第二个授权请求携带 Bearer access-token-2，最终加载同一头像 Blob。
    let resolveExpiredDownload: (response: Response) => void = () => undefined;
    const expiredDownload = new Promise<Response>((resolve) => {
      resolveExpiredDownload = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired"))
      .mockImplementationOnce(() => expiredDownload)
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/refreshed"))
      .mockResolvedValueOnce(new Response(new Blob(["image"]), { status: 200 }));
    const cache = new AvatarResourceCache();
    const { result, rerender, unmount } = renderHook(
      ({ token }) => useAvatarObjectUrl(cache, "http://api.test", token, "avatars/7/current.png"),
      { initialProps: { token: "access-token-1" } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    rerender({ token: "access-token-2" });
    resolveExpiredDownload(new Response(null, { status: 403 }));

    await waitFor(() => expect(result.current).toBe("blob:avatar"));
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer access-token-2" },
    });
    unmount();
  });

  it("automatically retries a failed avatar after a later access token refresh", async () => {
    // 测试目标：验证首次头像下载耗尽重试后，后续 token 更新能自动恢复而无需更换 object_key。
    // 构造方法：让旧 token 的两次对象 GET 都失败，确认失败完成后更新 token，并让新请求成功。
    // 输入数据：固定 object_key、失败的 access-token-1 和可用的 access-token-2。
    // 预期行为：token 更新后重新 acquire，授权使用新 token，最终返回 Blob URL 且没有重复引用泄漏。
    fetchMock
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired-1"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired-2"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/recovered"))
      .mockResolvedValueOnce(new Response(new Blob(["image"]), { status: 200 }));
    const cache = new AvatarResourceCache();
    const { result, rerender, unmount } = renderHook(
      ({ token }) => useAvatarObjectUrl(cache, "http://api.test", token, "avatars/7/current.png"),
      { initialProps: { token: "access-token-1" } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await act(async () => Promise.resolve());

    rerender({ token: "access-token-2" });

    await waitFor(() => expect(result.current).toBe("blob:avatar"));
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer access-token-2" },
    });
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("retries with a refreshed token when it changes during the final failed download", async () => {
    // 测试目标：验证 token 在第二次旧授权下载尚未失败时更新，也不会让头像卡在失败状态。
    // 构造方法：让第二次旧 token 下载等待，更新 token 后再返回 403，并为第三次授权准备成功响应。
    // 输入数据：固定 object_key、两次旧 token 授权失败以及一个新 token 的成功授权。
    // 预期行为：hook 自动重新申请授权并用新 token 下载，最终显示 Blob URL。
    let resolveFinalOldDownload: (response: Response) => void = () => undefined;
    const finalOldDownload = new Promise<Response>((resolve) => {
      resolveFinalOldDownload = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired-1"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/expired-2"))
      .mockImplementationOnce(() => finalOldDownload)
      .mockResolvedValueOnce(downloadAuthorization("https://storage.test/recovered"))
      .mockResolvedValueOnce(new Response(new Blob(["image"]), { status: 200 }));
    const cache = new AvatarResourceCache();
    const { result, rerender, unmount } = renderHook(
      ({ token }) => useAvatarObjectUrl(cache, "http://api.test", token, "avatars/7/current.png"),
      { initialProps: { token: "access-token-1" } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    rerender({ token: "access-token-2" });
    resolveFinalOldDownload(new Response(null, { status: 403 }));

    await waitFor(() => expect(result.current).toBe("blob:avatar"));
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer access-token-2" },
    });
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });
});

function downloadAuthorization(downloadUrl: string) {
  return new Response(JSON.stringify({
    object_key: "avatars/7/current.png",
    download_url: downloadUrl,
    expires_at: "2026-10-06T12:05:00+08:00",
  }), { status: 200 });
}
