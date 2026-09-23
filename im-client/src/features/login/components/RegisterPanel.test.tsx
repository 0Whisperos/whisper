import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../api";
import { RegisterPanel } from "./RegisterPanel";

describe("RegisterPanel", () => {
  it("renders nickname and password confirmation fields", () => {
    // 测试目标：验证注册面板提供昵称、密码、确认密码和注册/返回登录操作。
    // 构造方法：使用默认回调渲染 RegisterPanel，并按可访问名称查询控件。
    // 输入数据：空注册表单。
    // 预期行为：三个输入框、注册按钮和返回登录按钮均可见。
    renderRegisterPanel();

    expect(screen.getByLabelText("昵称")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回登录" })).toBeInTheDocument();
  });

  it("trims a Unicode nickname before submitting valid credentials", async () => {
    // 测试目标：验证昵称按 Unicode 码点计数并在提交前去除首尾空白。
    // 构造方法：填写包含空格的 15 个 Unicode 字符昵称和两次相同密码后提交。
    // 输入数据：昵称 "  😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀  "、密码 "secret"。
    // 预期行为：注册回调收到去除空格后的昵称和密码。
    const user = userEvent.setup();
    const onRegister = vi.fn().mockResolvedValue(undefined);
    renderRegisterPanel({ onRegister });

    await user.type(screen.getByLabelText("昵称"), `  ${"😀".repeat(15)}  `);
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "secret");
    await user.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() => expect(onRegister).toHaveBeenCalledWith("😀".repeat(15), "secret"));
  });

  it("blocks submission when passwords do not match", async () => {
    // 测试目标：验证两次密码不一致时客户端阻止注册请求。
    // 构造方法：填写合法昵称、不同的密码和确认密码后提交表单。
    // 输入数据：昵称 "alice"、密码 "secret"、确认密码 "different"。
    // 预期行为：显示密码不一致错误，注册回调不会被调用。
    const user = userEvent.setup();
    const onRegister = vi.fn();
    renderRegisterPanel({ onRegister });

    await user.type(screen.getByLabelText("昵称"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "different");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("blocks empty and overlong nicknames before requesting registration", async () => {
    // 测试目标：验证昵称 trim 后不能为空且不能超过 15 个 Unicode 字符。
    // 构造方法：先提交全空白昵称，再输入 16 个汉字并提交，每次都观察 API 调用次数。
    // 输入数据：昵称 "   "，随后改为 "一"重复 16 次；密码和确认密码均为 "secret"。
    // 预期行为：分别显示昵称错误和长度错误，注册回调始终不会被调用。
    const user = userEvent.setup();
    const onRegister = vi.fn();
    renderRegisterPanel({ onRegister });

    await user.type(screen.getByLabelText("昵称"), "   ");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "secret");
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByText("请输入昵称")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("昵称"));
    await user.type(screen.getByLabelText("昵称"), "一".repeat(16));
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByText("昵称不能超过 15 个字符")).toBeInTheDocument();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("disables registration while the request is pending", async () => {
    // 测试目标：验证注册请求进行中不能重复提交。
    // 构造方法：让注册回调返回未完成 Promise，填写合法数据并提交。
    // 输入数据：昵称 "alice"、密码和确认密码均为 "secret"。
    // 预期行为：注册按钮显示“注册中...”并处于禁用状态。
    const user = userEvent.setup();
    const onRegister = vi.fn().mockReturnValue(new Promise(() => undefined));
    renderRegisterPanel({ onRegister });

    await user.type(screen.getByLabelText("昵称"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "secret");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByRole("button", { name: "注册中..." })).toBeDisabled();
  });

  it("shows a user-facing message when registration fails", async () => {
    // 测试目标：验证网络错误会被转换为用户可读的注册失败提示。
    // 构造方法：让注册回调拒绝 AuthApiError("network_error")，填写合法数据后提交。
    // 输入数据：昵称 "alice"、密码和确认密码均为 "secret"。
    // 预期行为：显示网络连接失败提示且表单恢复可提交状态。
    const user = userEvent.setup();
    const onRegister = vi.fn().mockRejectedValue(new AuthApiError("network_error"));
    renderRegisterPanel({ onRegister });

    await user.type(screen.getByLabelText("昵称"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.type(screen.getByLabelText("确认密码"), "secret");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByText("网络连接失败，请检查服务是否启动")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注册" })).toBeEnabled();
  });
});

function renderRegisterPanel(overrides: Partial<Parameters<typeof RegisterPanel>[0]> = {}) {
  return render(
    <RegisterPanel
      onRegister={() => undefined}
      onBackToLogin={() => undefined}
      onPauseGame={() => undefined}
      {...overrides}
    />,
  );
}
