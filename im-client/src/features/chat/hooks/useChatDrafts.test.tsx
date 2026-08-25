import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChatDrafts } from "./useChatDrafts";

describe("useChatDrafts", () => {
  it("keeps drafts isolated by conversation id", () => {
    // 测试目标：验证每个会话拥有独立草稿，且发送态由当前会话草稿 trim 后内容决定。
    // 构造方法：用 renderHook 在两个 conversationId 间切换并分别写入草稿。
    // 输入数据：conversationId=10002 的空白草稿，以及 conversationId=10005 的“同步草稿”。
    // 预期行为：切回各会话时恢复对应原文，空白草稿 canSend=false，正文草稿 canSend=true。
    const { result, rerender } = renderHook(({ id }) => useChatDrafts(id), { initialProps: { id: 10002 } });

    act(() => result.current.setDraft("   "));
    expect(result.current.canSend).toBe(false);
    rerender({ id: 10005 });
    act(() => result.current.setDraft("同步草稿"));
    expect(result.current.canSend).toBe(true);
    rerender({ id: 10002 });

    expect(result.current.draft).toBe("   ");
    expect(result.current.canSend).toBe(false);
    rerender({ id: 10005 });
    expect(result.current.draft).toBe("同步草稿");
    expect(result.current.canSend).toBe(true);
  });

  it("does not collide with object prototype property names", () => {
    // 测试目标：验证特殊会话 id 不会读取 Object 原型属性或覆盖普通会话草稿。
    // 构造方法：直接使用 hook 暴露的 setDraftForConversation/getDraft 操作 constructor 槽位。
    // 输入数据：conversationId=constructor 的“特殊草稿”和 conversationId=10002 的“普通草稿”。
    // 预期行为：两个槽位各自返回写入值，未知槽位返回空字符串。
    const { result } = renderHook(() => useChatDrafts(10002));

    act(() => {
      result.current.setDraftForConversation("constructor", "特殊草稿");
      result.current.setDraftForConversation(10002, "普通草稿");
    });

    expect(result.current.getDraft("constructor")).toBe("特殊草稿");
    expect(result.current.getDraft(10002)).toBe("普通草稿");
    expect(result.current.getDraft("toString")).toBe("");
  });
});
