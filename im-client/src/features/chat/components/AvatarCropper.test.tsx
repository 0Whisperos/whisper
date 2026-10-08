import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exportAvatarCropMock } = vi.hoisted(() => ({ exportAvatarCropMock: vi.fn() }));

vi.mock("./avatarCrop", () => ({
  AVATAR_CROP_VIEWPORT_SIZE: 280,
  exportAvatarCrop: exportAvatarCropMock,
}));

import { AvatarCropper } from "./AvatarCropper";

describe("AvatarCropper", () => {
  const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const originalPointerEventDescriptor = Object.getOwnPropertyDescriptor(window, "PointerEvent");

  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:crop-source") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    exportAvatarCropMock.mockReset();
    if (originalCreateObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    if (originalPointerEventDescriptor) Object.defineProperty(window, "PointerEvent", originalPointerEventDescriptor);
    else Reflect.deleteProperty(window, "PointerEvent");
  });

  it("lets the user zoom and drag before confirming the square crop", async () => {
    // 测试目标：验证用户可缩放并拖动图片，确认时将变换参数和裁剪 PNG 返回。
    // 构造方法：渲染裁剪器、模拟图片加载，点击放大并拖动裁剪视口中的图片。
    // 输入数据：560×280 源图、一次 125% 缩放、向左 30px/向上 10px 拖动。
    // 预期行为：导出函数收到对应 zoom/pan，确认回调收到裁剪后的 PNG 文件。
    const user = userEvent.setup();
    const source = new File(["source"], "landscape.jpg", { type: "image/jpeg" });
    const cropped = new File(["cropped"], "avatar.png", { type: "image/png" });
    exportAvatarCropMock.mockResolvedValueOnce(cropped);
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { unmount } = render(<AvatarCropper file={source} onCancel={onCancel} onConfirm={onConfirm} />);

    const image = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 560 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 280 });
    fireEvent.load(image);
    await user.click(screen.getByRole("button", { name: "放大" }));
    const viewport = screen.getByLabelText("头像裁剪区域");
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 70, clientY: 90 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    await user.click(screen.getByRole("button", { name: "使用此头像" }));

    expect(exportAvatarCropMock).toHaveBeenCalledWith(image, {
      imageWidth: 560,
      imageHeight: 280,
      zoom: 1.25,
      panX: -30,
      panY: -10,
    });
    expect(onConfirm).toHaveBeenCalledWith(cropped);
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
  });

  it("cancels without exporting or confirming the crop", async () => {
    // 测试目标：验证取消裁剪不生成图片，也不覆盖资料编辑器中的现有头像草稿。
    // 构造方法：渲染裁剪器并点击取消按钮。
    // 输入数据：待裁剪文件 landscape.jpg。
    // 预期行为：仅触发 onCancel，不调用导出函数或 onConfirm。
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { unmount } = render(<AvatarCropper file={new File(["source"], "landscape.jpg", { type: "image/jpeg" })} onCancel={onCancel} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "取消裁剪" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(exportAvatarCropMock).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it("shows an error and blocks confirmation when the selected image cannot be decoded", async () => {
    // 测试目标：验证无法解码的输入图片显示错误，并阻止确认裁剪。
    // 构造方法：渲染裁剪器，对图片触发加载失败事件后尝试确认。
    // 输入数据：损坏的 landscape.jpg 文件。
    // 预期行为：显示可访问错误提示，确认按钮不可用且不调用导出函数。
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { unmount } = render(<AvatarCropper file={new File(["invalid"], "landscape.jpg")} onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.error(screen.getByRole("img", { name: "待裁剪图片" }));

    expect(screen.getByRole("alert")).toHaveTextContent("无法读取这张图片");
    expect(screen.getByRole("button", { name: "使用此头像" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(exportAvatarCropMock).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
  });
});
