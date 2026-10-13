import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useChatDrafts, type DraftImageBlock } from "./useChatDrafts";

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

  it("keeps image blocks in caret order when switching conversations", () => {
    // 测试目标：验证选图插入文本光标位置后形成有序 blocks，并随会话切换保留文件草稿。
    // 构造方法：模拟本地预览 URL，在会话 10002 输入文本并将图片插入偏移 1，再切换到另一个会话。
    // 输入数据：文本“前后”和文件 photo.png，插入位置为 1。
    // 预期行为：顺序为“前”、图片、“后”；切换回来后块顺序及文件仍保留，且图片草稿允许发送。
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() });
    const { result, rerender } = renderHook(({ id }) => useChatDrafts(id), { initialProps: { id: 10002 } });
    const photo = new File(["png"], "photo.png", { type: "image/png" });
    act(() => { result.current.setDraft("前后"); result.current.insertFiles([photo], 1); });
    expect(result.current.blocks.map((block) => block.type === "text" ? block.text : block.file.name)).toEqual(["前", "photo.png", "后"]);
    rerender({ id: 10005 });
    expect(result.current.blocks).toEqual([{ type: "text", id: expect.any(String), text: "" }]);
    rerender({ id: 10002 });
    expect(result.current.blocks).toHaveLength(3);
    expect(result.current.canSend).toBe(true);
    vi.unstubAllGlobals();
  });

  it("preserves uploaded image metadata while editing and revokes its preview when removed", () => {
    // 测试目标：验证富文本编辑更新顺序时保留图片上传状态，删除图片后释放本地预览 URL。
    // 构造方法：创建包含已上传图片的草稿，先更新相邻文字，再从 blocks 中移除图片。
    // 输入数据：已 uploaded 的 photo.png 图片块及文字“前后”。
    // 预期行为：文字变更后附件 ID 和 uploaded 状态保留；删除图片时对应 URL 只释放一次。
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL });
    const { result } = renderHook(() => useChatDrafts(10002));
    const photo = new File(["png"], "photo.png", { type: "image/png" });
    const image: DraftImageBlock = { ...result.current.createImageBlocks([photo])[0], attachmentId: "att-1", uploaded: true };
    act(() => {
      result.current.setBlocks([{ type: "text", id: "before", text: "前" }, image, { type: "text", id: "after", text: "后" }]);
    });
    act(() => result.current.setBlocks([{ type: "text", id: "before", text: "之前" }, image, { type: "text", id: "after", text: "后" }]));
    expect(result.current.blocks.find((block) => block.type === "image")).toMatchObject({ attachmentId: "att-1", uploaded: true });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => result.current.setBlocks([{ type: "text", id: "joined", text: "之前后" }]));
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:photo");
    vi.unstubAllGlobals();
  });
});
