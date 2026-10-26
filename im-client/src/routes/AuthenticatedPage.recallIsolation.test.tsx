import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedPage } from "./AuthenticatedPage";
import type { ChatData } from "../features/chat/types";
import type { AuthSession } from "../features/login/types";
import type { RecallTarget } from "../features/chat/hooks/useRecallStatusSync";

const { currentUser, friends, history, statuses, draftCallbacks, connectionOwners } = vi.hoisted(() => ({
  currentUser: vi.fn(), friends: vi.fn(), history: vi.fn(), statuses: vi.fn(),
  draftCallbacks: [] as Array<(targets: RecallTarget[]) => void>,
  connectionOwners: [] as Array<string | undefined>,
}));
vi.mock("../features/chat/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/chat/api")>(),
  loadCurrentUser: currentUser, loadFriends: friends, loadConversationMessages: history,
}));
vi.mock("../features/chat/messageRecallApi", () => ({ loadMessageRecallStatuses: statuses }));
vi.mock("../features/chat-connection/hooks/useChatConnection", () => ({
  useChatConnection: ({ session, owner }: { session: AuthSession; owner?: string }) => {
    connectionOwners.push(owner);
    return {
    state: { status: "authenticated", userId: session.userId, connectionId: `connection-${session.accessToken}` },
    sendTextMessage: vi.fn(), sendRichMessage: vi.fn(), sendRecallMessage: vi.fn(),
    sendDeliveredAck: vi.fn(), sendReadAck: vi.fn(), close: vi.fn(),
    };
  },
}));
vi.mock("../features/chat/hooks/useFriendRequests", () => ({ useFriendRequests: () => ({ refresh: vi.fn() }) }));
vi.mock("./useImageViewerLifecycle", () => ({ useImageViewerLifecycle: vi.fn() }));
vi.mock("../features/chat/components/AuthenticatedShell", () => ({
  AuthenticatedShell: ({ data, loadConversationHistory, onReplyTargetsChange }: {
    data: ChatData; loadConversationHistory?: (id: number) => Promise<number | null>;
    onReplyTargetsChange?: (targets: RecallTarget[]) => void;
  }) => {
    useEffect(() => { void loadConversationHistory?.(42); }, [loadConversationHistory]);
    if (onReplyTargetsChange) draftCallbacks.push(onReplyTargetsChange);
    return <button onClick={() => onReplyTargetsChange?.([{ conversationId: 42, messageId: "old-draft" }])}>
      {data.self.account}登记草稿
    </button>;
  },
}));

const session: AuthSession = { userId: 1, accessToken: "old-token", refreshToken: "refresh", imChatWsUrl: "ws://chat",
  accessTokenExpiresAt: "2099-01-01", refreshTokenPersistence: "session_only" };
function profile(userId: number) { return { userId, account: `user-${userId}`, nickname: "用户", signature: "", avatarObjectKey: null }; }
function page(id: string, userId: number) {
  return { messages: [{ messageId: id, conversationId: 42, conversationSeq: 1, senderUserId: userId,
    clientMessageId: id, messageType: "text", content: { text: id }, createdAt: "2026-10-23T00:00:00Z" }],
    hasMore: false, lastSeq: 1, deliveredSeq: 1, readSeq: 0, peerDeliveredSeq: 0, peerReadSeq: 0 };
}
beforeEach(() => {
  vi.clearAllMocks(); draftCallbacks.length = 0; connectionOwners.length = 0;
  currentUser.mockResolvedValue(profile(1));
  friends.mockResolvedValue([{ ...profile(3), friendshipState: "active", conversationId: 42 }]);
  history.mockImplementation(async (_api: string, token: string) => page(token === "old-token" ? "old-message" : "new-message", 1));
  statuses.mockResolvedValue([]);
});

describe("recall isolation at the authenticated page boundary", () => {
  it.each([{ userId: 2, api: "https://old-api" }, { userId: 1, api: "https://new-api" }])(
    "never queries old body or draft IDs after changing owner to $userId at $api", async ({ userId, api }) => {
      // 测试目标：验证账号或API切换的首个commit及新bootstrap后都不向新owner查询旧消息/草稿ID。
      // 构造方法：组合真实数据hook、校准hook和页面，加载旧正文/登记草稿，切owner并阻塞新bootstrap，再释放并投递旧回调。
      // 输入数据：相同会话42，旧ID old-message/old-draft、新ID new-message；分别换用户及同用户换API。
      // 预期行为：新bootstrap前没有新token状态请求；就绪后仅查询new-message，旧data不可见，迟到旧草稿回调无效。
      const props = { apiBaseUrl: "https://old-api", session, refreshSession: vi.fn(), isLoggingOut: false, onLogout: vi.fn() };
      const view = render(<AuthenticatedPage {...props} />);
      await waitFor(() => expect(statuses.mock.calls.some((call) => call[3].includes("old-message"))).toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "user-1登记草稿" }));
      await waitFor(() => expect(statuses.mock.calls.some((call) => call[3].includes("old-draft"))).toBe(true));
      const oldDraftCallback = draftCallbacks.at(-1)!;
      let release!: (value: ReturnType<typeof profile>) => void;
      currentUser.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      view.rerender(<AuthenticatedPage {...props} apiBaseUrl={api} session={{ ...session, userId, accessToken: "new-token" }} />);
      expect(connectionOwners.at(-1)).toBe(`${api}:${userId}`);
      expect(screen.getByText("正在加载好友和聊天数据...")).toBeInTheDocument();
      expect(statuses.mock.calls.filter((call) => call[1] === "new-token")).toEqual([]);
      await act(async () => release(profile(userId)));
      await waitFor(() => expect(statuses.mock.calls.some((call) => call[1] === "new-token" && call[3].includes("new-message"))).toBe(true));
      act(() => oldDraftCallback([{ conversationId: 42, messageId: "late-old-draft" }]));
      const newRequests = statuses.mock.calls.filter((call) => call[1] === "new-token");
      expect(newRequests.every((call) => call[0] === api)).toBe(true);
      expect(newRequests.flatMap((call) => call[3])).toEqual(["new-message"]);
    },
  );
});
