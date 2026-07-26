import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { ClientConfigError, loadClientConfig } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("loadClientConfig", () => {
  it("loads the API base URL through the Tauri command", async () => {
    // 测试目标：验证客户端配置只经由封装后的 Tauri command 读取。
    // 构造方法：替换 invoke 为返回已知 DTO 的测试替身，再调用配置 API。
    // 输入数据：命令返回 { apiBaseUrl: "http://127.0.0.1:8080" }。
    // 预期行为：调用 load_client_config，且调用方得到同一 API 地址。
    vi.mocked(invoke).mockResolvedValueOnce({ apiBaseUrl: "http://127.0.0.1:8080" });

    await expect(loadClientConfig()).resolves.toEqual({ apiBaseUrl: "http://127.0.0.1:8080" });

    expect(invoke).toHaveBeenCalledWith("load_client_config");
  });

  it("maps Tauri configuration failures to a stable frontend error", async () => {
    // 测试目标：验证前端不会接收或显示 Rust 的底层配置错误详情。
    // 构造方法：让 invoke 拒绝 client_config_unavailable，再调用配置 API。
    // 输入数据：Tauri rejection 值 "client_config_unavailable"。
    // 预期行为：Promise 拒绝为 ClientConfigError。
    vi.mocked(invoke).mockRejectedValueOnce("client_config_unavailable");

    await expect(loadClientConfig()).rejects.toBeInstanceOf(ClientConfigError);
  });
});
