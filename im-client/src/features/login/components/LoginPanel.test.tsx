import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginPanel } from "./LoginPanel";

describe("LoginPanel", () => {
  it("renders the login form fields and actions", () => {
    // 测试目标：验证登录表单包含用户可见的账号、密码、忘记密码和登录操作。
    // 构造方法：渲染 LoginPanel，并按用户可见 label/role 查询控件。
    // 输入数据：无输入，只检查初始登录界面。
    // 预期行为：账号输入框、密码输入框、忘记密码链接和登录按钮都存在。
    render(<LoginPanel onPauseGame={() => undefined} />);

    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "忘记密码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("prevents real requests when the login form is submitted", async () => {
    // 测试目标：验证当前阶段点击登录只暂停小游戏，不发起 fetch 请求。
    // 构造方法：渲染 LoginPanel，替换全局 fetch 为可观察测试替身，模拟用户输入并提交。
    // 输入数据：账号 "alice" 和密码 "secret"。
    // 预期行为：onPauseGame 被调用，fetch 没有被调用。
    const user = userEvent.setup();
    const onPauseGame = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<LoginPanel onPauseGame={onPauseGame} />);

    await user.type(screen.getByLabelText("账号"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    onPauseGame.mockClear();
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onPauseGame).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("prevents navigation when the forgot password link is clicked", async () => {
    // 测试目标：验证忘记密码当前只是本地交互，不触发页面导航流程。
    // 构造方法：渲染 LoginPanel，模拟点击忘记密码链接。
    // 输入数据：点击文本为 "忘记密码" 的链接。
    // 预期行为：onPauseGame 被调用，链接仍是本地占位 href。
    const user = userEvent.setup();
    const onPauseGame = vi.fn();

    render(<LoginPanel onPauseGame={onPauseGame} />);

    const forgotLink = screen.getByRole("link", { name: "忘记密码" });
    onPauseGame.mockClear();
    await user.click(forgotLink);

    expect(forgotLink).toHaveAttribute("href", "#");
    expect(onPauseGame).toHaveBeenCalled();
  });
});
