import { beforeEach, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, convertFileSrc: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import { closeImageViewerSession, copyImage, getImageViewerSession, listenImageViewerUpdates, prepareImageViewerSession, saveImage, selectImageViewerImage, updateImageViewerSession } from "./api";

beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset(); });

it("encodes narrow viewer commands and normalizes only chat namespaces", async () => {
  // 测试目标：验证 viewer API command、参数和命名空间边界。
  // 构造方法：替身 invoke，逐个调用 session 和图片动作封装。
  // 输入数据：服务端 https://api.test///、用户 7、会话 9、session s、图片 m:0。
  // 预期行为：参数使用稳定 camelCase，仅 chat 地址移除尾斜杠，viewer 不包含任意路径。
  const images = [{ id: "m:0", messageId: "m", attachmentId: "a" }];
  await prepareImageViewerSession({ apiBaseUrl: "https://api.test///", userId: 7, conversationId: 9, images, selectedImageId: "m:0" });
  expect(invokeMock).toHaveBeenLastCalledWith("prepare_image_viewer_session", { apiBaseUrl: "https://api.test", userId: 7, conversationId: 9, images, selectedImageId: "m:0" });
  await getImageViewerSession("s");
  expect(invokeMock).toHaveBeenLastCalledWith("get_image_viewer_session", { sessionId: "s" });
  await updateImageViewerSession("s", images);
  expect(invokeMock).toHaveBeenLastCalledWith("update_image_viewer_session", { sessionId: "s", images });
  await selectImageViewerImage("s", "m:0");
  expect(invokeMock).toHaveBeenLastCalledWith("select_image_viewer_image", { sessionId: "s", imageId: "m:0" });
  await closeImageViewerSession("s");
  expect(invokeMock).toHaveBeenLastCalledWith("close_image_viewer_session", { sessionId: "s" });
  await copyImage({ kind: "chat", apiBaseUrl: "https://api.test///", userId: 7, conversationId: 9, attachmentId: "a" });
  expect(invokeMock).toHaveBeenLastCalledWith("copy_chat_image", { target: { kind: "chat", apiBaseUrl: "https://api.test", userId: 7, conversationId: 9, attachmentId: "a" } });
  await saveImage({ kind: "viewer", sessionId: "s", imageId: "m:0" });
  expect(invokeMock).toHaveBeenLastCalledWith("save_chat_image", { target: { kind: "viewer", sessionId: "s", imageId: "m:0" } });
});

it("forwards versioned event payloads and propagates IPC failures", async () => {
  // 测试目标：验证事件仅传递版本信息，失败不会伪装成成功。
  // 构造方法：截获 listen 回调，并让 invoke 拒绝。
  // 输入数据：session s/version 2 与 image_unavailable。
  // 预期行为：订阅者收到 payload，复制调用继续抛出失败。
  listenMock.mockResolvedValue(vi.fn());
  const handler = vi.fn();
  await listenImageViewerUpdates(handler);
  expect(listenMock).toHaveBeenCalledWith("image-viewer-session-updated", expect.any(Function));
  listenMock.mock.calls[0][1]({ payload: { sessionId: "s", version: 2 } });
  expect(handler).toHaveBeenCalledWith({ sessionId: "s", version: 2 });
  invokeMock.mockRejectedValue("image_unavailable");
  await expect(copyImage({ kind: "viewer", sessionId: "s", imageId: "m:0" })).rejects.toBe("image_unavailable");
});
