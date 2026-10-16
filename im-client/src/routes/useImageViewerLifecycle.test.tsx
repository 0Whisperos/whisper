import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatMockData } from "../features/chat/mockData";
import { AttachmentResourceCache } from "../features/chat/attachmentResourceCache";
import { useImageViewerLifecycle } from "./useImageViewerLifecycle";

const { close, sync } = vi.hoisted(() => ({ close: vi.fn(), sync: vi.fn() }));
const cache = new AttachmentResourceCache();
vi.mock("../features/image-viewer/coordinator", () => ({ imageViewerCoordinator: { close, sync } }));

describe("image viewer authentication lifecycle", () => {
  beforeEach(() => {
    close.mockReset().mockResolvedValue(undefined);
    sync.mockReset().mockResolvedValue(undefined);
  });

  it("synchronizes loaded conversations without closing on chat data changes", () => {
    // 测试目标：验证新增历史或消息更新查看器序列，但不关闭仍属于当前账号的窗口。
    // 构造方法：挂载生命周期 hook，再用新的会话集合重新渲染。
    // 输入数据：mock 的已加载会话集合及其浅拷贝，同一服务器和用户 20001。
    // 预期行为：每次数据变化调用 sync，关闭函数保持未调用。
    const first = chatMockData.conversations;
    const next = { ...first };
    const { rerender } = renderHook(({ conversations }) => useImageViewerLifecycle("http://localhost", 20001, conversations, "token", cache), {
      initialProps: { conversations: first },
    });
    rerender({ conversations: next });
    const credentials = { apiBaseUrl: "http://localhost", userId: 20001, accessToken: "token" };
    expect(sync.mock.calls).toEqual([[first, credentials, cache], [next, credentials, cache]]);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes on account replacement and authentication page unmount", () => {
    // 测试目标：验证切换账号和认证失效后卸载都清理查看器。
    // 构造方法：以第一个用户挂载，切到第二个用户，然后卸载。
    // 输入数据：userId 从 20001 改为 20002，未加载会话。
    // 预期行为：账号替换和卸载各调用一次 close，未调用 sync。
    const { rerender, unmount } = renderHook(({ userId }) => useImageViewerLifecycle("http://localhost", userId, undefined, "token", cache), {
      initialProps: { userId: 20001 },
    });
    rerender({ userId: 20002 });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(close).toHaveBeenCalledTimes(2);
    expect(sync).not.toHaveBeenCalled();
  });

  it("handles failed synchronization and cleanup without an unhandled rejection", async () => {
    // 测试目标：验证原生窗口已不存在时清理错误不会破坏认证页面生命周期。
    // 构造方法：让 sync 和 close 拒绝，挂载并卸载 hook 后排空微任务。
    // 输入数据：window_not_found 错误与 mock 会话集合。
    // 预期行为：两项调用都执行，拒绝被捕获，不向 React 抛出。
    sync.mockRejectedValue(new Error("window_not_found"));
    close.mockRejectedValue(new Error("window_not_found"));
    const { unmount } = renderHook(() => useImageViewerLifecycle("http://localhost", 20001, chatMockData.conversations, "token", cache));
    unmount();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("provides refreshed credentials without closing the current viewer", () => {
    // 测试目标：验证 token 续期会更新查看器缓存同步所用凭证，不关闭已有窗口。
    // 构造方法：固定账号和会话数据，只改变 token 并重新渲染 hook。
    // 输入数据：accessToken 从 old 变为 renewed。
    // 预期行为：再次同步时携带 renewed，窗口关闭函数未调用。
    const { rerender } = renderHook(({ token }) => useImageViewerLifecycle("http://localhost", 20001, chatMockData.conversations, token, cache), {
      initialProps: { token: "old" },
    });
    rerender({ token: "renewed" });
    expect(sync).toHaveBeenLastCalledWith(chatMockData.conversations, { apiBaseUrl: "http://localhost", userId: 20001, accessToken: "renewed" }, cache);
    expect(close).not.toHaveBeenCalled();
  });
});
