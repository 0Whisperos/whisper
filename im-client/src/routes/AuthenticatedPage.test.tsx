import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthenticatedPage } from "./AuthenticatedPage";
import type { ChatConnectionState } from "../features/chat-connection/types";

const { useChatConnectionMock } = vi.hoisted(() => ({
  useChatConnectionMock: vi.fn(),
}));

vi.mock("../features/chat-connection/hooks/useChatConnection", () => ({
  useChatConnection: useChatConnectionMock,
}));

const session = {
  accessToken: "jwt-access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
  imChatWsUrl: "ws://127.0.0.1:9001/ws",
};

describe("AuthenticatedPage", () => {
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

    render(<AuthenticatedPage session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

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

    render(<AuthenticatedPage session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={vi.fn()} />);

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

    render(<AuthenticatedPage session={session} refreshSession={vi.fn()} isLoggingOut={false} onLogout={onLogout} />);
    await userEvent.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(events).toEqual(["close", "logout"]);
  });
});
