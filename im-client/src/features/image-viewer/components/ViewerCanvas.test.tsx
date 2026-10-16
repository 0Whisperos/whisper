import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerCanvas } from "./ViewerCanvas";
import type { ViewerCanvasHandle } from "./ViewerCanvas";
import type { ImageTransform } from "../canvasTransform";

const initial: ImageTransform = { width: 1000, height: 800, zoom: 100, rotation: 0, panX: 0, panY: 0 };
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  constructor(readonly callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this); }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  trigger() { this.callback([], this as unknown as ResizeObserver); }
}

function Harness({ src = "asset://image", start = initial, onLoad = vi.fn(), menu = vi.fn() }: {
  src?: string | null; start?: ImageTransform; onLoad?: (...args: number[]) => void; menu?: () => void;
}) {
  const [transform, setTransform] = useState(start);
  const canvas = useRef<ViewerCanvasHandle>(null);
  return <><ViewerCanvas ref={canvas} src={src} transform={transform} onTransform={setTransform} onLoad={onLoad} onContextMenu={menu} />
    <output aria-label="变换状态">{JSON.stringify(transform)}</output>
    <button onClick={() => canvas.current?.zoomBy(25)}>按钮放大</button><button onClick={() => canvas.current?.rotate()}>按钮旋转</button></>;
}

function setup(start = initial, src: string | null = "asset://image") {
  const menu = vi.fn(); const onLoad = vi.fn(); const view = render(<Harness start={start} src={src} onLoad={onLoad} menu={menu} />);
  const stage = screen.getByLabelText("图片画布");
  const size = { width: 800, height: 600 };
  Object.defineProperties(stage, { clientWidth: { configurable: true, get: () => size.width }, clientHeight: { configurable: true, get: () => size.height } });
  vi.spyOn(stage, "getBoundingClientRect").mockImplementation(() => new DOMRect(10, 20, size.width, size.height));
  const captured = new Set<number>();
  const setCapture = vi.fn((id: number) => captured.add(id)); const releaseCapture = vi.fn((id: number) => captured.delete(id));
  Object.assign(stage, { setPointerCapture: setCapture, releasePointerCapture: releaseCapture, hasPointerCapture: (id: number) => captured.has(id) });
  const load = () => {
    const image = screen.getByRole("img", { hidden: true });
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: start.width }, naturalHeight: { configurable: true, value: start.height } });
    fireEvent.load(image); return image;
  };
  return { ...view, stage, size, load, menu, onLoad, setCapture, releaseCapture };
}
function current(): ImageTransform { return JSON.parse(screen.getByLabelText("变换状态").textContent!); }
function wheel(stage: HTMLElement, data: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 410, clientY: 320, ...data });
  fireEvent(stage, event); return event;
}
function pointer(stage: HTMLElement, type: string, data: MouseEventInit = {}, pointerId = 7) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, ...data });
  Object.defineProperty(event, "pointerId", { value: pointerId }); fireEvent(stage, event);
}
beforeEach(() => { TestResizeObserver.instances = []; vi.stubGlobal("ResizeObserver", TestResizeObserver); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ViewerCanvas gestures", () => {
  it.each([{ mode: 0, delta: -16 }, { mode: 1, delta: -1 }, { mode: 2, delta: -16 / 600 }])(
    "normalizes wheel mode $mode over the blank stage and prevents native scrolling", ({ mode, delta }) => {
      // 测试目标：三种deltaMode在画布空白处产生相同连续缩放，并可阻止原生页面滚动。
      // 构造方法：加载图片后直接在stage发wheel，按表项分别传等价pixel/line/page增量。
      // 输入数据：-16pixel、-1line、-16/600page；anchor为viewport中心。
      // 预期行为：zoom=100*exp(.032)，event.defaultPrevented=true；pan保持零。
      const { stage, load } = setup(); load(); const event = wheel(stage, { deltaY: delta, deltaMode: mode });
      expect(current().zoom).toBeCloseTo(100 * Math.exp(.032)); expect(event.defaultPrevented).toBe(true);
      expect(current()).toMatchObject({ panX: 0, panY: 0 });
    },
  );

  it("preserves fractional trackpad input and the point under an off-center cursor", () => {
    // 测试目标：小数wheel增量不被舍弃，已有旋转与pan时仍围绕鼠标定位缩放。
    // 构造方法：载入90°旋转且平移的图片，在相对中心(100,50)发送-0.1pixel。
    // 输入数据：zoom100、pan=(30,-20)、rotation90，cursor=(510,370)。
    // 预期行为：zoom略大于100，锚点坐标按新scale反算后保持原图点。
    const { stage, load } = setup({ ...initial, rotation: 90, panX: 30, panY: -20 }); load();
    wheel(stage, { deltaY: -.1, clientX: 510, clientY: 370 }); const next = current();
    expect(next.zoom).toBeGreaterThan(100); expect(next.zoom).toBeLessThan(101);
    expect((100 - next.panX) / (next.zoom / 100)).toBeCloseTo(70);
    expect((50 - next.panY) / (next.zoom / 100)).toBeCloseTo(70);
  });

  it("registers a non-passive wheel handler and ignores pure horizontal scrolling", () => {
    // 测试目标：验证wheel监听明确passive=false，同时纯横向滚轮不被错误消费。
    // 构造方法：观察原生addEventListener调用，图片加载后发只有deltaX的事件。
    // 输入数据：deltaX=80、deltaY=0。
    // 预期行为：存在wheel passive=false监听；zoom不变且水平事件不preventDefault。
    const listener = vi.spyOn(HTMLElement.prototype, "addEventListener"); const { stage, load } = setup(); load();
    expect(listener.mock.calls.some(([type, , options]) => type === "wheel" && typeof options === "object" && options?.passive === false)).toBe(true);
    expect(wheel(stage, { deltaX: 80, deltaY: 0 }).defaultPrevented).toBe(false); expect(current()).toEqual(initial);
  });

  it("pans with left pointer capture and preserves the image context menu", () => {
    // 测试目标：验证左键拖动画布更新pan并正确capture，右键仍可打开图片菜单。
    // 构造方法：加载后左键down/move/up，再以右键down和图片contextmenu操作。
    // 输入数据：左键从(100,100)移动到(220,150)；右键button=2。
    // 预期行为：pan=(120,50)，拖动时grabbing；up释放capture；右键不开始拖动且菜单触发。
    const { stage, load, setCapture, releaseCapture, menu } = setup(); const image = load();
    pointer(stage, "pointerdown"); expect(setCapture).toHaveBeenCalledWith(7); expect(stage).toHaveClass("is-dragging");
    pointer(stage, "pointermove", { clientX: 220, clientY: 150 }); expect(current()).toMatchObject({ panX: 120, panY: 50 });
    pointer(stage, "pointerup"); expect(releaseCapture).toHaveBeenCalledWith(7); expect(stage).not.toHaveClass("is-dragging");
    pointer(stage, "pointerdown", { button: 2 }); expect(stage).not.toHaveClass("is-dragging");
    fireEvent.contextMenu(image); expect(menu).toHaveBeenCalledTimes(1);
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "wheel"])("cancels dragging on %s", (reason) => {
    // 测试目标：每个独立终止场景都取消拖动，后续旧pointer移动不能继续平移。
    // 构造方法：左键启动拖动，触发表项指定取消事件，再发送同pointer的move。
    // 输入数据：pointercancel/lostpointercapture/window blur/纵向wheel。
    // 预期行为：grabbing消失，捕获释放，取消后的移动不改变pan。
    const { stage, load, releaseCapture } = setup(); load(); pointer(stage, "pointerdown");
    if (reason === "blur") fireEvent.blur(window); else if (reason === "wheel") wheel(stage, { deltaY: -1 }); else pointer(stage, reason);
    expect(stage).not.toHaveClass("is-dragging"); expect(releaseCapture).toHaveBeenCalledWith(7); const before = current();
    pointer(stage, "pointermove", { clientX: 300, clientY: 300 }); expect(current()).toEqual(before);
  });

  it("ignores gestures before loading, after failure, and without a source", () => {
    // 测试目标：图片未成功加载、失败、无src时均不能缩放或拖动。
    // 构造方法：对未加载图发wheel/down，触发error后重复，再渲染src=null画布重复。
    // 输入数据：deltaY=-100、左键pointerdown；src=asset://image和null。
    // 预期行为：事件不被消费、无capture、transform不变，并显示加载失败。
    const first = setup(); expect(wheel(first.stage, { deltaY: -100 }).defaultPrevented).toBe(false); pointer(first.stage, "pointerdown");
    expect(first.setCapture).not.toHaveBeenCalled(); fireEvent.error(screen.getByRole("img", { hidden: true }));
    expect(wheel(first.stage, { deltaY: -100 }).defaultPrevented).toBe(false); expect(current()).toEqual(initial); first.unmount();
    const missing = setup(initial, null); expect(wheel(missing.stage, { deltaY: -100 }).defaultPrevented).toBe(false);
    pointer(missing.stage, "pointerdown"); expect(missing.setCapture).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败");
  });

  it("clamps restored pan on image load and again when the viewport shrinks", () => {
    // 测试目标：切回图片恢复旧pan时先适配当前小窗口，resize后再次保证至少32px可见。
    // 构造方法：以宽窗口保存的pan=(900,700)挂载画布，模拟load前observer，再load；随后缩小视口并触发observer。
    // 输入数据：1000x800图，当前800x600视口缩为400x300；旧pan来自更宽窗口。
    // 预期行为：load前保持存储值，load后clamp到(868,668)，缩窗后到(668,518)，zoom/rotation不改变。
    const { load, size } = setup({ ...initial, panX: 900, panY: 700 });
    act(() => TestResizeObserver.instances.forEach((observer) => observer.trigger())); expect(current().panX).toBe(900);
    load(); expect(current()).toMatchObject({ panX: 868, panY: 668, zoom: 100, rotation: 0 });
    size.width = 400; size.height = 300; act(() => TestResizeObserver.instances.forEach((observer) => observer.trigger()));
    expect(current()).toMatchObject({ panX: 668, panY: 518, zoom: 100, rotation: 0 });
  });

  it("exposes centered zoom and image-centered rotation to toolbar buttons and releases capture on unmount", () => {
    // 测试目标：ref方法提供按钮中心缩放/图片中心旋转，卸载时清理pointer capture和observer。
    // 构造方法：加载有pan的图片，调用测试按钮，再开始drag并卸载组件。
    // 输入数据：pan=(100,50)、100%→125%、0°→90°。
    // 预期行为：pan变(125,62.5)且旋转不再移动中心；卸载释放capture并断开observer。
    const { stage, load, unmount, releaseCapture } = setup({ ...initial, panX: 100, panY: 50 }); load();
    fireEvent.click(screen.getByText("按钮放大")); fireEvent.click(screen.getByText("按钮旋转"));
    expect(current()).toMatchObject({ zoom: 125, rotation: 90, panX: 125, panY: 62.5 });
    pointer(stage, "pointerdown"); unmount(); expect(releaseCapture).toHaveBeenCalledWith(7);
    expect(TestResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
