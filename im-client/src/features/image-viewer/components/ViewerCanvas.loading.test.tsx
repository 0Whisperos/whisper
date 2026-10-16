import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ViewerCanvas, type ImageTransform, type ViewerCanvasHandle } from "./ViewerCanvas";

function Harness({ src, onLoad = vi.fn() }: { src: string; onLoad?: (...values: number[]) => void }) {
  const [transform, setTransform] = useState<ImageTransform>();
  const canvas = useRef<ViewerCanvasHandle>(null);
  return <><ViewerCanvas ref={canvas} src={src} transform={transform}
    onTransform={(update) => setTransform((current) => current ? update(current) : current)}
    onLoad={(width, height, zoom) => {
      onLoad(width, height, zoom);
      setTransform({ width, height, zoom, rotation: 0, panX: 0, panY: 0 });
    }} onContextMenu={() => undefined} />
    <button onClick={() => canvas.current?.zoomBy(25)}>放大图片</button>
    <span aria-label="缩放">{transform?.zoom}</span></>;
}

function mockImageState(complete: (image: HTMLImageElement) => boolean, width = 800) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockImplementation(function (this: HTMLImageElement) { return complete(this); });
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(width ? 500 : 0);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reconciles completed cached images without another load event under StrictMode", () => {
  // 测试目标：缓存图已完成时，无新load事件也能结束加载且初始化只执行一次。
  // 构造方法：模拟img.complete和有效原始尺寸，以StrictMode挂载真实画布。
  // 输入数据：complete=true，800×500，asset://cached，不派发load。
  // 预期行为：图片可见、无加载提示；StrictMode重复effect不会重复初始化。
  mockImageState(() => true);
  const onLoad = vi.fn();
  render(<StrictMode><Harness src="asset://cached" onLoad={onLoad} /></StrictMode>);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveStyle({ visibility: "visible" });
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(onLoad).toHaveBeenCalledWith(800, 500, 25);
});

it("shows a cached image after A to B to A without waiting for a second load event", () => {
  // 测试目标：切回已加载资源时不永久停留在加载提示。
  // 构造方法：A和B首次手动load，将它们标记为缓存完成后切回A，不再派发事件。
  // 输入数据：asset://a→asset://b→asset://a，各800×500。
  // 预期行为：A首次和B首次等待load，返回A立即显示，初始化各次访问均可完成。
  const cached = new Set<string>();
  mockImageState((image) => cached.has(image.getAttribute("src")!));
  const onLoad = vi.fn();
  const view = render(<Harness key="a" src="asset://a" onLoad={onLoad} />);
  expect(screen.getByRole("status")).toHaveTextContent("正在加载图片");
  cached.add("asset://a"); fireEvent.load(screen.getByRole("img", { hidden: true }));
  view.rerender(<Harness key="b" src="asset://b" onLoad={onLoad} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  cached.add("asset://b"); fireEvent.load(screen.getByRole("img", { hidden: true }));
  view.rerender(<Harness key="a" src="asset://a" onLoad={onLoad} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveStyle({ visibility: "visible" });
  expect(onLoad).toHaveBeenCalledTimes(3);
});

it("reports a completed broken image as a failure and recovers when the source changes", () => {
  // 测试目标：complete不代表加载成功，损坏资源不能一直显示加载且不污染新资源。
  // 构造方法：首次尺寸为零且complete，随后在同一画布切换为有效缓存src。
  // 输入数据：asset://broken尺寸0×0→asset://valid尺寸800×500。
  // 预期行为：首次显示图片加载失败，替换后显示图片并消除错误。
  mockImageState(() => true, 0);
  const onLoad = vi.fn();
  const view = render(<Harness src="asset://broken" onLoad={onLoad} />);
  expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(onLoad).not.toHaveBeenCalled();
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(500);
  view.rerender(<Harness src="asset://valid" onLoad={onLoad} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveStyle({ visibility: "visible" });
  expect(onLoad).toHaveBeenCalledTimes(1);
});

it("does not refit an image after a duplicate completion notification", () => {
  // 测试目标：完成检查和重复load不能覆盖用户当前的缩放。
  // 构造方法：缓存图片立即就绪，用户放大，再向同一img发送load两次。
  // 输入数据：初始25%，按钮加25个百分点，两个重复load。
  // 预期行为：初始化一次，最终仍50%，不重新适配为25%。
  mockImageState(() => true);
  const onLoad = vi.fn();
  render(<Harness src="asset://cached" onLoad={onLoad} />);
  fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
  fireEvent.load(screen.getByRole("img")); fireEvent.load(screen.getByRole("img"));
  expect(screen.getByLabelText("缩放")).toHaveTextContent("50");
  expect(onLoad).toHaveBeenCalledTimes(1);
});

function EarlyLoad() {
  useLayoutEffect(() => {
    document.querySelector("img")?.dispatchEvent(new Event("load"));
  }, []);
  return null;
}

it("does not erase a successful load delivered before the canvas layout effect", () => {
  // 测试目标：成功事件早于画布layout effect时不会被初始化重置成永久加载。
  // 构造方法：较早兄弟的layout effect在同一次commit派发唯一load。
  // 输入数据：800×500、complete=false（不依赖完成检查），只有一次早到load。
  // 预期行为：加载回调执行一次，图片可见且加载提示消失。
  mockImageState(() => false);
  const onLoad = vi.fn();
  render(<><EarlyLoad /><Harness src="asset://fast" onLoad={onLoad} /></>);
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveStyle({ visibility: "visible" });
});
