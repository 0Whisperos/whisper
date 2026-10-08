import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileApiError, saveCurrentProfile } from "./profileApi";

describe("profile HTTP API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("updates text fields directly when no avatar file is selected", async () => {
    // 测试目标：验证只修改昵称和个签时不会申请头像授权或上传文件。
    // 构造方法：让唯一一次 fetch 返回更新后的用户资料，再调用统一保存流程。
    // 输入数据：昵称“新昵称”、个签“新个签”、头像操作 keep。
    // 预期行为：只发送一次 PUT /v1/me/profile，且请求体省略 avatar_object_key。
    fetchMock.mockResolvedValueOnce(profileResponse({ nickname: "新昵称", signature: "新个签", avatar_object_key: null }));

    await expect(saveCurrentProfile("http://api.test/", "access-token", {
      nickname: "新昵称",
      signature: "新个签",
      avatar: { action: "keep" },
    })).resolves.toEqual(expect.objectContaining({ nickname: "新昵称", signature: "新个签" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/v1/me/profile");
    expect(init).toMatchObject({ method: "PUT", headers: { Authorization: "Bearer access-token" } });
    expect(JSON.parse(String(init?.body))).toEqual({ nickname: "新昵称", signature: "新个签" });
  });

  it("clears the avatar without requesting upload authorization", async () => {
    // 测试目标：验证恢复默认头像会显式提交 null，且不会申请上传授权。
    // 构造方法：准备头像 key 为空的资料更新响应，再以 remove 操作保存。
    // 输入数据：昵称“林澈”、个签“在路上”、头像操作 remove。
    // 预期行为：仅发送一次资料 PUT，请求体含 avatar_object_key=null。
    fetchMock.mockResolvedValueOnce(profileResponse({ avatar_object_key: null }));

    await saveCurrentProfile("http://api.test", "access-token", {
      nickname: "林澈",
      signature: "在路上",
      avatar: { action: "remove" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/v1/me/profile");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      nickname: "林澈",
      signature: "在路上",
      avatar_object_key: null,
    });
  });

  it("authorizes, uploads, and then commits a changed avatar", async () => {
    // 测试目标：验证头像变更严格按申请授权、直传对象存储、提交资料的顺序执行。
    // 构造方法：依次准备上传授权响应、OSS PUT 成功响应和资料更新响应。
    // 输入数据：裁剪生成的 avatar.png 文件、服务端生成的 avatars/7/new.png 对象 key。
    // 预期行为：第三个请求才更新资料，并携带授权接口返回的 avatar_object_key。
    const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object_key: "avatars/7/new.png",
        upload_url: "https://storage.test/upload",
        method: "PUT",
        headers: { "Content-Type": "image/png", "x-amz-meta-kind": "avatar" },
        expires_at: "2026-10-06T12:05:00+08:00",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(profileResponse({ avatar_object_key: "avatars/7/new.png" }));

    await expect(saveCurrentProfile("http://api.test", "access-token", {
      nickname: "林澈",
      signature: "在路上",
      avatar: { action: "replace", file },
    })).resolves.toEqual(expect.objectContaining({ avatarObjectKey: "avatars/7/new.png" }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/v1/me/avatar-upload-authorization");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      content_type: "image/png",
    });
    expect(fetchMock.mock.calls[1]).toEqual(["https://storage.test/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/png", "x-amz-meta-kind": "avatar" },
      body: file,
    }]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      nickname: "林澈",
      signature: "在路上",
      avatar_object_key: "avatars/7/new.png",
    });
  });

  it("does not commit profile text when direct upload fails", async () => {
    // 测试目标：验证头像直传失败会中止整个资料保存，避免文字字段被部分提交。
    // 构造方法：让上传授权成功，但让对象存储 PUT 返回 403。
    // 输入数据：avatar.png 文件和拒绝上传的预签名 URL。
    // 预期行为：保存流程抛出 avatar_upload_failed，且不会发送第三个资料更新请求。
    const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object_key: "avatars/7/new.png",
        upload_url: "https://storage.test/rejected",
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        expires_at: "2026-10-06T12:05:00+08:00",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(saveCurrentProfile("http://api.test", "access-token", {
      nickname: "不会提交",
      signature: "不会提交",
      avatar: { action: "replace", file },
    })).rejects.toEqual(new ProfileApiError("avatar_upload_failed"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function profileResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    user_id: 7,
    account: "00000007",
    nickname: "林澈",
    signature: "",
    avatar_object_key: null,
    ...overrides,
  }), { status: 200 });
}
