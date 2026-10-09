import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedPage } from "./AuthenticatedPage";
import { ChatApiError } from "../features/chat/api";
import type { ChatConnectionState } from "../features/chat-connection/types";
import { AvatarResourceCache } from "../features/chat/avatarResourceCache";
import { chatMockData } from "../features/chat/mockData";

const { saveCurrentProfileMock, updateSelfProfileMock, useChatConnectionMock, useChatDataMock, exportAvatarCropMock } = vi.hoisted(() => ({
  saveCurrentProfileMock: vi.fn(),
  updateSelfProfileMock: vi.fn(),
  useChatConnectionMock: vi.fn(),
  useChatDataMock: vi.fn(),
  exportAvatarCropMock: vi.fn(),
}));

vi.mock("../features/chat-connection/hooks/useChatConnection", () => ({
  useChatConnection: useChatConnectionMock,
}));

vi.mock("../features/chat/hooks/useChatData", () => ({
  useChatData: useChatDataMock,
}));

vi.mock("../features/chat/profileApi", () => ({
  saveCurrentProfile: saveCurrentProfileMock,
}));

vi.mock("../features/chat/components/avatarCrop", () => ({
  AVATAR_CROP_VIEWPORT_SIZE: 280,
  exportAvatarCrop: exportAvatarCropMock,
}));

vi.mock("../features/chat/hooks/useFriendRequests", () => ({
  useFriendRequests: () => ({ incoming: [], outgoing: [], incomingHasMore: false, outgoingHasMore: false, pendingCount: 0, loading: false, error: null, refresh: vi.fn(async () => undefined), loadMore: vi.fn(async () => undefined) }),
}));

const session = {
  userId: 20001,
  accessToken: "jwt-access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
  refreshTokenPersistence: "session_only" as const,
};

describe("AuthenticatedPage", () => {
  beforeEach(() => {
    saveCurrentProfileMock.mockReset();
    updateSelfProfileMock.mockReset();
    useChatConnectionMock.mockReset();
    useChatDataMock.mockReset();
    exportAvatarCropMock.mockReset();
    exportAvatarCropMock.mockResolvedValue(new File(["cropped"], "avatar.png", { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:page-avatar") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    useChatConnectionMock.mockReturnValue({
      state: { status: "closed" } satisfies ChatConnectionState,
      close: vi.fn(),
      sendTextMessage: vi.fn(),
      sendDeliveredAck: vi.fn(),
      sendReadAck: vi.fn(),
    });
    useChatDataMock.mockReturnValue({
      data: chatMockData,
      isLoading: false,
      error: null,
      retry: vi.fn(),
      refreshFriends: vi.fn(async () => undefined),
      loadHistory: vi.fn(),
      retryHistory: vi.fn(),
      loadingConversationId: null,
      historyError: () => null,
      updateData: vi.fn(),
      updateSelfProfile: updateSelfProfileMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the authenticated page available for retry when chat data loading fails", async () => {
    // 测试目标：验证好友/聊天数据失败不会触发退出登录，并向页面暴露可重试入口。
    // 构造方法：mock useChatData 返回 network_error 与 retry 函数，渲染已认证页面后点击重试。
    // 输入数据：session.accessToken=jwt-access-token，数据错误码=network_error。
    // 预期行为：页面显示稳定错误码，点击“重试”调用 retry，且没有调用 onLogout。
    const retry = vi.fn();
    const onLogout = vi.fn();
    useChatDataMock.mockReturnValueOnce({
      data: null,
      isLoading: false,
      error: new ChatApiError("network_error"),
      retry,
      loadHistory: vi.fn(),
      retryHistory: vi.fn(),
      loadingConversationId: null,
      historyError: () => null,
    });

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={onLogout} />);
    expect(screen.getByText(/好友和聊天数据加载失败（network_error）/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("renders the authenticated chat workspace with connection state", () => {
    // 测试目标：验证登录后渲染聊天工作台，并把 WebSocket 在线状态展示给用户。
    // 构造方法：mock useChatConnection 返回 authenticated 状态后渲染 AuthenticatedPage。
    // 输入数据：connectionId=connection-uuid，默认 mock 会话为林晓。
    // 预期行为：页面显示消息/好友入口、默认聊天标题和聊天连接在线状态。
    useChatConnectionMock.mockReturnValueOnce({
      state: {
        status: "authenticated",
        userId: 20001,
        connectionId: "connection-uuid",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
      } satisfies ChatConnectionState,
      close: vi.fn(),
      sendTextMessage: vi.fn(),
      sendDeliveredAck: vi.fn(),
      sendReadAck: vi.fn(),
    });

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: "已登录" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "消息" })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "好友" })[0]).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "林晓" })).toBeInTheDocument();
    expect(screen.getByText(/聊天连接在线：connection-uuid/)).toBeInTheDocument();
  });

  it("reloads friend requests and friend data after a friend request push", async () => {
    // 测试目标：验证收到 friend_request_updated WebSocket 帧后重新加载收发申请首屏和好友列表。
    // 构造方法：mock 已认证连接并渲染页面，从连接配置中取出 onServerFrame 回调后注入申请更新帧。
    // 输入数据：type=friend_request_updated，payload 含 request_id=req-1、status=accepted。
    // 预期行为：好友列表刷新回调执行，申请 hook 的 refresh 也会执行。
    const refreshFriends = vi.fn(async () => undefined);
    useChatDataMock.mockReturnValue({ data: chatMockData, isLoading: false, error: null, retry: vi.fn(), refreshFriends, loadHistory: vi.fn(), retryHistory: vi.fn(), loadingConversationId: null, historyError: () => null, updateData: vi.fn() });
    useChatConnectionMock.mockReturnValue({ state: { status: "authenticated", userId: 20001, connectionId: "connection-1", accessTokenExpiresAt: session.accessTokenExpiresAt } satisfies ChatConnectionState, close: vi.fn(), sendTextMessage: vi.fn(), sendDeliveredAck: vi.fn(), sendReadAck: vi.fn() });
    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

    const connectionOptions = useChatConnectionMock.mock.calls.at(-1)?.[0] as { onServerFrame: (frame: { type: string; payload: { request_id: string; status: string } }) => void };
    await act(async () => connectionOptions.onServerFrame({ type: "friend_request_updated", payload: { request_id: "req-1", status: "accepted" } }));

    expect(refreshFriends).toHaveBeenCalledTimes(1);
  });

  it("coordinates authenticated send requests through chat data and the WebSocket transport", async () => {
    // 测试目标：验证页面只在连接认证完成后，将当前会话的发送操作委托给消息状态层与连接层传输函数。
    // 构造方法：分别 mock 认证状态、聊天数据更新函数和连接层发送函数，随后从可见输入框提交文本。
    // 输入数据：会话 10002 的文本“页面接线”。
    // 预期行为：连接层 transport 收到会话、裁剪文本与本地消息标识，输入框随后清空。
    const sendTransport = vi.fn();
    const updateData = vi.fn();
    useChatConnectionMock.mockReturnValueOnce({
      state: {
        status: "authenticated",
        userId: 20001,
        connectionId: "connection-uuid",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
      } satisfies ChatConnectionState,
      close: vi.fn(),
      sendTextMessage: sendTransport,
      sendDeliveredAck: vi.fn(),
      sendReadAck: vi.fn(),
    });
    useChatDataMock.mockReturnValueOnce({
      data: chatMockData,
      isLoading: false,
      error: null,
      retry: vi.fn(),
      loadHistory: vi.fn(),
      retryHistory: vi.fn(),
      loadingConversationId: null,
      historyError: () => null,
      updateData,
    });
    const user = userEvent.setup();

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);
    const input = screen.getByLabelText("输入消息");
    await user.type(input, "  页面接线  ");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(updateData).toHaveBeenCalledTimes(1);
    expect(sendTransport).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 10002,
      text: "页面接线",
    }));
    expect(input).toHaveValue("");
  });

  it("shows auth_failed using the stable error code", () => {
    // 测试目标：验证认证失败提示依赖稳定错误码而不是服务端 message 文本。
    // 构造方法：mock useChatConnection 返回 auth_failed invalid_token。
    // 输入数据：errorCode=invalid_token，message=server text ignored by UI。
    // 预期行为：页面显示 invalid_token 错误码。
    useChatConnectionMock.mockReturnValueOnce({
      state: { status: "auth_failed", errorCode: "invalid_token", message: "server text ignored by UI" } satisfies ChatConnectionState,
      close: vi.fn(),
    });

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

    expect(screen.getByText(/聊天连接认证失败：invalid_token/)).toBeInTheDocument();
  });

  it("closes the chat connection before logging out", async () => {
    // 测试目标：验证主动退出登录前会先关闭当前 WebSocket 连接。
    // 构造方法：mock useChatConnection 返回可观察 close 函数，打开账号面板后点击退出登录按钮。
    // 输入数据：用户点击“账号与设置”，再点击“退出登录”。
    // 预期行为：close 先被调用，随后触发 onLogout。
    const events: string[] = [];
    useChatConnectionMock.mockReturnValueOnce({
      state: { status: "closed" } satisfies ChatConnectionState,
      close: vi.fn(() => events.push("close")),
    });
    const onLogout = vi.fn(() => events.push("logout"));

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={onLogout} />);
    await userEvent.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(events).toEqual(["close", "logout"]);
  });

  it("updates text-only profile data without priming an avatar resource", async () => {
    // 测试目标：验证页面层纯昵称和个性签名保存成功后只更新 useChatData 的当前用户资料。
    // 构造方法：mock 资料保存响应，打开编辑器修改两个文本字段并提交，同时监视头像缓存 prime。
    // 输入数据：昵称“页面昵称”、个性签名“页面个签”、头像操作 keep。
    // 预期行为：saveCurrentProfile 收到纯文字输入，updateSelfProfile 收到响应，prime 不执行。
    const updatedProfile = profileDto({ nickname: "页面昵称", signature: "页面个签" });
    saveCurrentProfileMock.mockResolvedValueOnce(updatedProfile);
    const prime = vi.spyOn(AvatarResourceCache.prototype, "prime");
    const user = userEvent.setup();
    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);
    await openProfileEditor(user);
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const nickname = within(dialog).getByRole("textbox", { name: /昵称/ });
    const signature = within(dialog).getByRole("textbox", { name: /个性签名/ });
    await user.clear(nickname);
    await user.type(nickname, "页面昵称");
    await user.clear(signature);
    await user.type(signature, "页面个签");

    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveCurrentProfileMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080",
      "jwt-access-token",
      { nickname: "页面昵称", signature: "页面个签", avatar: { action: "keep" } },
    ));
    expect(prime).not.toHaveBeenCalled();
    expect(updateSelfProfileMock).toHaveBeenCalledWith(updatedProfile);
  });

  it("primes the committed avatar key before updating the shared profile state", async () => {
    // 测试目标：验证头像保存采用服务端响应的 committed key，并按 prime 后 updateSelfProfile 的顺序发布资料。
    // 构造方法：mock 保存响应返回不同于上传 pending key 的 committed key，记录缓存和资料更新调用顺序。
    // 输入数据：new-avatar.webp 源图、裁剪后 avatar.png、响应 avatar_object_key=avatars/7/committed.png。
    // 预期行为：File 交给保存 API，缓存以 committed key 预热，然后资料状态使用同一响应更新。
    const events: string[] = [];
    const committedProfile = profileDto({ avatarObjectKey: "avatars/7/committed.png" });
    saveCurrentProfileMock.mockImplementationOnce(async () => {
      events.push("save");
      return committedProfile;
    });
    const prime = vi.spyOn(AvatarResourceCache.prototype, "prime").mockImplementation((objectKey) => {
      events.push(`prime:${objectKey}`);
    });
    updateSelfProfileMock.mockImplementation((profile: { avatarObjectKey: string | null }) => {
      events.push(`update:${profile.avatarObjectKey}`);
    });
    const user = userEvent.setup();
    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);
    await openProfileEditor(user);
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const file = new File(["image"], "new-avatar.webp", { type: "image/webp" });
    const croppedFile = new File(["cropped"], "avatar.png", { type: "image/png" });
    exportAvatarCropMock.mockResolvedValueOnce(croppedFile);
    await user.upload(within(dialog).getByLabelText("选择头像图片"), file);
    const cropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(cropImage, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(cropImage, "naturalHeight", { configurable: true, value: 400 });
    fireEvent.load(cropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));

    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateSelfProfileMock).toHaveBeenCalledWith(committedProfile));
    expect(saveCurrentProfileMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080",
      "jwt-access-token",
      expect.objectContaining({ avatar: { action: "replace", file: croppedFile } }),
    );
    expect(prime).toHaveBeenCalledWith("avatars/7/committed.png", croppedFile);
    expect(events).toEqual(["save", "prime:avatars/7/committed.png", "update:avatars/7/committed.png"]);
  });

  it("does not prime or update profile state when remote saving fails", async () => {
    // 测试目标：验证上传或资料提交失败时页面层不发布任何头像缓存或个人资料变更。
    // 构造方法：让 saveCurrentProfile 拒绝，选择头像后提交并观察缓存、资料状态和错误界面。
    // 输入数据：failed.png 文件和 upload_failed 异常。
    // 预期行为：编辑器保留并显示失败提示，prime 与 updateSelfProfile 都不执行。
    saveCurrentProfileMock.mockRejectedValueOnce(new Error("upload_failed"));
    const prime = vi.spyOn(AvatarResourceCache.prototype, "prime");
    const user = userEvent.setup();
    const { unmount } = render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);
    await openProfileEditor(user);
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    await user.upload(
      within(dialog).getByLabelText("选择头像图片"),
      new File(["image"], "failed.png", { type: "image/png" }),
    );
    const cropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(cropImage, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(cropImage, "naturalHeight", { configurable: true, value: 400 });
    fireEvent.load(cropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));

    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("资料保存失败，请稍后重试");
    expect(prime).not.toHaveBeenCalled();
    expect(updateSelfProfileMock).not.toHaveBeenCalled();
    unmount();
  });
});

async function openProfileEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
  await user.click(screen.getByRole("button", { name: "编辑" }));
}

function profileDto(overrides: Partial<{
  userId: number;
  account: string;
  nickname: string;
  signature: string;
  avatarObjectKey: string | null;
}> = {}) {
  return {
    userId: 20001,
    account: "lin@whisper.local",
    nickname: "林澈",
    signature: "",
    avatarObjectKey: null,
    ...overrides,
  };
}
