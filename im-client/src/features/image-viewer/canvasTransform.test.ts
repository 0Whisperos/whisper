import { describe, expect, it } from "vitest";
import { clampTransform, imageBounds, rotateAtCenter, wheelDeltaPixels, zoomAt } from "./canvasTransform";
import type { ImageTransform } from "./canvasTransform";

const viewport = { width: 800, height: 600 };
const base: ImageTransform = { width: 600, height: 400, zoom: 100, rotation: 0, panX: 50, panY: -30 };

describe("canvas transforms", () => {
  it.each([0, 90, 180, 270])("anchors zoom at the pointer with rotation %s", (rotation) => {
    // 测试目标：每个四分之一旋转场景缩放后，鼠标所在图像点保持同一屏幕位置。
    // 构造方法：使用已平移图像，将鼠标相对画布中心坐标下的向量按比例换算，执行125%缩放。
    // 输入数据：pan=(50,-30)、anchor=(120,70)、zoom=100→125，rotation为当前表项。
    // 预期行为：锚点相对新中心向量除以新scale等于缩放前，旋转值不变。
    const transform = { ...base, rotation }; const anchor = { x: 120, y: 70 };
    const next = zoomAt(transform, 125, anchor, viewport);
    expect((anchor.x - next.panX) / 1.25).toBeCloseTo(anchor.x - base.panX);
    expect((anchor.y - next.panY) / 1.25).toBeCloseTo(anchor.y - base.panY);
    expect(next.rotation).toBe(rotation);
  });

  it("uses the viewport center for buttons and clamps zoom and pan limits", () => {
    // 测试目标：按钮缩放以画布中心为锚点，并限制缩放/偏移边界。
    // 构造方法：对平移图像按中心放大，再以极端目标缩放输入调用同一函数。
    // 输入数据：pan=(50,-30)、zoom100→200、目标zoom0与1000。
    // 预期行为：中心放大后pan=(100,-60)，缩放限制25%到500%。
    const next = zoomAt(base, 200, { x: 0, y: 0 }, viewport);
    expect([next.panX, next.panY]).toEqual([100, -60]);
    expect(zoomAt(base, 0, { x: 0, y: 0 }, viewport).zoom).toBe(25);
    expect(zoomAt(base, 1000, { x: 0, y: 0 }, viewport).zoom).toBe(500);
  });

  it("rotates around the image center and uses swapped bounds for clamping", () => {
    // 测试目标：旋转以图片中心进行，角度变化不旋转已有pan向量，边界使用旋转后宽高。
    // 构造方法：先对普通偏移图片旋转，再对超边界偏移的横图旋转。
    // 输入数据：600x400图pan=(50,-30)；另有pan=(10000,-10000)。
    // 预期行为：普通pan保持，尺寸变400x600；极端pan被限制为(568,-568)。
    const next = rotateAtCenter(base, viewport);
    expect([next.panX, next.panY, next.rotation]).toEqual([50, -30, 90]);
    expect(imageBounds(next)).toEqual({ width: 400, height: 600 });
    const limited = rotateAtCenter({ ...base, panX: 10000, panY: -10000 }, viewport);
    expect([limited.panX, limited.panY]).toEqual([568, -568]);
  });

  it("keeps 32 pixels visible or the full edge of images smaller than 32 pixels", () => {
    // 测试目标：大图边界至少32px可见，小图不足32px时保留其完整边长。
    // 构造方法：将大图与20x10小图分别移动到右下极限，并对更小视口执行clamp。
    // 输入数据：600x400与20x10图，800x600视口，极端pan；最后视口10x8。
    // 预期行为：大图pan=(668,468)、小图pan=(390,295)，更小视口不会产生非法偏移。
    const large = clampTransform({ ...base, panX: 10000, panY: 10000 }, viewport);
    expect([large.panX, large.panY]).toEqual([668, 468]);
    const small = clampTransform({ ...base, width: 20, height: 10, panX: 10000, panY: 10000 }, viewport);
    expect([small.panX, small.panY]).toEqual([390, 295]);
    expect(clampTransform(small, { width: 10, height: 8 })).toMatchObject({ panX: 5, panY: 1 });
  });

  it("normalizes pixel, line and page wheel deltas without losing small trackpad values", () => {
    // 测试目标：统一wheel三种deltaMode并保留触控板小数增量。
    // 构造方法：调用纯归一化函数分别处理pixel、line、page。
    // 输入数据：0.1pixel、2line、-0.5page，画布height600。
    // 预期行为：对应0.1、32、-300像素。
    expect(wheelDeltaPixels(.1, 0, 600)).toBe(.1);
    expect(wheelDeltaPixels(2, 1, 600)).toBe(32);
    expect(wheelDeltaPixels(-.5, 2, 600)).toBe(-300);
  });
});
