import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContactsPanel } from "./ContactsPanel";
import type { useFriendRequests } from "../hooks/useFriendRequests";
import { chatMockData } from "../mockData";
import { createFriendRequest, respondToFriendRequest, searchUserByAccount } from "../friendRequestsApi";

vi.mock("../friendRequestsApi", () => ({
  createFriendRequest: vi.fn(),
  respondToFriendRequest: vi.fn(),
  searchUserByAccount: vi.fn(),
}));

const refresh = vi.fn(async () => undefined);
const loadMore = vi.fn(async () => undefined);
const refreshFriends = vi.fn(async () => undefined);
const baseRequests = {
  incoming: [], outgoing: [], incomingHasMore: false, outgoingHasMore: false,
  pendingCount: 0, loading: false, error: null, refresh, loadMore,
} as unknown as ReturnType<typeof useFriendRequests>;

function renderPanel(requests = baseRequests) {
  return render(<ContactsPanel
    hidden={false} contacts={chatMockData.contacts} sections={chatMockData.contactSections}
    activeContact={null} activeContactId="" statusMessage="" self={chatMockData.self}
    apiBaseUrl="https://api.test" accessToken="token" friendRequests={requests}
    onRefreshFriends={refreshFriends} onSelectContact={vi.fn()} onEnterConversation={vi.fn()}
    onReturnToContacts={vi.fn()} onToolPreview={vi.fn()}
  />);
}

describe("ContactsPanel friend requests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates the complete numeric account before searching", async () => {
    // 测试目标：验证账号格式不符合 8–12 位数字要求时，在客户端拦截搜索。
    // 构造方法：渲染通讯录并打开搜索弹窗，输入非数字账号后提交表单。
    // 输入数据：账号 "abc123"。
    // 预期行为：显示格式错误提示，且不调用账号查询 API。
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /朋友.*通过账号搜索/ }));
    await user.type(screen.getByLabelText("对方账号"), "abc123");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入 8–12 位完整数字账号");
    expect(searchUserByAccount).not.toHaveBeenCalled();
  });

  it("shows the global incoming badge and offers older records when the page has no pending item", async () => {
    // 测试目标：验证当前页只有已处理记录、但全局 pending_count 大于零时仍提示更早处有待处理申请。
    // 构造方法：渲染通讯录，提供一条 accepted incoming 记录、pending_count=4 和 hasMore=true，再打开新的朋友。
    // 输入数据：incoming 首屏仅含 request_id=old-1 的 accepted 记录，pendingCount=4，incomingHasMore=true。
    // 预期行为：入口显示 4，列表保留已处理记录，同时提示较早记录中仍有待处理项并允许继续分页。
    const user = userEvent.setup();
    const processedRequest = { requestId: "old-1", sender: { userId: 2, account: "bob", nickname: "Bob", signature: "", avatarObjectKey: null }, recipient: { userId: 1, account: "alice", nickname: "Alice", signature: "", avatarObjectKey: null }, verificationMessage: "", status: "accepted" as const, createdAt: "2026-10-04T10:00:00Z" };
    renderPanel({ ...baseRequests, incoming: [processedRequest], incomingHasMore: true, pendingCount: 4 });
    expect(screen.queryByText("联系人", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新的朋友/ })).not.toHaveTextContent("♧");
    expect(screen.getByText("发现")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /朋友.*通过账号搜索/ })).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
    expect(screen.getByLabelText("4 个待处理申请")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /新的朋友/ }));
    expect(screen.getByRole("heading", { name: "好友申请" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收到的申请" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("已同意")).toBeInTheDocument();
    expect(screen.getByText(/较早的记录中还有 4 条待处理申请/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加载更早记录" }));
    expect(loadMore).toHaveBeenCalledWith("incoming");
  });

  it("accepts an incoming pending request and refreshes both requests and friends", async () => {
    // 测试目标：验证收到的待处理申请显示同意/拒绝操作，同意后更新申请及好友数据。
    // 构造方法：提供一条 incoming pending 记录，进入新的朋友并点击同意。
    // 输入数据：request_id=req-1、发送者 Bob、验证信息“你好”。
    // 预期行为：调用 accept API，随后重拉收发申请列表和好友列表。
    const user = userEvent.setup();
    const requests = { ...baseRequests, incoming: [{ requestId: "req-1", sender: { userId: 2, account: "bob", nickname: "Bob", signature: "", avatarObjectKey: null }, recipient: { userId: 1, account: "alice", nickname: "Alice", signature: "", avatarObjectKey: null }, verificationMessage: "你好", status: "pending" as const, createdAt: "2026-10-05T10:00:00Z" }], pendingCount: 1 };
    vi.mocked(respondToFriendRequest).mockResolvedValue(undefined);
    renderPanel(requests);
    await user.click(screen.getByRole("button", { name: /新的朋友/ }));
    expect(screen.getByText("验证信息")).toBeInTheDocument();
    expect(screen.getByText("你好")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意" }));
    expect(respondToFriendRequest).toHaveBeenCalledWith("https://api.test", "token", "req-1", "accept");
    expect(refresh).toHaveBeenCalled();
    expect(refreshFriends).toHaveBeenCalled();
  });

  it("shows a disabled send-message action for self and routes an existing friend to chat", async () => {
    // 测试目标：验证搜索到本人不提供添加操作，搜索到已有好友可从统一的“发消息”入口打开会话。
    // 构造方法：mock 两次账号搜索，分别返回本人和当前好友资料，执行搜索并点击好友操作。
    // 输入数据：当前账号 alice 与好友账号 zhouran。
    // 预期行为：本人结果的发消息按钮禁用；好友结果可用发消息并调用对应联系人会话回调。
    const user = userEvent.setup();
    const onEnterConversation = vi.fn();
    vi.mocked(searchUserByAccount)
      .mockResolvedValueOnce({ userId: chatMockData.self.userId, account: "12345678", nickname: "Alice", signature: "", avatarObjectKey: null })
      .mockResolvedValueOnce({ userId: chatMockData.contacts[0]!.userId, account: "12345679", nickname: chatMockData.contacts[0]!.name, signature: "", avatarObjectKey: null });
    const view = render(<ContactsPanel hidden={false} contacts={chatMockData.contacts} sections={chatMockData.contactSections} activeContact={null} activeContactId="" statusMessage="" self={chatMockData.self} apiBaseUrl="https://api.test" accessToken="token" friendRequests={baseRequests} onRefreshFriends={refreshFriends} onSelectContact={vi.fn()} onEnterConversation={onEnterConversation} onReturnToContacts={vi.fn()} onToolPreview={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /朋友.*通过账号搜索/ }));
    expect(screen.getByText("输入账号后点击“搜索”")).toBeInTheDocument();
    await user.type(screen.getByLabelText("对方账号"), "12345678");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("button", { name: "发消息" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "关闭搜索" }));
    await user.click(screen.getByRole("button", { name: /朋友.*通过账号搜索/ }));
    await user.type(screen.getByLabelText("对方账号"), "12345679");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByText("账号 12345679")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发消息" }));
    expect(onEnterConversation).toHaveBeenCalledWith(chatMockData.contacts[0]);
    view.unmount();
  });

  it("sends an optional verification message from the follow-up dialog", async () => {
    // 测试目标：验证搜索到非好友用户后可填写验证信息并发起申请。
    // 构造方法：mock 账号搜索和申请提交，依次打开搜索与验证信息对话框并提交。
    // 输入数据：目标账号 newfriend，验证信息“你好”。
    // 预期行为：POST API 收到目标账号与验证信息，成功后关闭对话框。
    const user = userEvent.setup();
    vi.mocked(searchUserByAccount).mockResolvedValue({ userId: 999, account: "12345680", nickname: "New", signature: "", avatarObjectKey: null });
    vi.mocked(createFriendRequest).mockResolvedValue(undefined);
    renderPanel();
    await user.click(screen.getByRole("button", { name: /朋友.*通过账号搜索/ }));
    await user.type(screen.getByLabelText("对方账号"), "12345680");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(within(screen.getByRole("dialog", { name: "搜索账号" })).getByRole("button", { name: "添加好友" }));
    await user.type(screen.getByLabelText("验证信息"), "你好");
    refreshFriends.mockClear();
    await user.click(screen.getByRole("button", { name: "发送申请" }));
    expect(createFriendRequest).toHaveBeenCalledWith("https://api.test", "token", "12345680", "你好");
    expect(refreshFriends).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "发送好友申请" })).not.toBeInTheDocument();
  });

  it("renders outgoing request cards with the blueprint verification heading and status", async () => {
    // 测试目标：验证发出的申请采用蓝图的资料、验证信息标签、状态和时间记录布局。
    // 构造方法：渲染一条已拒绝的 outgoing 记录，打开新的朋友并切换到发出的申请。
    // 输入数据：目标账号 00100004、验证信息“你好，我想加你为好友。”、状态 rejected。
    // 预期行为：显示对象资料、我发送的验证信息、原验证文本及已拒绝状态。
    const user = userEvent.setup();
    const outgoingRequest = {
      requestId: "out-1",
      sender: { userId: 1, account: "00100001", nickname: "林澈", signature: "", avatarObjectKey: null },
      recipient: { userId: 4, account: "00100004", nickname: "许遥", signature: "", avatarObjectKey: null },
      verificationMessage: "你好，我想加你为好友。",
      status: "rejected" as const,
      createdAt: "2026-10-05T13:16:44+08:00",
    };
    renderPanel({ ...baseRequests, outgoing: [outgoingRequest] });
    await user.click(screen.getByRole("button", { name: /新的朋友/ }));
    await user.click(screen.getByRole("button", { name: "发出的申请" }));
    expect(screen.getByText("许遥")).toBeInTheDocument();
    expect(screen.getByText("我发送的验证信息")).toBeInTheDocument();
    expect(screen.getByText("你好，我想加你为好友。")).toBeInTheDocument();
    expect(screen.getByText("已拒绝")).toBeInTheDocument();
    expect(screen.getByText(/2026\/10\/5/)).toBeInTheDocument();
  });
});
