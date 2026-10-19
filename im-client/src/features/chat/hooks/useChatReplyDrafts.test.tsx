import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatDrafts } from "./useChatDrafts";
import type { ChatReplyTarget } from "../types";

const target: ChatReplyTarget = { messageId: "original", senderUserId: 2, messageType: "text", content: { text: "原文" } };

describe("reply drafts", () => {
  it("restores references per conversation and cancels without deleting the body", () => {
    // 测试目标：验证回复目标随会话保存，取消引用不清空正文。
    // 构造方法：在会话 1 设置正文和引用，切换会话 2，再切回并取消。
    // 输入数据：会话 1 的正文“答复”与 original 引用；会话 2 无引用。
    // 预期行为：两会话隔离，返回后引用恢复，取消后仍保留“答复”。
    const { result, rerender } = renderHook(({ id }) => useChatDrafts(id), { initialProps: { id: 1 } });
    act(() => { result.current.setDraft("答复"); result.current.setReply(target); });
    rerender({ id: 2 });
    expect(result.current.replyTo).toBeNull();
    rerender({ id: 1 });
    expect(result.current.replyTo).toEqual(target);
    act(() => result.current.setReply(null));
    expect(result.current.draft).toBe("答复");
    expect(result.current.replyTo).toBeNull();
  });

  it("clears a sent snapshot by conversation without clearing a newly chosen reply", () => {
    // 测试目标：验证异步发送后的清理不会删除新引用或其他会话草稿。
    // 构造方法：抓取会话 1 快照，改选引用，然后切换会话 2 并完成旧快照。
    // 输入数据：原引用 original、新引用 replacement，会话 2 正文“另一会话”。
    // 预期行为：会话 2 不变，会话 1 已发送正文清空但 replacement 引用保留。
    const { result, rerender } = renderHook(({ id }) => useChatDrafts(id), { initialProps: { id: 1 } });
    act(() => { result.current.setDraft("答复"); result.current.setReply(target); });
    const snapshot = result.current.snapshot(1);
    act(() => result.current.setReply({ ...target, messageId: "replacement" }));
    rerender({ id: 2 });
    act(() => result.current.setDraft("另一会话"));
    act(() => result.current.completeSend(snapshot));
    expect(result.current.draft).toBe("另一会话");
    rerender({ id: 1 });
    expect(result.current.draft).toBe("");
    expect(result.current.replyTo?.messageId).toBe("replacement");
  });
});
