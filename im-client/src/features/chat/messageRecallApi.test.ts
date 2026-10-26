import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMessageRecallStatuses } from "./messageRecallApi";
import { recalledAt } from "./tests/recallFixtures";
afterEach(() => vi.unstubAllGlobals());
describe("recall status API", () => {
  it("posts deduplicated IDs with the token and returns only requested statuses", async () => {
    // 测试目标：验证状态API请求格式、账号凭证与响应范围。
    // 构造方法：替换fetch返回活动、撤回及额外消息记录。
    // 输入数据：api尾斜线、token、会话42、重复m和n。
    // 预期行为：POST正确路径/JSON/header，忽略非请求记录并保留null状态。
    const fetch = vi.fn(async () => new Response(JSON.stringify({ statuses: [
      { message_id: "m", recalled_at: recalledAt }, { message_id: "n", recalled_at: null }, { message_id: "other", recalled_at: recalledAt },
    ] }))); vi.stubGlobal("fetch", fetch);
    expect(await loadMessageRecallStatuses("https://api/", "token", 42, ["m", "m", "n"])).toEqual([
      { message_id: "m", recalled_at: recalledAt }, { message_id: "n", recalled_at: null },
    ]);
    expect(fetch).toHaveBeenCalledWith("https://api/v1/conversations/42/messages/statuses", expect.objectContaining({
      method: "POST", body: JSON.stringify({ message_ids: ["m", "n"] }),
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    }));
  });
  it.each([{ statuses: [{ message_id: "m", recalled_at: 3 }] }, { statuses: [{ message_id: "m" }] }, { statuses: "bad" }])("rejects malformed status data %j", async (value) => {
    // 测试目标：验证错误状态字段不会被当成活动消息或撤回事实。
    // 构造方法：fetch返回格式错误的成功响应。
    // 输入数据：数字撤回时间、缺失撤回字段或非数组statuses。
    // 预期行为：拒绝响应，由调用方保留现有状态并提供重试。
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value))));
    await expect(loadMessageRecallStatuses("https://api", "token", 42, ["m"])).rejects.toThrow("响应无效");
  });
});
