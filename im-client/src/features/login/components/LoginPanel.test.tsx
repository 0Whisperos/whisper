import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginPanel } from "./LoginPanel";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock("../api", () => ({ login: loginMock }));

describe("LoginPanel", () => {
  it("renders the login form fields and actions", () => {
    // 测试目标：验证登录表单包含用户可见的账号、密码、忘记密码和登录操作。
    // 构造方法：渲染 LoginPanel，并按用户可见 label/role 查询控件。
    // 输入数据：无输入，只检查初始登录界面。
    // 预期行为：账号输入框、密码输入框、忘记密码链接和登录按钮都存在。
    render(<LoginPanel apiBaseUrl="http://127.0.0.1:8080" onAuthenticated={() => undefined} onPauseGame={() => undefined} />);

    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "忘记密码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("validates credentials before requesting login", async () => {
    // 测试目标：验证账号必须为 8-12 位数字，且密码不能为空。
    // 构造方法：渲染 LoginPanel，输入不符合格式的账号后提交。
    // 输入数据：账号 "alice"，密码 "secret"。
    // 预期行为：显示账号格式错误，且 feature API 不被调用。
    const user = userEvent.setup();
    const onPauseGame = vi.fn();

    render(<LoginPanel apiBaseUrl="http://127.0.0.1:8080" onAuthenticated={() => undefined} onPauseGame={onPauseGame} />);

    await user.type(screen.getByLabelText("账号"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    onPauseGame.mockClear();
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onPauseGame).toHaveBeenCalled();
    expect(screen.getByText("账号必须是 8-12 位数字")).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("disables submission while the login request is pending", async () => {
    // 测试目标：验证登录请求进行时按钮不可重复提交。
    // 构造方法：让登录 API 返回未完成 Promise，输入合法凭据并点击登录。
    // 输入数据：账号 12345678，密码 secret。
    // 预期行为：登录按钮显示登录中并处于 disabled 状态。
    const user = userEvent.setup();
    loginMock.mockReturnValueOnce(new Promise(() => undefined));

    render(<LoginPanel apiBaseUrl="http://127.0.0.1:8080" onAuthenticated={() => undefined} onPauseGame={() => undefined} />);

    await user.type(screen.getByLabelText("账号"), "12345678");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("button", { name: "登录中" })).toBeDisabled();
  });

  it("returns the authenticated session to the page on successful login", async () => {
    // 测试目标：验证 LoginPanel 只把成功会话交给上层，而不自行持久化令牌。
    // 构造方法：让登录 API 成功返回会话，模拟填写合法表单并提交。
    // 输入数据：账号 12345678、密码 secret、返回 accessToken 和 refreshToken。
    // 预期行为：onAuthenticated 收到完整会话。
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    loginMock.mockResolvedValueOnce({
      accessToken: "jwt-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9001/ws",
    });

    render(<LoginPanel apiBaseUrl="http://127.0.0.1:8080" onAuthenticated={onAuthenticated} onPauseGame={() => undefined} />);

    await user.type(screen.getByLabelText("账号"), "12345678");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith({
        accessToken: "jwt-access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
        imChatWsUrl: "ws://127.0.0.1:9001/ws",
      });
    });
  });

  it("prevents navigation when the forgot password link is clicked", async () => {
    // 测试目标：验证忘记密码当前只是本地交互，不触发页面导航流程。
    // 构造方法：渲染 LoginPanel，模拟点击忘记密码链接。
    // 输入数据：点击文本为 "忘记密码" 的链接。
    // 预期行为：onPauseGame 被调用，链接仍是本地占位 href。
    const user = userEvent.setup();
    const onPauseGame = vi.fn();

    render(<LoginPanel apiBaseUrl="http://127.0.0.1:8080" onAuthenticated={() => undefined} onPauseGame={onPauseGame} />);

    const forgotLink = screen.getByRole("link", { name: "忘记密码" });
    onPauseGame.mockClear();
    await user.click(forgotLink);

    expect(forgotLink).toHaveAttribute("href", "#");
    expect(onPauseGame).toHaveBeenCalled();
  });
});
