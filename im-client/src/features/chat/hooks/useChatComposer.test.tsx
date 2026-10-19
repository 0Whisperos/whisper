import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatReplyTarget } from "../types";
import type { ChatDraftBlock } from "./useChatDrafts";
import { useChatComposer } from "./useChatComposer";
const { uploadDraftImages } = vi.hoisted(() => ({ uploadDraftImages: vi.fn() }));
vi.mock("./uploadDraftImages", () => ({ uploadDraftImages }));
const target: ChatReplyTarget = { messageId: "original", senderUserId: 2, messageType: "text", content: { text: "原文" } };
const image = { type: "image" as const, localId: "local-image", file: new File(["image"], "a.png", { type: "image/png" }), previewUrl: "blob:draft" };
describe("composer snapshots", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:message"), revokeObjectURL: vi.fn() });
    uploadDraftImages.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());
  it("preserves a newly selected reply and another conversation during upload", async () => {
    // 测试目标：验证上传后只发送旧快照，不清错会话或新引用。
    // 构造方法：挂起会话 1 上传，改选引用，切到会话 2，再完成上传。
    // 输入数据：original 原引用、new-target 新引用、会话 2 正文。
    // 预期行为：仅发送一次至会话 1 并引用 original，新引用与会话 2 草稿保留。
    let finish!: (blocks: ChatDraftBlock[]) => void;
    uploadDraftImages.mockImplementation(() => new Promise<ChatDraftBlock[]>((resolve) => { finish = resolve; }));
    const sendRich = vi.fn(() => "client-1");
    const { result, rerender } = renderHook(({ id }) => useChatComposer({ conversationId: id, apiBaseUrl: "https://api.test", accessToken: "token",
      userId: 1, canSendMessages: true, onSendText: vi.fn(), onSendRich: sendRich }), { initialProps: { id: 1 } });
    act(() => { result.current.drafts.setBlocks([image]); result.current.drafts.setReply(target); });
    let sending!: Promise<void>;
    act(() => { sending = result.current.sendEditor(); });
    act(() => { void result.current.sendEditor(); result.current.drafts.setReply({ ...target, messageId: "new-target" }); });
    expect(uploadDraftImages).toHaveBeenCalledTimes(1);
    rerender({ id: 2 });
    act(() => result.current.drafts.setDraft("另一会话"));
    expect(result.current.isBusy).toBe(false);
    await act(async () => { finish([{ ...image, uploaded: true, attachmentId: "att-1" }]); await sending; });
    expect(sendRich).toHaveBeenCalledWith(1, [{ type: "image", attachment_id: "att-1", previewUrl: "blob:message" }], target);
    expect(result.current.drafts.draft).toBe("另一会话");
    rerender({ id: 1 });
    expect(result.current.drafts.replyTo?.messageId).toBe("new-target");
    expect(result.current.drafts.blocks.some((block) => block.type === "image")).toBe(false);
  });
  it("keeps body and reference after upload failure", async () => {
    // 测试目标：验证上传失败不发送部分消息，保留草稿和引用。
    // 构造方法：上传替身拒绝，草稿包含一张图片及原引用。
    // 输入数据：a.png、original、错误“上传失败”。
    // 预期行为：不发送，有失败提示，草稿和引用仍在，busy 结束。
    uploadDraftImages.mockRejectedValue(new Error("上传失败"));
    const onSendRich = vi.fn();
    const { result } = renderHook(() => useChatComposer({ conversationId: 1, apiBaseUrl: "https://api.test", accessToken: "token",
      userId: 1, canSendMessages: true, onSendText: vi.fn(), onSendRich }));
    act(() => { result.current.drafts.setBlocks([image]); result.current.drafts.setReply(target); });
    await act(() => result.current.sendEditor());
    expect(onSendRich).not.toHaveBeenCalled();
    expect(result.current.statusMessage).toBe("上传失败");
    expect(result.current.drafts.replyTo).toEqual(target);
    expect(result.current.drafts.blocks).toEqual([image]);
    expect(result.current.isBusy).toBe(false);
  });

  it("allows a multi-code-point emoji sequence at the 4096 character limit", async () => {
    // 测试目标：验证服务端一致的 Unicode 码点上限允许恰好 4096 个码点的消息。
    // 构造方法：设置 4092 个 ASCII 字符和四码点肤色 ZWJ 表情，再调用编辑器发送流程。
    // 输入数据："x" 重复 4092 次后接“👨🏽‍💻”，总计 4096 个 Unicode 码点。
    // 预期行为：普通文本发送回调收到完整原文，且不显示长度错误。
    const onSendText = vi.fn();
    const { result } = renderHook(() => useChatComposer({ conversationId: 1, apiBaseUrl: "https://api.test", accessToken: "token",
      userId: 1, canSendMessages: true, onSendText, onSendRich: vi.fn() }));
    const message = `${"x".repeat(4092)}👨🏽‍💻`;
    act(() => result.current.drafts.setDraft(message));

    await act(async () => { await result.current.sendEditor(); });

    expect(onSendText).toHaveBeenCalledWith(1, message);
    expect(result.current.statusMessage).toBe("");
  });

  it("rejects a multi-code-point emoji sequence that exceeds the 4096 character limit", async () => {
    // 测试目标：验证多码点表情使消息超过 4096 码点时，客户端阻止发送并保留草稿。
    // 构造方法：设置 4093 个 ASCII 字符和四码点肤色 ZWJ 表情，再调用编辑器发送流程。
    // 输入数据："x" 重复 4093 次后接“👨🏽‍💻”，总计 4097 个 Unicode 码点。
    // 预期行为：不调用发送回调，提示长度错误，且完整消息仍留在草稿中。
    const onSendText = vi.fn();
    const { result } = renderHook(() => useChatComposer({ conversationId: 1, apiBaseUrl: "https://api.test", accessToken: "token",
      userId: 1, canSendMessages: true, onSendText, onSendRich: vi.fn() }));
    const message = `${"x".repeat(4093)}👨🏽‍💻`;
    act(() => result.current.drafts.setDraft(message));

    await act(async () => { await result.current.sendEditor(); });

    expect(onSendText).not.toHaveBeenCalled();
    expect(result.current.statusMessage).toBe("消息文字不能超过 4096 个字符");
    expect(result.current.drafts.draft).toBe(message);
  });
});
