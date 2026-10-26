import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageRecall } from "./useMessageRecall";
import { recallData, recallMessage, recalledAt } from "../tests/recallFixtures";
import type { ChatRecallAcceptedFrame } from "../../chat-connection/types";

const accepted: ChatRecallAcceptedFrame = { type: "recall_message_accepted", request_id: "late",
  payload: { message_id: "m", conversation_id: 42, conversation_seq: 1, sender_user_id: 1, recalled_at: recalledAt } };
function fixture() {
  const initialProps = { owner: "https://api:1", data: recallData(), canSend: true, sendRecall: vi.fn(), mergeRecalls: vi.fn() };
  return { ...renderHook((props: typeof initialProps) => useMessageRecall(props), { initialProps }), initialProps };
}
afterEach(() => vi.useRealTimers());
describe("recall requests", () => {
  it("deduplicates pending attempts, times out after 15 seconds and accepts late success", () => {
    // 测试目标：验证撤回pending去重、超时可重试以及迟到成功仍合并。
    // 构造方法：固定时钟，连续撤回两次，推进15秒，再重试并注入首次成功。
    // 输入数据：本人accepted消息m，第一次响应延迟超过15秒。
    // 预期行为：首次只发一次，超时保留原文且可重试，迟到成功合并并清除pending。
    vi.useFakeTimers(); const hook = fixture();
    act(() => { hook.result.current.recall(recallMessage()); hook.result.current.recall(recallMessage()); });
    expect(hook.initialProps.sendRecall).toHaveBeenCalledTimes(1);
    expect(hook.initialProps.mergeRecalls).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(15_000));
    expect(hook.result.current.feedback).toContain("待确认");
    act(() => hook.result.current.recall(recallMessage()));
    expect(hook.initialProps.sendRecall).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.handleFrame(accepted));
    expect(hook.initialProps.mergeRecalls).toHaveBeenCalledWith(42, [accepted.payload]);
    expect(hook.result.current.pendingIds.size).toBe(0);
  });
  it("ignores obsolete rejection after an event and isolates owner changes", () => {
    // 测试目标：验证事件成功后的迟到失败不覆盖，账号变化清理旧请求。
    // 构造方法：发起撤回，先收事件再收同request_id失败；再发起请求并换账号。
    // 输入数据：m的message_recalled、旧internal_error、不同owner。
    // 预期行为：成功后无失败反馈；换账号后旧计时器不产生反馈且pending为空。
    vi.useFakeTimers(); const hook = fixture();
    act(() => hook.result.current.recall(recallMessage()));
    const requestId = hook.initialProps.sendRecall.mock.calls[0][1];
    act(() => { hook.result.current.handleFrame({ type: "message_recalled", payload: { ...accepted.payload, event_id: "e" } });
      hook.result.current.handleFrame({ type: "recall_message_rejected", request_id: requestId, payload: { error_code: "internal_error", message: "failed" } }); });
    expect(hook.result.current.feedback).toBe("");
    act(() => hook.result.current.recall(recallMessage()));
    hook.rerender({ ...hook.initialProps, owner: "https://api:2" });
    act(() => vi.advanceTimersByTime(20_000));
    expect(hook.result.current.feedback).toBe(""); expect(hook.result.current.pendingIds.size).toBe(0);
  });
});
