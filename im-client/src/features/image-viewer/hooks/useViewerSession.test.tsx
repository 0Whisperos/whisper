import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ getImageViewerSession: vi.fn(), listenImageViewerUpdates: vi.fn(), selectImageViewerImage: vi.fn() }));
import { getImageViewerSession, listenImageViewerUpdates, selectImageViewerImage } from "../api";
import type { ImageViewerSession, ViewerSessionUpdate } from "../types";
import { useViewerSession } from "./useViewerSession";

function session(version = 1, sessionId = "s"): ImageViewerSession {
  return { sessionId, version, conversationId: 9, currentIndex: 0,
    images: [{ id: "a:0", messageId: "a", attachmentId: "a", assetUrl: "asset://a" }] };
}
let notify: (event: ViewerSessionUpdate) => void;
let stop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); stop = vi.fn();
  vi.mocked(listenImageViewerUpdates).mockImplementation(async (handler) => { notify = handler; return stop; });
  vi.mocked(getImageViewerSession).mockResolvedValue(session());
});
afterEach(cleanup);

it("subscribes before snapshot and ignores lower-version and obsolete request responses", async () => {
  // 测试目标：验证先订阅后取快照，版本和请求代次隔离旧结果。
  // 构造方法：完成初始快照，阻塞版本2刷新，发出版本3并先完成，再释放版本2。
  // 输入数据：s版本1/2/3以及版本0的旧通知。
  // 预期行为：订阅先于查询；最终保持版本3；旧通知不再查询；卸载取消订阅。
  const view = renderHook(useViewerSession);
  await waitFor(() => expect(view.result.current.session?.version).toBe(1));
  expect(vi.mocked(listenImageViewerUpdates).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(getImageViewerSession).mock.invocationCallOrder[0]);
  let release!: (value: ImageViewerSession) => void;
  vi.mocked(getImageViewerSession).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValueOnce(session(3));
  act(() => { notify({ sessionId: "s", version: 2 }); });
  act(() => { notify({ sessionId: "s", version: 3 }); });
  await waitFor(() => expect(view.result.current.session?.version).toBe(3));
  await act(async () => { release(session(2)); });
  expect(view.result.current.session?.version).toBe(3);
  const calls = vi.mocked(getImageViewerSession).mock.calls.length;
  act(() => { notify({ sessionId: "s", version: 0 }); });
  expect(getImageViewerSession).toHaveBeenCalledTimes(calls);
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it("does not apply a previous session selection after a replacement event", async () => {
  // 测试目标：验证旧session的select响应不会覆盖新会话。
  // 构造方法：阻塞选择请求，经事件加载新session后再释放选择。
  // 输入数据：旧s选择a:0，新session new/version1。
  // 预期行为：选择完成后仍保持new session。
  const view = renderHook(useViewerSession);
  await waitFor(() => expect(view.result.current.session?.sessionId).toBe("s"));
  let release!: (value: ImageViewerSession) => void;
  vi.mocked(selectImageViewerImage).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let selection!: Promise<void>;
  act(() => { selection = view.result.current.select("a:0"); });
  vi.mocked(getImageViewerSession).mockResolvedValueOnce(session(1, "new"));
  act(() => { notify({ sessionId: "new", version: 1 }); });
  await waitFor(() => expect(view.result.current.session?.sessionId).toBe("new"));
  await act(async () => { release(session(2)); await selection; });
  expect(view.result.current.session?.sessionId).toBe("new");
});
