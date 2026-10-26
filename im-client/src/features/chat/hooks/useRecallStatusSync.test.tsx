import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecallStatusSync, type RecallTarget } from "./useRecallStatusSync";
import { loadMessageRecallStatuses } from "../messageRecallApi";
import type { ChatData } from "../types";
import { recallData, recallMessage, recalledAt } from "../tests/recallFixtures";
vi.mock("../messageRecallApi", () => ({ loadMessageRecallStatuses: vi.fn() }));
const load = vi.mocked(loadMessageRecallStatuses);
function options(data: ChatData | null = recallData()) {
  return { apiBaseUrl: "https://api", userId: 1, accessToken: "a", connectionId: "connection-1" as string | null,
    data, draftTargets: [] as RecallTarget[], mergeRecalls: vi.fn() };
}
beforeEach(() => { vi.clearAllMocks(); load.mockResolvedValue([]); });
describe("loaded-message recall calibration", () => {
  it.each([true, false])("waits for both authentication and bootstrap (authFirst=%s)", async (authFirst) => {
    // 测试目标：验证认证与bootstrap任意先后都不会漏掉首次校准。
    // 构造方法：先仅提供认证或数据，再提供另外一项。
    // 输入数据：connection-1及会话42消息m。
    // 预期行为：条件不齐不请求，两者就绪后请求一次，普通重复render不重发。
    const initial = options(authFirst ? null : recallData()); if (!authFirst) initial.connectionId = null;
    const hook = renderHook((props: ReturnType<typeof options>) => useRecallStatusSync(props), { initialProps: initial });
    expect(load).not.toHaveBeenCalled();
    hook.rerender({ ...initial, connectionId: "connection-1", data: recallData() });
    await waitFor(() => expect(load).toHaveBeenCalledExactlyOnceWith("https://api", "a", 42, ["m"]));
    hook.rerender({ ...initial, connectionId: "connection-1", data: recallData() });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("batches 100 IDs, includes references and drafts, preserves partial failures and retries", async () => {
    // 测试目标：验证100条分批、引用和草稿目标收集、部分失败不清状态且可重试。
    // 构造方法：创建101条正式消息并增加引用/草稿目标，让第二批失败再手动重试。
    // 输入数据：m0..m100、引用quoted、草稿draft、第一批m0已撤回。
    // 预期行为：批次100和3；仅成功批合并，显示校准失败；重试后使用最新token并清除错误。
    load.mockImplementation(async (_api, _token, _conversation, ids) => {
      if (ids.includes("m100")) throw new Error("network");
      return [{ message_id: "m0", recalled_at: recalledAt }];
    });
    const data = recallData(Array.from({ length: 101 }, (_, i) => recallMessage(`m${i}`, { replyToMessageId: i === 0 ? "quoted" : null })));
    const initial = { ...options(data), draftTargets: [{ conversationId: 42, messageId: "draft" }] };
    const hook = renderHook((props: typeof initial) => useRecallStatusSync(props), { initialProps: initial });
    await waitFor(() => expect(hook.result.current.error).toBe("撤回状态校准失败"));
    expect(load.mock.calls.map((call) => call[3].length)).toEqual([100, 3]);
    expect(initial.mergeRecalls).toHaveBeenCalledTimes(1);
    load.mockResolvedValue([]); hook.rerender({ ...initial, accessToken: "renewed" });
    act(() => hook.result.current.retry());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
    expect(load.mock.calls[2][1]).toBe("renewed"); expect(hook.result.current.error).toBe("");
  });
  it("scans new IDs and every new connection while discarding another account's in-flight response", async () => {
    // 测试目标：验证已认证期间新ID补扫、重认证重扫及账号/API隔离。
    // 构造方法：首批请求挂起，切账号/API后完成旧请求，再增加消息并切connectionId。
    // 输入数据：旧账号m、另一API用户2、新消息n、新connection-2。
    // 预期行为：旧响应不合并，新ID单独查，新连接重新查全部正式消息。
    let release!: (value: { message_id: string; recalled_at: string }[]) => void;
    load.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const initial = options();
    const hook = renderHook((props: typeof initial) => useRecallStatusSync(props), { initialProps: initial });
    const other = { ...initial, apiBaseUrl: "https://other", userId: 2, mergeRecalls: vi.fn() };
    hook.rerender(other);
    await act(async () => release([{ message_id: "m", recalled_at: recalledAt }]));
    expect(initial.mergeRecalls).not.toHaveBeenCalled();
    hook.rerender({ ...other, data: recallData([recallMessage(), recallMessage("n")]) });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load.mock.calls[2][3]).toEqual(["n"]);
    hook.rerender({ ...other, connectionId: "connection-2", data: recallData([recallMessage(), recallMessage("n")]) });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(4)); expect(load.mock.calls[3][3]).toEqual(["m", "n"]);
  });
});
