import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

const { loadClientConfigMock } = vi.hoisted(() => ({ loadClientConfigMock: vi.fn() }));

vi.mock("./features/client-config/api", () => ({ loadClientConfig: loadClientConfigMock }));
vi.mock("./routes/LoginPage", () => ({
  LoginPage: ({ apiBaseUrl }: { apiBaseUrl: string }) => <div>登录地址：{apiBaseUrl}</div>,
}));

describe("App", () => {
  it("renders the login route after client configuration loads", async () => {
    // 测试目标：验证配置加载成功后才进入可提交登录的路由。
    // 构造方法：让客户端配置 API 成功返回本地服务地址并渲染 App。
    // 输入数据：{ apiBaseUrl: "http://127.0.0.1:8080" }。
    // 预期行为：加载提示消失，登录路由收到该 API 地址。
    loadClientConfigMock.mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });

    render(<App />);

    expect(await screen.findByText("登录地址：http://127.0.0.1:8080")).toBeInTheDocument();
  });

  it("blocks login when client configuration cannot load", async () => {
    // 测试目标：验证配置文件无效时不会渲染登录路由或发起后端请求。
    // 构造方法：让客户端配置 API 拒绝并渲染 App。
    // 输入数据：Promise rejection。
    // 预期行为：显示客户端配置无效提示。
    loadClientConfigMock.mockRejectedValueOnce(new Error("client_config_unavailable"));

    render(<App />);

    expect(await screen.findByText("客户端配置无效，请修正后重新启动 Whisper")).toBeInTheDocument();
  });
});
