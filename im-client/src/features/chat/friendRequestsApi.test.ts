import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFriendRequest, loadFriendRequests, respondToFriendRequest, searchUserByAccount } from "./friendRequestsApi";

describe("friend request HTTP API", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("loads incoming request pages and maps the cursor and pending count", async () => {
    // 测试目标：验证收到的申请分页参数和响应映射正确。
    // 构造方法：mock 第一页响应，调用 incoming 列表 API。
    // 输入数据：请求含 request_id 字符串、双方公开资料、pending 状态、pending_count=3 和游标 next-1。
    // 预期行为：请求带 Bearer token 与 limit=20，映射结果保留双方资料、全局待处理数和下一页游标。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      requests: [{ request_id: "1844674407370955161", sender: profile(2, "bob"), recipient: profile(1, "alice"), verification_message: "你好", status: "pending", created_at: "2026-10-05T10:00:00Z" }],
      pending_count: 3, next_cursor: "next-1", has_more: true,
    }), { status: 200 }));

    await expect(loadFriendRequests("https://api.test/", "token", "incoming")).resolves.toMatchObject({
      pendingCount: 3, nextCursor: "next-1", hasMore: true,
      requests: [{ requestId: "1844674407370955161", sender: { userId: 2 }, recipient: { userId: 1 }, status: "pending" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/friend-requests?direction=incoming&limit=20", { headers: { Authorization: "Bearer token" } });
  });

  it("searches accounts, submits verification and responds to a request", async () => {
    // 测试目标：验证账号搜索、添加申请以及同意/拒绝动作使用约定的 HTTP 路径和 JSON 字段。
    // 构造方法：依次 mock 搜索 profile 与三个成功的写入响应，再调用对应 API 封装。
    // 输入数据：账号 bob、验证信息“你好”及字符串 request_id=1844674407370955161。
    // 预期行为：搜索映射公开资料，提交请求发送验证文本，同意和拒绝使用对应动作 URL。
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(profile(2, "bob")), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(searchUserByAccount("https://api.test", "token", "bob")).resolves.toMatchObject({ userId: 2, account: "bob" });
    await createFriendRequest("https://api.test", "token", "bob", "你好");
    await respondToFriendRequest("https://api.test", "token", "1844674407370955161", "accept");
    await respondToFriendRequest("https://api.test", "token", "1844674407370955161", "reject");

    expect(fetchMock.mock.calls[1]).toMatchObject(["https://api.test/v1/friend-requests", { method: "POST", body: JSON.stringify({ account: "bob", verification_message: "你好" }) }]);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.test/v1/friend-requests/1844674407370955161/accept");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://api.test/v1/friend-requests/1844674407370955161/reject");
  });

  it("returns null when the account does not exist", async () => {
    // 测试目标：验证账号搜索遇到 404 时返回未找到结果而非网络错误。
    // 构造方法：mock 搜索接口返回 404，并请求该账号。
    // 输入数据：账号 missing。
    // 预期行为：API 返回 null，供搜索界面显示“没有找到该用户”。
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(searchUserByAccount("https://api.test", "token", "missing")).resolves.toBeNull();
  });
});

function profile(userId: number, account: string) {
  return { user_id: userId, account, nickname: account.toUpperCase(), signature: "签名", avatar_object_key: null };
}
