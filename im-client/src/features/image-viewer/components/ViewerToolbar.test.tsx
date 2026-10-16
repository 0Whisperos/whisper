import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./ViewerWindowControls", () => ({ ViewerWindowControls: ({ onError }: { onError?: () => void }) =>
  <div className="image-viewer-window-controls"><button className="image-viewer-window-control" aria-label="窗口测试按钮"
    data-tauri-drag-region="false" onClick={onError} /></div> }));
import { ViewerToolbar, type ViewerToolbarProps } from "./ViewerToolbar";

const labels = ["上一张", "下一张", "缩小", "放大", "顺时针旋转", "下载原图"];
function props(): ViewerToolbarProps {
  return { canPrevious: true, canNext: true, zoom: 100, canDownload: true, currentIndex: 1, total: 3,
    onPrevious: vi.fn(), onNext: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onRotate: vi.fn(), onDownload: vi.fn(), onWindowError: vi.fn() };
}
afterEach(cleanup);

it("uses six consistent vector tools including an arrow landing in a download tray", async () => {
  // 测试目标：验证六个工具的图标、可访问名称和回调接口。
  // 构造方法：渲染可用工具栏，逐个点击图标按钮。
  // 输入数据：100%缩放、第二张/共三张及六个回调替身。
  // 预期行为：SVG统一18px/1.75描边，下载含落托盘线条；按钮分别调用正确回调。
  const input = props();
  const user = userEvent.setup();
  render(<ViewerToolbar {...input} />);
  const callbacks = [input.onPrevious, input.onNext, input.onZoomOut, input.onZoomIn, input.onRotate, input.onDownload];
  for (const [index, label] of labels.entries()) {
    const button = screen.getByRole("button", { name: label });
    const icon = button.querySelector("svg");
    expect(icon).toHaveAttribute("width", "18");
    expect(icon).toHaveAttribute("height", "18");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
    expect(icon).toHaveAttribute("stroke", "currentColor");
    expect(icon).toHaveAttribute("fill", "none");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    await user.click(button);
    expect(callbacks[index]).toHaveBeenCalledOnce();
  }
  const download = screen.getByRole("button", { name: "下载原图" });
  expect(download.querySelector("svg")).toHaveAttribute("data-viewer-icon", "download");
  expect(download.querySelectorAll("path")[1]).toHaveAttribute("d", "M5 15v5h14v-5");
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%");
  expect(screen.getByText("2 / 3")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "窗口测试按钮" }));
  expect(input.onWindowError).toHaveBeenCalledOnce();
});

it("disables navigation and image tools at the applicable boundaries", async () => {
  // 测试目标：验证未加载、首尾位置以及缩放端点的禁用状态。
  // 构造方法：先渲染无图片工具栏，尝试点击，再切换25%与500%状态。
  // 输入数据：无zoom、导航不可用、不可下载，随后zoom25及500。
  // 预期行为：禁用按钮不调用回调，端点只禁用对应缩放按钮，空缩放显示破折号。
  const input = props();
  const user = userEvent.setup();
  const view = render(<ViewerToolbar {...input} zoom={undefined} canPrevious={false} canNext={false} canDownload={false} total={0} />);
  for (const label of labels) {
    const button = screen.getByRole("button", { name: label });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  for (const callback of [input.onPrevious, input.onNext, input.onZoomIn, input.onZoomOut, input.onRotate, input.onDownload]) expect(callback).not.toHaveBeenCalled();
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("—");
  view.rerender(<ViewerToolbar {...input} zoom={25} />);
  expect(screen.getByRole("button", { name: "缩小" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "放大" })).toBeEnabled();
  view.rerender(<ViewerToolbar {...input} zoom={500} />);
  expect(screen.getByRole("button", { name: "缩小" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "放大" })).toBeDisabled();
});

it("limits native dragging to the empty spacer and leaves buttons isolated", () => {
  // 测试目标：验证原生拖动区不会覆盖工具和窗口按钮。
  // 构造方法：渲染工具栏，检查Tauri拖动区标记的分布。
  // 输入数据：完整工具栏与中部空白拖动区。
  // 预期行为：只有一个空白元素启用drag-region，所有按钮和缩放文字显式禁用拖动。
  const view = render(<ViewerToolbar {...props()} />);
  const region = view.container.querySelector('[data-tauri-drag-region="true"]');
  expect(view.container.querySelectorAll('[data-tauri-drag-region="true"]')).toHaveLength(1);
  expect(region).toBeEmptyDOMElement();
  for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("data-tauri-drag-region", "false");
  expect(screen.getByLabelText("缩放比例")).toHaveAttribute("data-tauri-drag-region", "false");
  expect(screen.getByRole("toolbar")).toHaveAttribute("data-tauri-drag-region", "false");
});
