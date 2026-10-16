import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { copyImage, saveImage } from "./api";
import { fitZoom } from "./components/ViewerCanvas";
import type { ImageViewerSession } from "./types";

function session(index = 0, id = "s"): ImageViewerSession {
  return { sessionId: id, version: 1, conversationId: 9, currentIndex: index,
    images: ["a", "b"].map((name) => ({ id: `${name}:0`, messageId: name, attachmentId: name, assetUrl: `asset://${name}` })) };
}
function loadImage() {
  const image = screen.getByRole("img", { hidden: true });
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 100 });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: 50 });
  fireEvent.load(image);
  return image;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = session(); state.error = "";
  vi.mocked(copyImage).mockResolvedValue();
  vi.mocked(saveImage).mockResolvedValue({ saved: false });
});
afterEach(cleanup);

it("fits within bounds and clamps minimum and maximum initial zoom", () => {
  // 测试目标：验证初始适配缩放的边界。
  // 构造方法：直接为适配函数输入不同图片/视口尺寸。
  // 输入数据：100×100、1000×1000 图片及50/100/200宽高视口。
  // 预期行为：适配分别为50%、25%与100%，不无限放大或缩小。
  expect(fitZoom(100, 100, 50, 80)).toBe(50);
  expect(fitZoom(1000, 1000, 100, 100)).toBe(25);
  expect(fitZoom(100, 100, 200, 200)).toBe(100);
});

it("navigates within boundaries and resets zoom and rotation every time the selected image changes", async () => {
  // 测试目标：验证查看器导航边界及每次切图重置变换。
  // 构造方法：加载首图、放大旋转，切到次图再返回首图。
  // 输入数据：两张图片，初始25%，放大一次、旋转一次。
  // 预期行为：首尾按钮禁用正确，次图与返回首图均恢复初始25%/0°。
  const user = userEvent.setup();
  const view = render(<ImageViewer />);
  expect(screen.getByRole("button", { name: "上一张" })).toBeDisabled();
  loadImage();
  await user.click(screen.getByRole("button", { name: "放大" }));
  await user.click(screen.getByRole("button", { name: "顺时针旋转" }));
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("50%");
  expect(screen.getByRole("img")).toHaveStyle({ transform: "translate(-50%, -50%) rotate(90deg) scale(0.5)" });
  await user.click(screen.getByRole("button", { name: "下一张" }));
  expect(state.select).toHaveBeenCalledWith("b:0");
  state.session = session(1); view.rerender(<ImageViewer />); loadImage();
  expect(screen.getByRole("button", { name: "下一张" })).toBeDisabled();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("25%");
  state.session = session(0); view.rerender(<ImageViewer />); loadImage();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("25%");
  expect(screen.getByRole("img")).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg) scale(0.25)" });
});

it("copies only a loaded image and downloads originals using session identity", async () => {
  // 测试目标：验证右键复制和下载仅传递原图逻辑身份。
  // 构造方法：未加载时右击、加载后右击选择复制，再旋转下载。
  // 输入数据：session s，图片a:0，保存对话框取消。
  // 预期行为：未加载没有菜单；复制/保存收到viewer target，取消无错误。
  const user = userEvent.setup();
  render(<ImageViewer />);
  fireEvent.contextMenu(screen.getByRole("img", { hidden: true }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const image = loadImage();
  fireEvent.contextMenu(image, { clientX: 10, clientY: 10 });
  await user.click(screen.getByRole("menuitem", { name: "复制图片" }));
  expect(copyImage).toHaveBeenCalledWith({ kind: "viewer", sessionId: "s", imageId: "a:0" });
  await user.click(screen.getByRole("button", { name: "顺时针旋转" }));
  await user.click(screen.getByRole("button", { name: "下载原图" }));
  expect(saveImage).toHaveBeenCalledWith({ kind: "viewer", sessionId: "s", imageId: "a:0" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("clamps zoom buttons at 25 and 500 percent and resets transforms for a new session", async () => {
  // 测试目标：验证按钮操作的缩放上下限及新session变换重置。
  // 构造方法：加载首图，连续放大到上限再缩小到下限，旋转后替换session。
  // 输入数据：25%初始图，20次放大、20次缩小、一次旋转，新session new。
  // 预期行为：缩放严格限制25%–500%，端点按钮禁用；新session恢复25%/0°。
  const user = userEvent.setup();
  const view = render(<ImageViewer />); loadImage();
  const zoomIn = screen.getByRole("button", { name: "放大" });
  const zoomOut = screen.getByRole("button", { name: "缩小" });
  expect(zoomOut).toBeDisabled();
  for (let index = 0; index < 20; index++) await user.click(zoomIn);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("500%");
  expect(zoomIn).toBeDisabled();
  for (let index = 0; index < 20; index++) await user.click(zoomOut);
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("25%");
  expect(zoomOut).toBeDisabled();
  await user.click(zoomIn);
  await user.click(screen.getByRole("button", { name: "顺时针旋转" }));
  state.session = session(0, "new"); view.rerender(<ImageViewer />); loadImage();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("25%");
  expect(screen.getByRole("img")).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg) scale(0.25)" });
});

it("displays load failure and ignores a previous image action failure after session replacement", async () => {
  // 测试目标：验证图片加载失败反馈及旧异步动作隔离。
  // 构造方法：阻塞保存，替换session后拒绝旧保存，再触发新图加载失败。
  // 输入数据：session s变为new，旧保存拒绝，img error。
  // 预期行为：新会话不显示旧保存失败，新图显示图片加载失败。
  let rejectSave!: (error: Error) => void;
  vi.mocked(saveImage).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  const user = userEvent.setup();
  const view = render(<ImageViewer />); loadImage();
  await user.click(screen.getByRole("button", { name: "下载原图" }));
  state.session = session(0, "new"); view.rerender(<ImageViewer />);
  await act(async () => { rejectSave(new Error("failed")); });
  expect(screen.queryByText("图片保存失败")).not.toBeInTheDocument();
  fireEvent.error(screen.getByRole("img", { hidden: true }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败"));
});

it("ignores an old image action failure after navigating away and back to the same image", async () => {
  // 测试目标：验证A→B→A后旧A的异步动作失败不会污染新一次A选择。
  // 构造方法：阻塞A保存，切到B再返回A并加载，最后拒绝旧保存。
  // 输入数据：同session中a:0→b:0→a:0，旧保存返回失败。
  // 预期行为：返回A仍保持初始变换，且不显示旧保存错误。
  let rejectSave!: (error: Error) => void;
  vi.mocked(saveImage).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  const user = userEvent.setup();
  const view = render(<ImageViewer />); loadImage();
  await user.click(screen.getByRole("button", { name: "下载原图" }));
  state.session = session(1); view.rerender(<ImageViewer />); loadImage();
  state.session = session(0); view.rerender(<ImageViewer />); loadImage();
  await act(async () => { rejectSave(new Error("old action failed")); });
  expect(screen.queryByText("图片保存失败")).not.toBeInTheDocument();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("25%");
});
