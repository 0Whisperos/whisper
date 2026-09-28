import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatApiError } from "../api";
import type { ChatFriendDto } from "../types";
import type { AuthSession } from "../../login/types";
import { insertPendingTextMessage } from "./messageTimeline";
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
      lastSeq: 2,
      deliveredSeq: 2,
      readSeq: 0,
      peerDeliveredSeq: 0,
      peerReadSeq: 0,
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

  it("loads older pages with the server cursor and stops when there are no more messages", async () => {
    // 测试目标：验证首屏分页游标驱动后续历史请求，且 hasMore=false 后不会继续请求。
    // 构造方法：首屏返回序号 100 和 nextBeforeSeq=100，再依次返回序号 50 与序号 1 的两页历史。
    // 输入数据：三页游标分别为 100、50、无；前两页 hasMore=true，最后一页 hasMore=false。
    // 预期行为：请求依次使用 beforeSeq=100、50，消息按序号合并，结束后不会再调用接口。
    mockBootstrap();
    const message = (sequence: number) => ({
      messageId: `message-${sequence}`,
      conversationId: 42,
      conversationSeq: sequence,
      senderUserId: 20002,
      clientMessageId: `client-${sequence}`,
      messageType: "text" as const,
      content: { text: `消息 ${sequence}` },
      createdAt: `2026-08-28T10:${String(sequence % 60).padStart(2, "0")}:00+08:00`,
    });
    loadConversationMessagesMock
      .mockResolvedValueOnce({ messages: [message(100)], hasMore: true, nextBeforeSeq: 100, lastSeq: 100, deliveredSeq: 100, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 })
      .mockResolvedValueOnce({ messages: [message(50)], hasMore: true, nextBeforeSeq: 50, lastSeq: 100, deliveredSeq: 100, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 })
      .mockResolvedValueOnce({ messages: [message(1)], hasMore: false, lastSeq: 100, deliveredSeq: 100, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 });

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => { await result.current.loadHistory(42); });
    expect(result.current.hasMoreHistory(42)).toBe(true);

    await act(async () => { await result.current.loadOlderHistory(42); });
    await act(async () => { await result.current.loadOlderHistory(42); });
    await act(async () => { await result.current.loadOlderHistory(42); });

    expect(loadConversationMessagesMock).toHaveBeenNthCalledWith(2, "http://api.test", "jwt-token", 42, { beforeSeq: 100, limit: 50 });
    expect(loadConversationMessagesMock).toHaveBeenNthCalledWith(3, "http://api.test", "jwt-token", 42, { beforeSeq: 50, limit: 50 });
    expect(loadConversationMessagesMock).toHaveBeenCalledTimes(3);
    expect(result.current.hasMoreHistory(42)).toBe(false);
    expect(result.current.data?.conversations[42].messages.map((item) => item.conversationSeq)).toEqual([1, 50, 100]);
  });

  it("deduplicates concurrent older-page requests and retries the same cursor after failure", async () => {
    // 测试目标：验证快速重复触顶共享同一请求，旧页失败后重试仍使用原游标。
    // 构造方法：首屏游标设为 12，延迟首个旧页请求后并发触发两次，再令请求失败并执行 retryHistory。
    // 输入数据：conversationId=42、beforeSeq=12；失败后重试响应序号 1 且 hasMore=false。
    // 预期行为：并发阶段只发一个请求，失败后重试再次以 beforeSeq=12 请求，最终保留首屏并合并旧消息。
    mockBootstrap();
    const olderMessage = {
      messageId: "message-1", conversationId: 42, conversationSeq: 1, senderUserId: 20002,
      clientMessageId: "client-1", messageType: "text" as const, content: { text: "更早消息" },
      createdAt: "2026-08-28T10:01:00+08:00",
    };
    loadConversationMessagesMock
      .mockResolvedValueOnce({ messages: [{ ...olderMessage, messageId: "message-12", conversationSeq: 12 }], hasMore: true, nextBeforeSeq: 12, lastSeq: 12, deliveredSeq: 12, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 })
      .mockRejectedValueOnce(new ChatApiError("network_error"))
      .mockResolvedValueOnce({ messages: [olderMessage], hasMore: false, lastSeq: 12, deliveredSeq: 12, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 });

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => { await result.current.loadHistory(42); });
    await act(async () => {
      await Promise.all([result.current.loadOlderHistory(42), result.current.loadOlderHistory(42)]);
    });
    expect(loadConversationMessagesMock).toHaveBeenCalledTimes(2);
    expect(result.current.historyError(42)?.code).toBe("network_error");

    await act(async () => { await result.current.retryHistory(42); });

    expect(loadConversationMessagesMock).toHaveBeenNthCalledWith(3, "http://api.test", "jwt-token", 42, { beforeSeq: 12, limit: 50 });
    expect(result.current.historyError(42)).toBeNull();
    expect(result.current.data?.conversations[42].messages.map((item) => item.conversationSeq)).toEqual([1, 12]);
  });

  it("fills every sequence after the local delivered cursor before advancing it", async () => {
    // 测试目标：验证冷启动只返回最近消息时，客户端仍从自己的 delivered_seq 后补齐连续消息。
    // 构造方法：首屏返回最近序号 3 和 delivered_seq=1，再让 from_seq 请求返回序号 2、3。
    // 输入数据：last_seq=3、delivered_seq=1、from_seq=2，消息序号 2 和 3。
    // 预期行为：历史补齐到连续序号 3，loadHistory 返回待确认游标 3，但本地游标仍反映服务端已存值 1。
    mockBootstrap();
    loadConversationMessagesMock
      .mockResolvedValueOnce({
        messages: [{ messageId: "message-3", conversationId: 42, conversationSeq: 3, senderUserId: 20002, clientMessageId: "c3", messageType: "text", content: { text: "第三条" }, createdAt: "2026-08-28T10:03:00+08:00" }],
        hasMore: true,
        lastSeq: 3,
        deliveredSeq: 1,
        readSeq: 0,
        peerDeliveredSeq: 0,
        peerReadSeq: 0,
      })
      .mockResolvedValueOnce({
        messages: [
          { messageId: "message-2", conversationId: 42, conversationSeq: 2, senderUserId: 20001, clientMessageId: "c2", messageType: "text", content: { text: "第二条" }, createdAt: "2026-08-28T10:02:00+08:00" },
          { messageId: "message-3", conversationId: 42, conversationSeq: 3, senderUserId: 20002, clientMessageId: "c3", messageType: "text", content: { text: "第三条" }, createdAt: "2026-08-28T10:03:00+08:00" },
        ],
        hasMore: false,
        lastSeq: 3,
        deliveredSeq: 1,
        readSeq: 0,
        peerDeliveredSeq: 0,
        peerReadSeq: 0,
      });

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let deliveredSeq: number | null = null;
    await act(async () => {
      deliveredSeq = await result.current.loadHistory(42);
    });

    expect(loadConversationMessagesMock).toHaveBeenNthCalledWith(2, "http://api.test", "jwt-token", 42, { fromSeq: 2, limit: 50 });
    expect(deliveredSeq).toBe(3);
    expect(result.current.data?.conversations[42].deliveredSeq).toBe(1);
    expect(result.current.data?.conversations[42].messages.map((message) => message.conversationSeq)).toEqual([2, 3]);
  });

  it("merges a pending self message when a concurrent history response arrives first", async () => {
    // 测试目标：验证历史拉取与发送确认交错时，历史中的正式消息会折叠已有本地临时气泡。
    // 构造方法：延迟会话历史响应，开始加载后插入 sending 消息，再先返回相同 client_message_id 的正式历史记录。
    // 输入数据：会话 42、client_message_id=client-pending-1，以及服务端 message_id=message-9、sequence=9。
    // 预期行为：历史完成后仅保留一条 stable localKey 的 accepted 正式消息，不遗留 sending 重复气泡。
    mockBootstrap();
    let resolveHistory: (value: {
      messages: Array<{
        messageId: string;
        conversationId: number;
        conversationSeq: number;
        senderUserId: number;
        clientMessageId: string;
        messageType: "text";
        content: { text: string };
        createdAt: string;
      }>;
      hasMore: boolean;
      lastSeq: number;
      deliveredSeq: number;
      readSeq: number;
      peerDeliveredSeq: number;
      peerReadSeq: number;
    }) => void = () => undefined;
    loadConversationMessagesMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve;
    }));

    const { result } = renderHook(() => useChatData("http://api.test", session));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let history: Promise<number | null> = Promise.resolve(null);
    act(() => {
      history = result.current.loadHistory(42);
    });
    act(() => {
      result.current.updateData((current) => current ? insertPendingTextMessage(current, {
        conversationId: 42,
        senderUserId: 20001,
        clientMessageId: "client-pending-1",
        text: "竞态消息",
        clientSentAt: "2026-08-30T08:00:00.000+08:00",
      }) : current);
    });
    await act(async () => {
      resolveHistory({
        messages: [{
          messageId: "message-9",
          conversationId: 42,
          conversationSeq: 9,
          senderUserId: 20001,
          clientMessageId: "client-pending-1",
          messageType: "text",
          content: { text: "竞态消息" },
          createdAt: "2026-08-30T08:00:01.000+08:00",
        }],
        hasMore: false,
        lastSeq: 9,
        deliveredSeq: 9,
        readSeq: 0,
        peerDeliveredSeq: 0,
        peerReadSeq: 0,
      });
      await history;
    });

    expect(result.current.data?.conversations[42].messages).toEqual([
      expect.objectContaining({ localKey: "local:client-pending-1", messageId: "message-9", localStatus: "accepted" }),
    ]);
  });

  it("keeps history errors retryable without discarding the bootstrap data", async () => {
    // 测试目标：验证历史失败只记录会话级错误，重试成功后清除错误并保留已登录数据。
    // 构造方法：第一次历史请求拒绝 not_conversation_member，随后替换为成功的空历史页并点击 retryHistory。
    // 输入数据：conversationId=42，第一次返回 stable error code，第二次返回 messages=[]。
    // 预期行为：好友/会话数据仍存在，错误可观察，重试后错误清除且空历史保持为空。
    mockBootstrap();
    loadConversationMessagesMock
      .mockRejectedValueOnce(new ChatApiError("not_conversation_member"))
      .mockResolvedValueOnce({ messages: [], hasMore: false, lastSeq: 0, deliveredSeq: 0, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 });

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
