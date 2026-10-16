import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { session: null as unknown, error: "", select: vi.fn() } }));
vi.mock("./hooks/useViewerSession", () => ({ useViewerSession: () => state }));
vi.mock("./api", () => ({ copyImage: vi.fn(), saveImage: vi.fn() }));
vi.mock("./windowApi", () => ({
  minimizeViewerWindow: vi.fn().mockResolvedValue(undefined),
  toggleViewerWindowMaximized: vi.fn().mockResolvedValue(undefined),
  closeViewerWindow: vi.fn().mockResolvedValue(undefined),
  isViewerWindowMaximized: vi.fn().mockResolvedValue(false),
  listenViewerWindowResized: vi.fn().mockResolvedValue(() => undefined),
}));
import { ImageViewer } from "./ImageViewer";
import type { ImageViewerSession } from "./types";

function session(currentIndex = 0, sessionId = "session"): ImageViewerSession {
  return { sessionId, version: 1, currentIndex, conversationId: 9,
    images: ["a", "b"].map((id) => ({ id, messageId: id, attachmentId: id, assetUrl: `asset://${id}` })) };
}
function load() {
  const stage = screen.getByLabelText("图片画布");
  Object.defineProperties(stage, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 40, 800, 600));
  const capture = new Set<number>();
  Object.assign(stage, { setPointerCapture: (id: number) => capture.add(id), releasePointerCapture: (id: number) => capture.delete(id),
    hasPointerCapture: (id: number) => capture.has(id) });
  const image = screen.getByRole("img", { hidden: true });
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 600 }, naturalHeight: { configurable: true, value: 400 } });
  fireEvent.load(image);
  return { stage, image };
}
function pointer(stage: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 }); fireEvent(stage, event);
}
beforeEach(() => { vi.clearAllMocks(); state.session = session(); state.error = ""; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("resets wheel zoom and pan on every selected image change including returning to an earlier image", async () => {
  // 测试目标：验证画布手势只属于当前选中图片，切换和返回都恢复初始变换。
  // 构造方法：真实渲染查看器，在首图空白画布缩放拖动，切到次图再返回，最后替换 session。
  // 输入数据：600×400 原图、800×600 画布；鼠标(600,440)滚轮-100，左键移动(90,50)。
  // 预期行为：首图比例为122%并平移；次图、返回首图和新session均100%、居中。
  const view = render(<ImageViewer />);
  await act(async () => undefined);
  const { stage, image } = load();
  fireEvent.wheel(stage, { deltaY: -100, clientX: 600, clientY: 440 });
  pointer(stage, "pointerdown", 100, 100); pointer(stage, "pointermove", 190, 150); pointer(stage, "pointerup", 190, 150);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("122%");
  expect(image.parentElement!.style.transform).not.toBe("translate(0px, 0px)");
  state.session = session(1); view.rerender(<ImageViewer />); load();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByRole("img").parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
  state.session = session(); view.rerender(<ImageViewer />); const restored = load().image;
  expect(restored.parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
  expect(restored).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg) scale(1)" });
  state.session = session(0, "replacement"); view.rerender(<ImageViewer />); load();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByRole("img").parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
});

it("clears transforms immediately when passing through an unloaded image and releases an active drag", async () => {
  // 测试目标：验证A→未加载B→A立即清空变换，且切图释放进行中的指针捕获。
  // 构造方法：加载A后放大、旋转并保持拖动，切到B但不触发load，再返回A并重新加载。
  // 输入数据：600×400图片、800×600画布，A放大125%/旋转90°/拖动(90,50)，B无load事件。
  // 预期行为：进入B立刻显示未初始化比例和零偏移，旧捕获释放；返回A恢复100%/0°/零偏移。
  const view = render(<ImageViewer />);
  await act(async () => undefined);
  const { stage, image } = load();
  fireEvent.click(screen.getByRole("button", { name: "放大" }));
  fireEvent.click(screen.getByRole("button", { name: "顺时针旋转" }));
  pointer(stage, "pointerdown", 100, 100);
  pointer(stage, "pointermove", 190, 150);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("125%");
  expect(image).toHaveStyle({ transform: "translate(-50%, -50%) rotate(90deg) scale(1.25)" });
  expect(image.parentElement!.style.transform).not.toBe("translate(0px, 0px)");
  expect(stage.hasPointerCapture(1)).toBe(true);

  state.session = session(1); view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("—");
  expect(screen.getByRole("button", { name: "顺时针旋转" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "放大" })).toBeDisabled();
  expect(screen.getByRole("img", { hidden: true }).parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
  expect(stage.hasPointerCapture(1)).toBe(false);

  state.session = session(0); view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("—");
  const restored = load().image;
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(restored).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg) scale(1)" });
  expect(restored.parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
});

it("keeps toolbar wheel separate from canvas zoom and uses buttons for centered steps", async () => {
  // 测试目标：验证工具栏不响应图片滚轮，原有按钮仍按固定25个百分点缩放。
  // 构造方法：加载真实查看器，在工具栏发送wheel，再点击放大和旋转按钮。
  // 输入数据：初始100%、工具栏deltaY=-100、一次放大和旋转。
  // 预期行为：工具栏wheel后仍100%，按钮后125%/90°，图片平移保持居中。
  render(<ImageViewer />);
  await act(async () => undefined);
  const { image } = load();
  fireEvent.wheel(screen.getByRole("toolbar"), { deltaY: -100, clientX: 100, clientY: 20 });
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  fireEvent.click(screen.getByRole("button", { name: "放大" }));
  fireEvent.click(screen.getByRole("button", { name: "顺时针旋转" }));
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("125%");
  expect(image).toHaveStyle({ transform: "translate(-50%, -50%) rotate(90deg) scale(1.25)" });
  expect(image.parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
});

it("preserves the current transform when version and gallery ordering change without changing the selected image", async () => {
  // 测试目标：验证同一选中图片的session版本及序列更新不重置手势变换。
  // 构造方法：缩放旋转并拖动首图，向图库前方插入另一图并更新版本，保持选中id和URL。
  // 输入数据：a图片122%/90°、非零pan；version1→2，currentIndex0→1。
  // 预期行为：比例、旋转及pan完整保留，加载图片不会重新初始化。
  const view = render(<ImageViewer />);
  await act(async () => undefined);
  const { stage, image } = load();
  fireEvent.wheel(stage, { deltaY: -100, clientX: 600, clientY: 440 });
  fireEvent.click(screen.getByRole("button", { name: "顺时针旋转" }));
  pointer(stage, "pointerdown", 100, 100); pointer(stage, "pointermove", 190, 150); pointer(stage, "pointerup", 190, 150);
  const pan = image.parentElement!.style.transform;
  const transform = image.style.transform;
  const updated = session();
  updated.version = 2;
  updated.images.unshift({ id: "earlier", messageId: "earlier", attachmentId: "earlier", assetUrl: "asset://earlier" });
  updated.currentIndex = 1;
  state.session = updated; view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("122%");
  expect(screen.getByRole("img").style.transform).toBe(transform);
  expect(screen.getByRole("img").parentElement!.style.transform).toBe(pan);
});

it("resets zoom rotation and pan when the selected image receives a different asset URL", async () => {
  // 测试目标：验证同一图片身份的资源URL替换也重新开始适配显示。
  // 构造方法：对A缩放旋转拖动，再仅替换assetUrl并加载新资源。
  // 输入数据：a的asset://a→asset://a?retry=2，原图600×400、画布800×600。
  // 预期行为：新资源加载前比例未初始化，加载后100%/0°/零偏移。
  const view = render(<ImageViewer />);
  await act(async () => undefined);
  const { stage } = load();
  fireEvent.wheel(stage, { deltaY: -100, clientX: 600, clientY: 440 });
  fireEvent.click(screen.getByRole("button", { name: "顺时针旋转" }));
  pointer(stage, "pointerdown", 100, 100); pointer(stage, "pointermove", 190, 150); pointer(stage, "pointerup", 190, 150);
  const updated = session();
  updated.images[0].assetUrl = "asset://a?retry=2";
  state.session = updated; view.rerender(<ImageViewer />);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("—");
  const { image } = load();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(image).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg) scale(1)" });
  expect(image.parentElement).toHaveStyle({ transform: "translate(0px, 0px)" });
});
