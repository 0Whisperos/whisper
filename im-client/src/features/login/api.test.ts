import { describe, expect, it, vi } from "vitest";

import { login, logout } from "./api";

describe("authentication API", () => {
  it("posts login credentials and returns the server session", async () => {
    // 测试目标：验证登录请求使用配置地址、JSON 正文并返回服务端会话。
    // 构造方法：替换全局 fetch 为成功响应，调用 login 并检查请求参数。
    // 输入数据：账号 12345678、密码 secret、地址 http://127.0.0.1:8080。
    // 预期行为：请求 POST /v1/auth/login，返回完整 accessToken、account、expiresAt。
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: "raw-token",
          account: "12345678",
          expiresAt: "2026-08-02T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("http://127.0.0.1:8080/", { account: "12345678", password: "secret" })).resolves.toEqual({
      accessToken: "raw-token",
      account: "12345678",
      expiresAt: "2026-08-02T00:00:00Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ account: "12345678", password: "secret" }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("maps invalid credentials to a branchable API error", async () => {
    // 测试目标：验证错误密码可被 UI 区分为凭据错误，而非网络故障。
    // 构造方法：替换 fetch 为 401 invalid_credentials 响应后调用 login。
    // 输入数据：HTTP 401，正文 { error: "invalid_credentials" }。
    // 预期行为：Promise 拒绝为 code 等于 invalid_credentials 的 AuthApiError。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }),
      ),
    );

    await expect(login("http://127.0.0.1:8080", { account: "12345678", password: "wrong" })).rejects.toMatchObject({
      code: "invalid_credentials",
    });

    vi.unstubAllGlobals();
  });

  it("sends the raw token as a Bearer header during logout", async () => {
    // 测试目标：验证退出登录使用内存中的原始令牌调用幂等退出接口。
    // 构造方法：替换 fetch 为 204 响应，再调用 logout。
    // 输入数据：地址 http://127.0.0.1:8080、令牌 raw-token。
    // 预期行为：请求 POST /v1/auth/logout，并携带 Authorization: Bearer raw-token。
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout("http://127.0.0.1:8080", "raw-token")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer raw-token" },
      }),
    );
    vi.unstubAllGlobals();
  });
});
