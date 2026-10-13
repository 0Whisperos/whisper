import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, convertFileSrcMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  convertFileSrcMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: convertFileSrcMock,
  isTauri: isTauriMock,
}));

import { attachmentCacheAdapter, cacheAuthorization, normalizeAttachmentCacheApiBaseUrl } from "./attachmentCacheApi";

describe("attachment cache API adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    convertFileSrcMock.mockReset();
    isTauriMock.mockReset();
  });

  it("uses stable Tauri commands and normalized keys while converting only returned file paths", async () => {
    // 测试目标：验证缓存 API 将逻辑键转换为稳定 command DTO，并只在适配层把 Rust 返回路径转换为 asset URL。
    // 构造方法：替身 invoke/convertFileSrc，分别调用查询、下载和失效接口。
    // 输入数据：服务端地址末尾带斜杠，用户 7、会话 9、附件 image-1，授权含 URL、类型和大小。
    // 预期行为：command 名称、camelCase 参数和授权 DTO 完整匹配，地址尾斜杠被移除，路径交给 convertFileSrc。
    invokeMock.mockResolvedValue([]);
    convertFileSrcMock.mockReturnValue("asset://image");
    const key = { apiBaseUrl: "https://api.test///", userId: 7, conversationId: 9 };
    await attachmentCacheAdapter.lookup(key, ["image-1"]);
    expect(invokeMock).toHaveBeenLastCalledWith("lookup_chat_image_cache", {
      apiBaseUrl: "https://api.test", userId: 7, conversationId: 9, attachmentIds: ["image-1"],
    });
    await attachmentCacheAdapter.download(key, [{ attachmentId: "image-1", downloadUrl: "https://cdn/image", contentType: "image/png", sizeBytes: 12 }]);
    expect(invokeMock).toHaveBeenLastCalledWith("download_chat_images", {
      apiBaseUrl: "https://api.test", userId: 7, conversationId: 9,
      authorizations: [{ attachmentId: "image-1", downloadUrl: "https://cdn/image", contentType: "image/png", sizeBytes: 12 }],
    });
    await attachmentCacheAdapter.invalidate({ ...key, attachmentId: "image-1" });
    expect(invokeMock).toHaveBeenLastCalledWith("invalidate_chat_image_cache", {
      apiBaseUrl: "https://api.test", userId: 7, conversationId: 9, attachmentId: "image-1",
    });
    expect(attachmentCacheAdapter.toAssetUrl("C:/cache/image.png")).toBe("asset://image");
    expect(convertFileSrcMock).toHaveBeenCalledWith("C:/cache/image.png");
  });

  it("maps download authorization fields and detects the runtime without swallowing command failures", async () => {
    // 测试目标：验证服务端 snake_case 授权结构只在适配函数处映射，且运行时检测不会把 IPC 错误转换为浏览器环境。
    // 构造方法：使用下载授权 DTO、桌面检测替身，并让 command invoke 拒绝。
    // 输入数据：attachment_id=image-2、download_url=https://cdn/2、content_type=image/webp、size_bytes=20。
    // 预期行为：授权字段转为 Rust command 所需 camelCase；桌面检测原样返回，IPC 拒绝继续向调用方传播。
    expect(cacheAuthorization({ attachment_id: "image-2", download_url: "https://cdn/2", content_type: "image/webp", size_bytes: 20, expires_at: "later" }))
      .toEqual({ attachmentId: "image-2", downloadUrl: "https://cdn/2", contentType: "image/webp", sizeBytes: 20 });
    isTauriMock.mockReturnValue(true);
    expect(attachmentCacheAdapter.isDesktop()).toBe(true);
    invokeMock.mockRejectedValueOnce(new Error("cache_unavailable"));
    await expect(attachmentCacheAdapter.lookup({ apiBaseUrl: "https://api.test/", userId: 1, conversationId: 2 }, ["a"]))
      .rejects.toThrow("cache_unavailable");
  });

  it("normalizes only trailing slashes and preserves scheme, host, port, and API path", () => {
    // 测试目标：验证缓存命名空间保留不同服务端配置的关键部分，避免只按主机名合并缓存。
    // 构造方法：对包含协议、非默认端口和 API 路径的地址执行规范化。
    // 输入数据：https://API.test:8443/base/v1///。
    // 预期行为：只移除尾部斜杠，其余地址内容保持不变。
    expect(normalizeAttachmentCacheApiBaseUrl("https://API.test:8443/base/v1///")).toBe("https://API.test:8443/base/v1");
  });
});
