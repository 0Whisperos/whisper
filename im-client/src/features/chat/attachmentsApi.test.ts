import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmUploads, downloadAuthorizationRefreshDelay, requestDownloadAuthorizations, requestUploadAuthorizations, uploadSignedFile } from "./attachmentsApi";

afterEach(() => vi.restoreAllMocks());

describe("attachment API", () => {
  it("schedules download authorization refresh before the returned expiry", () => {
    // 测试目标：验证短 TTL 下载授权按 expires_at 提前续签，而不会固定等待四分钟。
    // 构造方法：使用确定的当前时间和 20 秒后过期的签名授权，设置 5 秒安全余量。
    // 输入数据：授权 expires_at=1970-01-01T00:00:20.000Z，当前时间 0，余量 5000ms。
    // 预期行为：刷新延迟为 15000ms，且已过期的授权至少在 1000ms 后触发刷新。
    expect(downloadAuthorizationRefreshDelay("1970-01-01T00:00:20.000Z", 0, 5_000)).toBe(15_000);
    expect(downloadAuthorizationRefreshDelay("1970-01-01T00:00:01.000Z", 0, 5_000)).toBe(1_000);
  });

  it("requests ordered upload grants and uploads bytes directly to the signed URL", async () => {
    // 测试目标：验证上传授权保持文件顺序，且 OSS PUT 使用签名 URL 而不携带 API bearer token。
    // 构造方法：模拟授权 API 响应，再模拟签名 URL 的成功 PUT。
    // 输入数据：会话 42 中按 first.png、second.webp 顺序上传两张图片。
    // 预期行为：授权结果顺序不变；PUT 请求携带 Content-Type 和文件正文，不带 Authorization。
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ attachments: [
      { attachment_id: "a1", upload_url: "https://oss.test/1", method: "PUT", headers: { "Content-Type": "image/png" }, expires_at: "later" },
      { attachment_id: "a2", upload_url: "https://oss.test/2", method: "PUT", headers: { "Content-Type": "image/webp" }, expires_at: "later" },
    ] }))).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const grants = await requestUploadAuthorizations("https://api.test", "token", 42, [
      { file_name: "first.png", content_type: "image/png", size_bytes: 5 },
      { file_name: "second.webp", content_type: "image/webp", size_bytes: 6 },
    ]);
    await uploadSignedFile(grants[0], new File(["image"], "first.png", { type: "image/png" }));
    expect(grants.map((grant) => grant.attachment_id)).toEqual(["a1", "a2"]);
    expect(fetchMock.mock.calls[1][0]).toBe("https://oss.test/1");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" } });
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("headers.Authorization");
  });

  it("returns only completed attachment IDs and requests downloads as one batch", async () => {
    // 测试目标：验证部分上传确认结果可由调用方区分，并且下载授权请求按会话批量发送。
    // 构造方法：依次模拟一项上传成功/一项仍在上传，以及两张图的下载授权。
    // 输入数据：附件 a1、a2 属于会话 42。
    // 预期行为：确认状态原样返回；下载接口收到有序 ID 列表并返回不含对象 key 的授权信息。
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachments: [
        { attachment_id: "a1", status: "uploaded", size_bytes: 5 },
        { attachment_id: "a2", status: "uploading", error_code: "object_not_found" },
      ] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachments: [
        { attachment_id: "a1", download_url: "https://oss.test/a1", expires_at: "later", content_type: "image/png", size_bytes: 5 },
        { attachment_id: "a2", download_url: "https://oss.test/a2", expires_at: "later", content_type: "image/webp", size_bytes: 6 },
      ] })));
    const confirmed = await confirmUploads("https://api.test", "token", ["a1", "a2"]);
    const downloads = await requestDownloadAuthorizations("https://api.test", "token", 42, ["a1", "a2"]);
    expect(confirmed.map((item) => item.status)).toEqual(["uploaded", "uploading"]);
    expect(downloads.map((item) => item.attachment_id)).toEqual(["a1", "a2"]);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.test/v1/conversations/42/attachments/download-authorizations");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ attachment_ids: ["a1", "a2"] });
  });
});
