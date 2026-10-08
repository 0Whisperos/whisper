import { describe, expect, it, vi } from "vitest";

import { AVATAR_CROP_VIEWPORT_SIZE, exportAvatarCrop, getAvatarCropRect } from "./avatarCrop";

describe("avatar crop", () => {
  it("centers a square crop in a landscape source image", () => {
    // 测试目标：验证 1:1 头像裁剪在横向原图上默认居中且不超出图片边界。
    // 构造方法：给裁剪计算器传入 800×400 的原图、初始缩放比例和零位移。
    // 输入数据：宽 800、高 400、zoom=1、panX=0、panY=0。
    // 预期行为：裁剪区域为居中的 400×400 正方形，起点为 (200, 0)。
    expect(getAvatarCropRect({ imageWidth: 800, imageHeight: 400, zoom: 1, panX: 0, panY: 0 })).toEqual({
      x: 200,
      y: 0,
      size: 400,
    });
  });

  it("moves the crop window when the user drags the source image", () => {
    // 测试目标：验证拖动位移会改变源图中的裁剪位置。
    // 构造方法：分别计算 560×280 横图在初始位置和向左拖动 70px 后的裁剪框。
    // 输入数据：两次均 zoom=1，第二次 panX=-70。
    // 预期行为：拖动后裁剪框向源图右侧移动 70 个源图像素。
    const centered = getAvatarCropRect({ imageWidth: 560, imageHeight: 280, zoom: 1, panX: 0, panY: 0 });
    const dragged = getAvatarCropRect({ imageWidth: 560, imageHeight: 280, zoom: 1, panX: -70, panY: 0 });

    expect(centered.x).toBe(140);
    expect(dragged.x).toBe(210);
    expect(dragged.size).toBe(280);
  });

  it("exports the selected crop as a square PNG file", async () => {
    // 测试目标：验证确认裁剪后导出文件名、MIME 类型和画布输出尺寸均为 PNG 正方形。
    // 构造方法：模拟 560×280 图片和 Canvas 2D/toBlob，再调用裁剪导出函数。
    // 输入数据：初始居中的横向图片，裁剪框为 280×280。
    // 预期行为：返回 avatar.png/image/png 文件，并按正方形尺寸绘制选区。
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(["png-bytes"], { type: "image/png" })));
    const originalCreateElement = document.createElement.bind(document);
    const canvas = originalCreateElement("canvas");
    Object.defineProperty(canvas, "getContext", { configurable: true, value: vi.fn(() => ({ drawImage })) });
    Object.defineProperty(canvas, "toBlob", { configurable: true, value: toBlob });
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) =>
      tagName === "canvas" ? canvas : originalCreateElement(tagName, options)) as typeof document.createElement);

    const file = await exportAvatarCrop({} as HTMLImageElement, {
      imageWidth: 560,
      imageHeight: 280,
      zoom: 1,
      panX: 0,
      panY: 0,
    });

    expect(file.name).toBe("avatar.png");
    expect(file.type).toBe("image/png");
    expect(canvas.width).toBe(AVATAR_CROP_VIEWPORT_SIZE);
    expect(canvas.height).toBe(AVATAR_CROP_VIEWPORT_SIZE);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 140, 0, 280, 280, 0, 0, 280, 280);
  });
});
