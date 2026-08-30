import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedPage } from "./AuthenticatedPage";
import { ChatApiError } from "../features/chat/api";
import type { ChatConnectionState } from "../features/chat-connection/types";
import { chatMockData } from "../features/chat/mockData";

const { useChatConnectionMock, useChatDataMock } = vi.hoisted(() => ({
  useChatConnectionMock: vi.fn(),
  useChatDataMock: vi.fn(),
}));

vi.mock("../features/chat-connection/hooks/useChatConnection", () => ({
  useChatConnection: useChatConnectionMock,
}));

vi.mock("../features/chat/hooks/useChatData", () => ({
  useChatData: useChatDataMock,
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
    useChatConnectionMock.mockReset();
    useChatDataMock.mockReset();
    useChatDataMock.mockReturnValue({
      data: chatMockData,
      isLoading: false,
      error: null,
      retry: vi.fn(),
      loadHistory: vi.fn(),
      retryHistory: vi.fn(),
      loadingConversationId: null,
      historyError: () => null,
    });
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
    });

    render(<AuthenticatedPage apiBaseUrl="http://127.0.0.1:8080" session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: "已登录" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "消息" })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "好友" })[0]).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "林晓" })).toBeInTheDocument();
    expect(screen.getByText(/聊天连接在线：connection-uuid/)).toBeInTheDocument();
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
});
