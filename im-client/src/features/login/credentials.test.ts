import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteRefreshToken, loadSavedRefreshToken, saveRefreshToken } from "./credentials";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("login credential API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the saved refresh token through a Tauri command", async () => {
    // 测试目标：验证前端通过封装层读取本地 refresh token，而不是直接访问平台存储。
    // 构造方法：mock Tauri invoke 返回 refresh-token，并调用 loadSavedRefreshToken。
    // 输入数据：command 返回 "refresh-token"。
    // 预期行为：调用 load_saved_refresh_token，并返回 refresh-token。
    invokeMock.mockResolvedValueOnce("refresh-token");

    await expect(loadSavedRefreshToken()).resolves.toBe("refresh-token");

    expect(invokeMock).toHaveBeenCalledWith("load_saved_refresh_token");
  });

  it("saves the refresh token through a Tauri command", async () => {
    // 测试目标：验证登录成功后 refresh token 会通过稳定 command 保存。
    // 构造方法：mock Tauri invoke 成功，再调用 saveRefreshToken。
    // 输入数据：refresh token "refresh-token"。
    // 预期行为：调用 save_refresh_token，参数为 { refreshToken }。
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(saveRefreshToken("refresh-token")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("save_refresh_token", { refreshToken: "refresh-token" });
  });

  it("deletes the saved refresh token through a Tauri command", async () => {
    // 测试目标：验证主动退出登录时通过稳定 command 删除本地 refresh token。
    // 构造方法：mock Tauri invoke 成功，再调用 deleteRefreshToken。
    // 输入数据：无参数。
    // 预期行为：调用 delete_refresh_token。
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(deleteRefreshToken()).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("delete_refresh_token");
  });
});
