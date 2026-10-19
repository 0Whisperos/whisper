import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForwardMessageDraft } from "../messageForwarding";
import type { ChatData, ChatMessage } from "../types";
import { useMessageForwarding } from "./useMessageForwarding";

const { prepareForwardMessage, requestUploadAuthorizations, uploadSignedFile, confirmUploads } = vi.hoisted(() => ({
  prepareForwardMessage: vi.fn(), requestUploadAuthorizations: vi.fn(), uploadSignedFile: vi.fn(), confirmUploads: vi.fn(),
}));
vi.mock("../messageForwarding", async (importOriginal) => ({
  ...await importOriginal<typeof import("../messageForwarding")>(), prepareForwardMessage,
}));
vi.mock("../attachmentsApi", () => ({ requestUploadAuthorizations, uploadSignedFile, confirmUploads }));

function message(rich = false): ChatMessage {
  return { localKey: "source", messageId: "source", conversationId: 1, conversationSeq: 1, senderUserId: 2,
    clientMessageId: "original", messageType: rich ? "rich" : "text",
    content: rich ? { blocks: [{ type: "text", text: "前" }, { type: "image", attachment_id: "old-a" },
      { type: "text", text: "后" }, { type: "image", attachment_id: "old-b" }] } : { text: " 原文 " },
    replyToMessageId: "quoted", createdAt: "2026-10-19", clientSentAt: "2026-10-19", localStatus: "accepted",
    displayTime: "", showTime: true, showAvatar: true };
}
function data(rich = false): ChatData {
  const profile = { userId: 1, name: "自己", avatar: "自", tone: "blue" as const, account: "me" };
  const conversation = { conversationId: 1, type: "direct" as const, name: "好友", avatar: "友",
    tone: "blue" as const, status: "", participants: {}, messages: [message(rich)] };
  return { self: profile, conversations: { 1: conversation, 2: { ...conversation, conversationId: 2, messages: [] } },
    sessions: [], contacts: [], contactSections: [] };
}
function draft(rich = false): ForwardMessageDraft {
  return { messageType: rich ? "rich" : "text", blocks: rich ? [{ type: "text", id: "before", text: "前" },
    { type: "image", localId: "a", file: new File(["abc"], "a.png", { type: "image/png" }), previewUrl: "" },
    { type: "text", id: "after", text: "后" },
    { type: "image", localId: "b", file: new File(["def"], "b.png", { type: "image/png" }), previewUrl: "" }]
    : [{ type: "text", id: "text", text: " 原文 " }] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
function renderForwarding(initialData = data()) {
  const sendMessage = vi.fn((): string | null => "forward-client");
  const retryMessage = vi.fn();
  const initialProps = { data: initialData, accessToken: "token-1", canSendMessages: true, apiBaseUrl: "https://api" };
  const hook = renderHook((props: typeof initialProps) => useMessageForwarding({ ...props, sendMessage, retryMessage }), { initialProps });
  const start = () => act(() => { hook.result.current.open(initialData.conversations[1].messages[0]); hook.result.current.selectTarget(2); hook.result.current.submit(); });
  return { ...hook, sendMessage, retryMessage, start, initialProps };
}

beforeEach(() => {
  vi.clearAllMocks();
  prepareForwardMessage.mockImplementation(async (source: ChatMessage) => draft(source.messageType === "rich"));
  requestUploadAuthorizations.mockImplementation(async (_api: string, _token: string, _id: number, files: Array<{ file_name: string }>) =>
    files.map((file) => ({ attachment_id: `new-${file.file_name[0]}`, upload_url: `https://oss/${file.file_name}`, method: "PUT",
      headers: {}, expires_at: "2099-01-01T00:00:00Z" })));
  uploadSignedFile.mockResolvedValue(undefined);
  confirmUploads.mockImplementation(async (_api: string, _token: string, ids: string[]) => ids.map((attachment_id) => ({ attachment_id, status: "uploaded" })));
});
afterEach(() => vi.useRealTimers());

describe("independent forwarding task", () => {
  it("submits once, preserves source data and closes only after acceptance", async () => {
    // 测试目标：验证新普通消息独立发送、同步防双击、正式确认后才报告成功。
    // 构造方法：启动文字转发并重复提交，再向 data 加入相同 client ID 的 accepted 消息。
    // 输入数据：源正文“ 原文 ”、原引用 quoted、目标会话 2。
    // 预期行为：仅发送一次无引用载荷，原 data 不变，sending 时保留弹窗，accepted 后关闭并反馈成功。
    const input = data(); const before = JSON.stringify(input);
    const hook = renderForwarding(input); hook.start(); act(() => hook.result.current.submit());
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    expect(hook.sendMessage).toHaveBeenCalledWith(2, { messageType: "text", content: { text: " 原文 " } });
    expect(JSON.stringify(input)).toBe(before); expect(hook.result.current.phase).toBe("sending");
    const accepted = { ...message(), senderUserId: 1, conversationId: 2, clientMessageId: "forward-client" };
    hook.rerender({ ...hook.initialProps, data: { ...input, conversations: { ...input.conversations,
      2: { ...input.conversations[2], messages: [accepted] } } } });
    await waitFor(() => expect(hook.result.current.source).toBeNull());
    expect(hook.result.current.feedback).toBe("转发成功");
  });

  it("does not leave sending when the send callback returns null", async () => {
    // 测试目标：验证发送入口拒绝不会造成永久 sending，且重试不创建虚假的提交状态。
    // 构造方法：sendMessage 先返回 null，失败后允许返回固定 ID 并重试。
    // 输入数据：文字消息和目标会话 2。
    // 预期行为：第一次 failed/submitted=false；第二次成功提交，不重新下载源正文。
    const hook = renderForwarding(); hook.sendMessage.mockReturnValueOnce(null); hook.start();
    await waitFor(() => expect(hook.result.current.phase).toBe("failed"));
    expect(hook.result.current.submitted).toBe(false);
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.submitted).toBe(true));
    expect(prepareForwardMessage).toHaveBeenCalledTimes(1); expect(hook.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("clears successful feedback after three seconds", async () => {
    // 测试目标：验证成功提示会自动消失，避免永久遮挡界面。
    // 构造方法：先正常提交，再使用假时钟注入 accepted 并推进三秒。
    // 输入数据：forward-client 的成功确认与 3000ms。
    // 预期行为：确认后显示“转发成功”，三秒后 feedback 为空。
    const hook = renderForwarding(); hook.start();
    await waitFor(() => expect(hook.result.current.submitted).toBe(true));
    vi.useFakeTimers();
    const next = data(); next.conversations[2].messages = [{ ...message(), senderUserId: 1,
      conversationId: 2, clientMessageId: "forward-client" }];
    hook.rerender({ ...hook.initialProps, data: next });
    expect(hook.result.current.feedback).toBe("转发成功");
    act(() => vi.advanceTimersByTime(3_000));
    expect(hook.result.current.feedback).toBe("");
  });

  it.each(["acknowledgement_timeout", "send_failed"])("retries submitted %s with the same client ID", async (errorCode) => {
    // 测试目标：验证确认超时或拒绝后的重试沿用同一消息幂等键和固定正文。
    // 构造方法：提交成功后注入失败本地消息，移除源消息，再重复点击重试。
    // 输入数据：当前行错误码、forward-client、已移除源消息。
    // 预期行为：调用一次 retryMessage(forward-client)，不重新发送、下载或依赖源状态。
    const hook = renderForwarding(); hook.start();
    await waitFor(() => expect(hook.result.current.submitted).toBe(true));
    const next = data(); next.conversations[1].messages = [];
    next.conversations[2].messages = [{ ...message(), senderUserId: 1, conversationId: 2, clientMessageId: "forward-client", localStatus: "failed", errorCode }];
    hook.rerender({ ...hook.initialProps, data: next });
    expect(hook.result.current.phase).toBe("failed");
    act(() => { hook.result.current.retry(); hook.result.current.retry(); });
    expect(hook.retryMessage).toHaveBeenCalledExactlyOnceWith("forward-client");
    expect(hook.sendMessage).toHaveBeenCalledTimes(1); expect(prepareForwardMessage).toHaveBeenCalledTimes(1);
  });

  it("retains successful image metadata and retries only missing uploads", async () => {
    // 测试目标：验证部分图片失败不发送，并复用完整源 Files 与成功上传元数据。
    // 构造方法：第一次上传 b 失败、a 成功；移除源会话后第二次重试成功。
    // 输入数据：前/a/后/b 图文，目标新附件 new-a/new-b。
    // 预期行为：首轮无发送，重试只补 b，最终按原序发送且没有 preview/reply，源准备仅一次。
    let bAttempts = 0;
    uploadSignedFile.mockImplementation(async (auth: { attachment_id: string }) => {
      if (auth.attachment_id === "new-b" && bAttempts++ === 0) throw new Error("upload failed");
    });
    const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(hook.result.current.phase).toBe("failed"));
    expect(hook.sendMessage).not.toHaveBeenCalled();
    hook.rerender({ ...hook.initialProps, data: { ...hook.initialProps.data, conversations: { 2: hook.initialProps.data.conversations[2] } } });
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    expect(uploadSignedFile.mock.calls.map(([auth]) => auth.attachment_id)).toEqual(["new-a", "new-b", "new-b"]);
    expect(requestUploadAuthorizations).toHaveBeenCalledTimes(1); expect(prepareForwardMessage).toHaveBeenCalledTimes(1);
    expect(hook.sendMessage).toHaveBeenCalledWith(2, { messageType: "rich", content: { blocks: [
      { type: "text", text: "前" }, { type: "image", attachment_id: "new-a" },
      { type: "text", text: "后" }, { type: "image", attachment_id: "new-b" },
    ] } });
  });

  it("keeps the selector after source download failure and retries the whole preparation", async () => {
    // 测试目标：验证源下载失败不上传、不发送，允许完整重新获取。
    // 构造方法：第一次准备源正文失败，第二次恢复成功。
    // 输入数据：图文源消息、错误“download failed”。
    // 预期行为：失败保留源和目标；重试后准备调用两次并发送完整消息。
    prepareForwardMessage.mockRejectedValueOnce(new Error("download failed"));
    const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(hook.result.current.error).toBe("download failed"));
    expect(requestUploadAuthorizations).not.toHaveBeenCalled(); expect(hook.result.current.selectedConversationId).toBe(2);
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    expect(prepareForwardMessage).toHaveBeenCalledTimes(2);
  });

  it("continues from independent Files after the complete source disappears", async () => {
    // 测试目标：验证完整获取源内容后，转发任务不再依赖源消息的后续存在状态。
    // 构造方法：完成源下载并挂起上传，移除源会话，再令上传成功。
    // 输入数据：独立 a/b Files、已移除源会话、完成的 PUT。
    // 预期行为：保留任务与 Files，不重新获取源，最终完整发送至目标 2。
    const uploading = deferred<void>(); uploadSignedFile.mockReturnValueOnce(uploading.promise);
    const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(uploadSignedFile).toHaveBeenCalledTimes(2));
    const independent = { ...hook.initialProps.data, conversations: { 2: hook.initialProps.data.conversations[2] } };
    hook.rerender({ ...hook.initialProps, data: independent });
    await act(async () => { uploading.resolve(); await uploading.promise; });
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    expect(prepareForwardMessage).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe("sending");
  });

  it.each(["close", "unmount", "user", "api"])("discards old source preparation after %s", async (action) => {
    // 测试目标：验证取消、卸载、换用户或服务端后旧异步结果不能继续转发。
    // 构造方法：挂起源准备，执行当前行生命周期操作，再完成旧准备。
    // 输入数据：图文源 Files、用户 99 或新 API 地址。
    // 预期行为：不申请上传、不发送；仍挂载的界面清除任务。
    const pending = deferred<ForwardMessageDraft>(); prepareForwardMessage.mockReturnValue(pending.promise);
    const hook = renderForwarding(data(true)); hook.start();
    if (action === "close") act(() => hook.result.current.close());
    if (action === "unmount") hook.unmount();
    if (action === "user") hook.rerender({ ...hook.initialProps, data: { ...hook.initialProps.data, self: { ...hook.initialProps.data.self, userId: 99 } } });
    if (action === "api") hook.rerender({ ...hook.initialProps, apiBaseUrl: "https://new-api" });
    await act(async () => { pending.resolve(draft(true)); await pending.promise; });
    expect(requestUploadAuthorizations).not.toHaveBeenCalled(); expect(hook.sendMessage).not.toHaveBeenCalled();
    if (action !== "unmount") expect(hook.result.current.source).toBeNull();
  });

  it("stops before upload when canceled during authorization", async () => {
    // 测试目标：验证取消发生在上传授权阶段时，不启动 PUT 或后续确认。
    // 构造方法：挂起目标授权，取消后返回两项有效授权。
    // 输入数据：new-a/new-b 目标附件授权。
    // 预期行为：无上传、确认或发送，任务保持关闭。
    const pending = deferred<unknown[]>(); requestUploadAuthorizations.mockReturnValue(pending.promise);
    const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(hook.result.current.phase).toBe("uploading"));
    act(() => hook.result.current.close());
    await act(async () => { pending.resolve([]); await pending.promise; });
    expect(uploadSignedFile).not.toHaveBeenCalled(); expect(confirmUploads).not.toHaveBeenCalled(); expect(hook.sendMessage).not.toHaveBeenCalled();
  });

  it("stops before confirmation when canceled during upload", async () => {
    // 测试目标：验证已在途 PUT 可结束，但取消后不会确认或发送。
    // 构造方法：挂起所有 PUT，关闭任务后完成上传。
    // 输入数据：a/b 两张图及已取消任务。
    // 预期行为：确认与发送均未调用，旧结果不会重新打开弹窗。
    const pending = deferred<void>(); uploadSignedFile.mockReturnValue(pending.promise);
    const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(uploadSignedFile).toHaveBeenCalledTimes(2)); act(() => hook.result.current.close());
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(confirmUploads).not.toHaveBeenCalled(); expect(hook.sendMessage).not.toHaveBeenCalled(); expect(hook.result.current.source).toBeNull();
  });

  it("preserves the task across token refresh and uses the newest token for each request", async () => {
    // 测试目标：验证刷新 token 不丢转发任务，后续 HTTP 请求使用最新凭据。
    // 构造方法：挂起源准备时刷新到 token-2，挂起 PUT 时再刷新到 token-3。
    // 输入数据：token-1/token-2/token-3 与两张源图。
    // 预期行为：上传授权用 token-2，确认用 token-3，最终只发送一次。
    const preparing = deferred<ForwardMessageDraft>(); const uploading = deferred<void>();
    prepareForwardMessage.mockReturnValue(preparing.promise); uploadSignedFile.mockReturnValue(uploading.promise);
    const hook = renderForwarding(data(true)); hook.start();
    hook.rerender({ ...hook.initialProps, accessToken: "token-2" });
    await act(async () => { preparing.resolve(draft(true)); await preparing.promise; });
    await waitFor(() => expect(uploadSignedFile).toHaveBeenCalledTimes(2));
    expect(requestUploadAuthorizations.mock.calls[0][1]).toBe("token-2");
    hook.rerender({ ...hook.initialProps, accessToken: "token-3" });
    await act(async () => { uploading.resolve(); await uploading.promise; });
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    expect(confirmUploads.mock.calls[0][1]).toBe("token-3");
  });

  it("rejects missing confirmation coverage and never sends partially confirmed images", async () => {
    // 测试目标：验证空确认响应不能被误判为图片全部完成。
    // 构造方法：授权和 PUT 成功，但确认接口返回空数组。
    // 输入数据：a/b 两个成功上传附件，零条确认结果。
    // 预期行为：任务 failed，整条消息没有发送。
    confirmUploads.mockResolvedValue([]); const hook = renderForwarding(data(true)); hook.start();
    await waitFor(() => expect(hook.result.current.phase).toBe("failed"));
    expect(hook.sendMessage).not.toHaveBeenCalled();
  });

  it("checks availability before submitting and locks the target once work starts", async () => {
    // 测试目标：验证离线和目标选择约束，并防止任务运行中更改目的地。
    // 构造方法：先离线提交，再恢复后挂起准备，尝试选择其他目标及移除源。
    // 输入数据：缺失目标 99、目标 2、已移除源。
    // 预期行为：离线报错；任务固定目标 2，源移除后旧准备结果不上传或发送。
    const pending = deferred<ForwardMessageDraft>(); prepareForwardMessage.mockReturnValue(pending.promise);
    const hook = renderForwarding(data(true)); hook.rerender({ ...hook.initialProps, canSendMessages: false }); hook.start();
    await waitFor(() => expect(hook.result.current.phase).toBe("failed"));
    expect(prepareForwardMessage).not.toHaveBeenCalled();
    hook.rerender(hook.initialProps); act(() => hook.result.current.retry());
    act(() => { hook.result.current.selectTarget(1); hook.result.current.selectTarget(99); });
    expect(hook.result.current.selectedConversationId).toBe(2);
    const removed = data(true); removed.conversations[1].messages = [];
    hook.rerender({ ...hook.initialProps, data: removed });
    await act(async () => { pending.resolve(draft(true)); await pending.promise; });
    expect(hook.sendMessage).not.toHaveBeenCalled(); expect(requestUploadAuthorizations).not.toHaveBeenCalled();
  });

  it("never revives an obsolete attempt after source recovery and retry", async () => {
    // 测试目标：验证源短暂失效后重试不会让旧请求与新请求同时发送。
    // 构造方法：挂起第一次准备，移除再恢复源，重试并先完成新准备，最后完成旧准备。
    // 输入数据：两个独立准备 Promise、同一原消息和目标 2。
    // 预期行为：只采用新 attempt 的 Files，只上传两张图并发送一次，旧结果被丢弃。
    const old = deferred<ForwardMessageDraft>(); const fresh = deferred<ForwardMessageDraft>();
    prepareForwardMessage.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const hook = renderForwarding(data(true)); hook.start();
    const missing = data(true); missing.conversations[1].messages = [];
    hook.rerender({ ...hook.initialProps, data: missing }); expect(hook.result.current.phase).toBe("failed");
    hook.rerender(hook.initialProps); act(() => hook.result.current.retry());
    await act(async () => { fresh.resolve(draft(true)); await fresh.promise; });
    await waitFor(() => expect(hook.sendMessage).toHaveBeenCalledTimes(1));
    await act(async () => { old.resolve(draft(true)); await old.promise; });
    expect(uploadSignedFile).toHaveBeenCalledTimes(2); expect(hook.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("closing a submitted task does not delete or resend its outgoing message", async () => {
    // 测试目标：验证发送后的取消只关闭 UI，不影响已提交消息。
    // 构造方法：完成文字提交，关闭后尝试 retry。
    // 输入数据：forward-client 正在等待确认。
    // 预期行为：source 清空，原输入 data 不变，既不重发也不调用 retryMessage。
    const input = data(); const before = JSON.stringify(input); const hook = renderForwarding(input); hook.start();
    await waitFor(() => expect(hook.result.current.submitted).toBe(true));
    act(() => { hook.result.current.close(); hook.result.current.retry(); });
    expect(hook.result.current.source).toBeNull(); expect(JSON.stringify(input)).toBe(before);
    expect(hook.sendMessage).toHaveBeenCalledTimes(1); expect(hook.retryMessage).not.toHaveBeenCalled();
  });

  it("fails explicitly when a submitted target disappears and preserves the original client ID", async () => {
    // 测试目标：验证已提交任务的目标会话移除后不会永久等待，也不创建新的消息副本。
    // 构造方法：提交文字转发后移除目标并重试，再恢复包含原失败消息的目标会话后重试。
    // 输入数据：目标会话 2、固定 forward-client、发送失败状态。
    // 预期行为：移除时 failed 并提示结果待确认；不可用重试不调用发送，恢复后仅 retryMessage 原 ID。
    const hook = renderForwarding(); hook.start();
    await waitFor(() => expect(hook.result.current.submitted).toBe(true));
    const missing = { ...hook.initialProps.data, conversations: { 1: hook.initialProps.data.conversations[1] } };
    hook.rerender({ ...hook.initialProps, data: missing });
    expect(hook.result.current.phase).toBe("failed");
    expect(hook.result.current.error).toBe("目标会话已不可用，发送结果待确认");
    act(() => hook.result.current.retry());
    expect(hook.result.current.phase).toBe("failed"); expect(hook.result.current.submitted).toBe(true);
    expect(hook.retryMessage).not.toHaveBeenCalled(); expect(hook.sendMessage).toHaveBeenCalledTimes(1);
    const restored = data(); restored.conversations[2].messages = [{ ...message(), senderUserId: 1,
      conversationId: 2, clientMessageId: "forward-client", localStatus: "failed", errorCode: "send_failed" }];
    hook.rerender({ ...hook.initialProps, data: restored }); act(() => hook.result.current.retry());
    expect(hook.retryMessage).toHaveBeenCalledExactlyOnceWith("forward-client");
    expect(hook.sendMessage).toHaveBeenCalledTimes(1);
  });
});
