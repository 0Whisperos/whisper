import { useLayoutEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { session: null as unknown, error: "", select: vi.fn() } }));
vi.mock("./hooks/useViewerSession", () => ({ useViewerSession: () => state }));
vi.mock("./api", () => ({ copyImage: vi.fn(), saveImage: vi.fn() }));
vi.mock("./components/ViewerWindowControls", () => ({ ViewerWindowControls: () => null }));
vi.mock("./components/ViewerCanvas", () => ({
  // Cached images can load before the parent's passive effects; reproduce that ordering.
  ViewerCanvas: ({ src, onLoad }: { src: string; onLoad: (width: number, height: number, zoom: number) => void }) => {
    useLayoutEffect(() => { onLoad(800, 500, src.includes("refreshed") ? 60 : 100); }, [src]);
    return <img src={src} alt="聊天图片" />;
  },
}));
import { ImageViewer } from "./ImageViewer";
import type { ImageViewerSession } from "./types";

function session(sessionId: string): ImageViewerSession {
  return { sessionId, version: 1, conversationId: 1, currentIndex: 0,
    images: [{ id: "image", messageId: "message", attachmentId: "attachment", assetUrl: "asset://cached" }] };
}
afterEach(cleanup);

it("retains a fast image load before passive effects in the initial and replacement sessions", () => {
  // 测试目标：验证图片先于父组件useEffect加载时，初始化和session替换都不会清掉图片变换。
  // 构造方法：以layout effect立即报告缓存图片load，首次渲染后替换session但保持相同图片URL。
  // 输入数据：session first→replacement，800×500图片，初始100%。
  // 预期行为：两次都显示100%，放大和旋转可用，不退回未加载的破折号。
  state.session = session("first");
  const view = render(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByRole("button", { name: "放大" })).toBeEnabled();
  state.session = session("replacement"); view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByRole("button", { name: "顺时针旋转" })).toBeEnabled();
});

it("initializes a fast cached load for each image identity and asset URL change", () => {
  // 测试目标：验证切图和URL替换的快速缓存加载不会被重置过程覆盖。
  // 构造方法：layout effect同步回报load，依次更改图片id、资源URL，再返回原图。
  // 输入数据：同session的image→second→second/refreshed→image，适配值100%或60%。
  // 预期行为：每次选择都立即显示该资源的初始适配值，工具按钮保持可用。
  state.session = session("same");
  const view = render(<ImageViewer />);
  const second = session("same");
  second.images[0].id = "second";
  state.session = second; view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  const refreshed = { ...second, images: [{ ...second.images[0], assetUrl: "asset://refreshed" }] };
  state.session = refreshed; view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("60%");
  expect(screen.getByRole("button", { name: "顺时针旋转" })).toBeEnabled();
  state.session = session("same"); view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByRole("button", { name: "放大" })).toBeEnabled();
});
