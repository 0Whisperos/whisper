import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAuthSession } from "./useAuthSession";

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));

vi.mock("../api", () => ({ logout: logoutMock }));

describe("useAuthSession", () => {
  it("clears the in-memory session even when logout fails", async () => {
    // 测试目标：验证网络或服务端退出失败不能保留本地令牌。
    // 构造方法：建立内存会话，让 logout API 拒绝后调用 hook 的 logout。
    // 输入数据：会话令牌 raw-token，logout rejection 为 Error("offline")。
    // 预期行为：logout 后 session 为 null。
    logoutMock.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAuthSession("http://127.0.0.1:8080"));

    act(() => {
      result.current.setSession({ accessToken: "raw-token", account: "12345678", expiresAt: "2026-08-02T00:00:00Z" });
    });
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.session).toBeNull();
  });
});
