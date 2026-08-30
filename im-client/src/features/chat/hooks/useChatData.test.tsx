import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatApiError } from "../api";
import type { ChatFriendDto } from "../types";
import type { AuthSession } from "../../login/types";
import { useChatData } from "./useChatData";

const { loadCurrentUserMock, loadFriendsMock, loadConversationMessagesMock } = vi.hoisted(() => ({
  loadCurrentUserMock: vi.fn(),
  loadFriendsMock: vi.fn(),
  loadConversationMessagesMock: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    loadCurrentUser: loadCurrentUserMock,
    loadFriends: loadFriendsMock,
    loadConversationMessages: loadConversationMessagesMock,
  };
});

const session: AuthSession = {
  userId: 20001,
  accessToken: "jwt-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-28T12:00:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
  refreshTokenPersistence: "session_only",
};

function mockBootstrap(friends: ChatFriendDto[] = [{
  userId: 20002,
  account: "zhou ran",
  nickname: "周然",
  signature: "",
  avatarObjectKey: null,
  friendshipState: "active" as const,
  conversationId: 42,
}]) {
  loadCurrentUserMock.mockResolvedValue({
    userId: 20001,
    account: "linxiao",
    nickname: "林晓",
    signature: "在路上",
    avatarObjectKey: null,
  });
  loadFriendsMock.mockResolvedValue(friends);
}

describe("useChatData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds real contacts and direct sessions after bootstrap", async () => {
    // 测试目标：验证登录后的 me/friends 数据生成真实联系人、直聊会话和资料模型。
    // 构造方法：mock 当前用户与一个 active 好友，使用 renderHook 挂载数据 hook。
    // 输入数据：好友 userId=20002、nickname=周然、conversationId=42，当前用户带 signature。
    // 预期行为：加载完成后联系人和会话来自 API，昵称优先于账号，好友状态为“状态未知”。
    mockBootstrap();

    const { result } = renderHook(() => useChatData("http://api.test", session));

    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.data?.self).toMatchObject({ userId: 20001, name: "林晓", signature: "在路上" });
    expect(result.current.data?.contacts).toHaveLength(1);
    expect(result.current.data?.contacts[0]).toMatchObject({ name: "周然", status: "状态未知", conversationId: 42 });
    expect(result.current.data?.sessions).toHaveLength(1);
    expect(result.current.data?.sessions[0]).toMatchObject({ conversationId: 42, type: "direct", name: "周然" });
    expect(loadCurrentUserMock).toHaveBeenCalledWith("http://api.test", "jwt-token");
    expect(loadFriendsMock).toHaveBeenCalledWith("http://api.test", "jwt-token");
  });

  it("keeps a friend without a conversation out of the session list", async () => {
    // 测试目标：验证好友存在但服务端没有对应会话时仍展示联系人，不伪造会话 ID。
    // 构造方法：mock 一个 conversationId=null 的 active 好友并等待 bootstrap 完成。
    // 输入数据：好友 userId=20003、nickname 为空、account=chenmo、conversationId=null。
    // 预期行为：联系人使用账号作为名称，会话列表为空且不会创建虚假的聊天记录入口。
    mockBootstrap([{
      userId: 20003,
      account: "chenmo",
      nickname: "",
      signature: "",
      avatarObjectKey: null,
      friendshipState: "active",
      conversationId: null,
    }]);

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.data?.contacts[0]).toMatchObject({ name: "chenmo", conversationId: undefined });
    expect(result.current.data?.sessions).toEqual([]);
  });

  it("loads history once, sorts it, and removes duplicate message ids", async () => {
    // 测试目标：验证会话首次进入按需加载历史，按 conversation_seq 排序并按 message_id 去重。
    // 构造方法：bootstrap 一个会话，返回乱序且含重复 ID 的历史页，再重复调用 loadHistory。
    // 输入数据：消息序号 2、1、2，重复消息 ID 为 message-2，接口只返回一次页面。
    // 预期行为：内存消息按序号为 1、2，第二次进入不再发起网络请求，并更新会话预览。
    mockBootstrap();
    loadConversationMessagesMock.mockResolvedValueOnce({
      messages: [
        { messageId: "message-2", conversationId: 42, conversationSeq: 2, senderUserId: 20002, clientMessageId: "c2", messageType: "text", content: { text: "第二条" }, createdAt: "2026-08-28T10:02:00+08:00" },
        { messageId: "message-1", conversationId: 42, conversationSeq: 1, senderUserId: 20001, clientMessageId: "c1", messageType: "text", content: { text: "第一条" }, createdAt: "2026-08-28T10:01:00+08:00" },
        { messageId: "message-2", conversationId: 42, conversationSeq: 2, senderUserId: 20002, clientMessageId: "c2-new", messageType: "text", content: { text: "第二条更新" }, createdAt: "2026-08-28T10:02:00+08:00" },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      await result.current.loadHistory(42);
      await result.current.loadHistory(42);
    });

    expect(loadConversationMessagesMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.conversations[42].messages.map((message) => [message.messageId, message.conversationSeq])).toEqual([
      ["message-1", 1],
      ["message-2", 2],
    ]);
    expect(result.current.data?.sessions[0]).toMatchObject({ preview: "第二条更新" });
  });

  it("keeps history errors retryable without discarding the bootstrap data", async () => {
    // 测试目标：验证历史失败只记录会话级错误，重试成功后清除错误并保留已登录数据。
    // 构造方法：第一次历史请求拒绝 not_conversation_member，随后替换为成功的空历史页并点击 retryHistory。
    // 输入数据：conversationId=42，第一次返回 stable error code，第二次返回 messages=[]。
    // 预期行为：好友/会话数据仍存在，错误可观察，重试后错误清除且空历史保持为空。
    mockBootstrap();
    loadConversationMessagesMock
      .mockRejectedValueOnce(new ChatApiError("not_conversation_member"))
      .mockResolvedValueOnce({ messages: [], hasMore: false });

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      await result.current.loadHistory(42);
    });

    expect(result.current.historyError(42)?.code).toBe("not_conversation_member");
    expect(result.current.data?.contacts).toHaveLength(1);

    await act(async () => {
      await result.current.retryHistory(42);
    });

    expect(result.current.historyError(42)).toBeNull();
    expect(result.current.data?.conversations[42].messages).toEqual([]);
    expect(loadConversationMessagesMock).toHaveBeenCalledTimes(2);
  });
});
