import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatApiError,
  loadConversationMessages,
  loadCurrentUser,
  loadFriends,
} from "./api";

describe("chat HTTP API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads the current profile with a Bearer token and maps the DTO", async () => {
    // 测试目标：验证当前用户接口使用 Bearer 鉴权，并将 snake_case 资料转换为客户端模型。
    // 构造方法：替换 fetch 返回成功的 /v1/me JSON 响应，再调用资料 API。
    // 输入数据：accessToken=jwt-token，服务端返回 user_id、nickname、signature 和 avatar_object_key。
    // 预期行为：请求带 Authorization 头，结果字段转换为 userId/avatarObjectKey。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      user_id: 20001,
      account: "linxiao",
      nickname: "林晓",
      signature: "在路上",
      avatar_object_key: "avatars/20001.png",
    }), { status: 200 }));

    await expect(loadCurrentUser("http://127.0.0.1:8080/", "jwt-token")).resolves.toEqual({
      userId: 20001,
      account: "linxiao",
      nickname: "林晓",
      signature: "在路上",
      avatarObjectKey: "avatars/20001.png",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8080/v1/me", {
      headers: { Authorization: "Bearer jwt-token" },
    });
  });

  it("loads active friends and preserves nullable conversation ids", async () => {
    // 测试目标：验证好友列表路径、Bearer 头和好友/会话 DTO 映射。
    // 构造方法：替换 fetch 返回包含一个已建会话好友和一个无会话好友的响应。
    // 输入数据：friends 中包含 friendship_state=active、conversation_id=42 和 null 两种情况。
    // 预期行为：返回 camelCase 好友对象，并保留无对应会话的 null。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ friends: [
      {
        user_id: 20002,
        account: "zhou ran",
        nickname: "周然",
        signature: "",
        avatar_object_key: null,
        friendship_state: "active",
        conversation_id: 42,
      },
      {
        user_id: 20003,
        account: "chenmo",
        nickname: "",
        signature: "",
        avatar_object_key: null,
        friendship_state: "active",
        conversation_id: null,
      },
    ] }), { status: 200 }));

    await expect(loadFriends("http://api.test", "jwt-token")).resolves.toEqual([
      expect.objectContaining({ userId: 20002, conversationId: 42, friendshipState: "active" }),
      expect.objectContaining({ userId: 20003, conversationId: null, friendshipState: "active" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/v1/friends", {
      headers: { Authorization: "Bearer jwt-token" },
    });
  });

  it("requests cursor pagination and maps text messages", async () => {
    // 测试目标：验证历史消息接口正确编码 before_seq/from_seq/limit，并转换消息游标字段。
    // 构造方法：替换 fetch 返回一页 text 消息，再传入 beforeSeq 和 limit 查询参数。
    // 输入数据：conversationId=42、beforeSeq=9、limit=50，以及 conversation_seq=8 的消息。
    // 预期行为：请求 URL 带分页参数，返回 messageId/conversationSeq 等客户端字段。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      messages: [{
        message_id: "message-8",
        conversation_id: 42,
        conversation_seq: 8,
        sender_user_id: 20002,
        client_message_id: "client-8",
        message_type: "text",
        content: { text: "你好" },
        created_at: "2026-08-28T10:00:00+08:00",
      }],
      has_more: true,
      next_before_seq: 8,
    }), { status: 200 }));

    await expect(loadConversationMessages("http://api.test", "jwt-token", 42, {
      beforeSeq: 9,
      limit: 50,
    })).resolves.toEqual({
      messages: [expect.objectContaining({ messageId: "message-8", conversationSeq: 8 })],
      hasMore: true,
      nextBeforeSeq: 8,
      nextFromSeq: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/v1/conversations/42/messages?before_seq=9&limit=50",
      { headers: { Authorization: "Bearer jwt-token" } },
    );
  });

  it("maps stable server error codes to ChatApiError", async () => {
    // 测试目标：验证服务端稳定错误码不会被前端误当成普通网络错误。
    // 构造方法：替换 fetch 返回 403 及 not_conversation_member 错误结构。
    // 输入数据：conversationId=42、error_code=not_conversation_member。
    // 预期行为：API Promise 拒绝并携带同名 ChatApiError code。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error_code: "not_conversation_member",
      message: "forbidden",
    }), { status: 403 }));

    await expect(loadConversationMessages("http://api.test", "jwt-token", 42)).rejects.toEqual(
      new ChatApiError("not_conversation_member"),
    );
  });
});
