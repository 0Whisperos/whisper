import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

function mockCanvasRuntime() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 640,
    height: 360,
    top: 0,
    right: 640,
    bottom: 360,
    left: 0,
    toJSON: () => ({}),
  });
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCanvasRuntime();
  });

  it("renders the login content without the HTML preview window shell", () => {
    // Test goal: verify the Tauri content area renders the login experience without the old preview window chrome.
    // Construction: mock the canvas runtime, render LoginPage, and inspect user-visible content plus shell classes.
    // Input data: no saved users and no user input.
    // Expected behavior: the login form and game area exist while preview-window classes are absent.
    const { container } = render(
      <LoginPage
        savedUsers={[]}
        credentialWarning={null}
        isLoadingSavedUsers={false}
        onPasswordLogin={() => undefined}
        onSavedUserLogin={() => undefined}
        onRegister={async () => ""}
      />,
    );

    expect(screen.getByLabelText("小恐龙小游戏区域")).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(container.querySelector(".client-window")).not.toBeInTheDocument();
    expect(container.querySelector(".client-titlebar")).not.toBeInTheDocument();
    expect(container.querySelector(".window-dot")).not.toBeInTheDocument();
  });

  it("switches to registration and returns with the generated account prefilled", async () => {
    // 测试目标：验证注册成功提示、返回登录、账号预填、密码清空和自动登录关闭的完整流程。
    // 构造方法：渲染 LoginPage，点击注册，填写合法注册信息并让注册回调返回生成账号，再确认成功提示。
    // 输入数据：昵称 "小明"、密码与确认密码 "secret"、后端生成账号 "00123456"。
    // 预期行为：显示成功弹框；点击“去登录”后回到登录表单，账号为生成账号，密码为空且自动登录未选中。
    const user = userEvent.setup();
    const onRegister = vi.fn().mockResolvedValue("00123456");

    render(
      <LoginPage
        savedUsers={[]}
        credentialWarning={null}
        isLoadingSavedUsers={false}
        onPasswordLogin={() => undefined}
        onSavedUserLogin={() => undefined}
        onRegister={onRegister}
      />,
    );

    await user.click(screen.getByRole("button", { name: "注册" }));
    await user.type(screen.getByLabelText("昵称"), "小明");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "secret");
    await user.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() => expect(onRegister).toHaveBeenCalledWith("小明", "secret"));
    expect(await screen.findByRole("dialog", { name: "注册成功" })).toBeInTheDocument();
    expect(screen.getByText("00123456")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去登录" }));

    expect(screen.getByLabelText("账号")).toHaveValue("00123456");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(screen.getByLabelText("自动登录")).not.toBeChecked();
  });
});
