import { describe, expect, it, vi } from "vitest";

import { login, logout, refresh } from "./api";

describe("authentication API", () => {
  it("maps documented login response into the client auth session", async () => {
    // 测试目标：验证登录请求使用文档协议字段，并把 snake_case 响应映射成客户端 session。
    // 构造方法：替换全局 fetch 为成功响应，调用 login 并检查请求参数和返回值。
    // 输入数据：账号 12345678、密码 secret、响应 access_token/refresh_token/access_token_expires_at/im_chat_ws_url。
    // 预期行为：请求 POST /v1/auth/login，返回 camelCase AuthSession。
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user_id: 20001,
          access_token: "jwt-access-token",
          refresh_token: "refresh-token",
          access_token_expires_at: "2026-08-16T12:15:00+08:00",
          im_chat_ws_url: "ws://127.0.0.1:9001/ws",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("http://127.0.0.1:8080/", { account: "12345678", password: "secret" })).resolves.toEqual({
      userId: 20001,
      accessToken: "jwt-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:15:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9001/ws",
      refreshTokenPersistence: "session_only",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "12345678", password: "secret" }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("refreshes access token without expecting refresh token rotation", async () => {
    // 测试目标：验证 refresh 接口发送 refresh_token，且成功响应不需要新的 refresh_token。
    // 构造方法：替换 fetch 为 /refresh 成功响应，再调用 refresh。
    // 输入数据：refresh token refresh-token，响应 new-jwt-access-token。
    // 预期行为：请求 POST /v1/auth/refresh，返回 session 中仍保留原 refreshToken。
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user_id: 20001,
          access_token: "new-jwt-access-token",
          access_token_expires_at: "2026-08-16T12:30:00+08:00",
          im_chat_ws_url: "ws://127.0.0.1:9001/ws",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(refresh("http://127.0.0.1:8080", "refresh-token")).resolves.toEqual({
      userId: 20001,
      accessToken: "new-jwt-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:30:00+08:00",
      imChatWsUrl: "ws://127.0.0.1:9001/ws",
      refreshTokenPersistence: "session_only",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("sends refresh token in the logout body", async () => {
    // 测试目标：验证退出登录按文档从 JSON body 传 refresh_token，而不是 Bearer access token。
    // 构造方法：替换 fetch 为 204 响应，再调用 logout。
    // 输入数据：地址 http://127.0.0.1:8080、refresh token refresh-token。
    // 预期行为：请求 POST /v1/auth/logout，body 为 { refresh_token }。
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout("http://127.0.0.1:8080", "refresh-token")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("maps documented error_code values to branchable API errors", async () => {
    // 测试目标：验证客户端依赖 error_code 分支，而不是旧 error 字段或 message 文本。
    // 构造方法：替换 fetch 为 503 no_available_chat_node 响应后调用 login。
    // 输入数据：HTTP 503，正文 { error_code: "no_available_chat_node", message: "no available chat node" }。
    // 预期行为：Promise 拒绝为 code 等于 no_available_chat_node 的 AuthApiError。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error_code: "no_available_chat_node", message: "no available chat node" }), { status: 503 }),
      ),
    );

    await expect(login("http://127.0.0.1:8080", { account: "12345678", password: "secret" })).rejects.toMatchObject({
      code: "no_available_chat_node",
    });

    vi.unstubAllGlobals();
  });
});
