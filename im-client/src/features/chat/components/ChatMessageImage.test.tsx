import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageImage } from "./ChatMessageImage";

describe("ChatMessageImage", () => {
  afterEach(cleanup);
  it("resets loaded interactions when the source changes and supports keyboard opening", () => {
    // 测试目标：验证 src 改变立即撤销旧图片交互，重新 load 后键盘可打开。
    // 构造方法：渲染图片 A 并 load，再替换图片 B、回到 A，在重新 load 前后按 Enter。
    // 输入数据：asset://a、asset://b、asset://a；三次 src 状态均为正式附件。
    // 预期行为：变更 src 后无 zoom-in 且 Enter 无效；重新 load 后 Enter 调用打开一次。
    const props = { src: "asset://a", interactive: true, onOpen: vi.fn(), onMenu: vi.fn(), onCloseMenu: vi.fn(),
      onLayout: vi.fn(), onError: vi.fn(), onRetry: vi.fn() };
    const { rerender } = render(<ChatMessageImage {...props} />); const image = screen.getByRole("img", { name: "聊天图片" });
    fireEvent.load(image); expect(image).toHaveClass("is-interactive");
    rerender(<ChatMessageImage {...props} src="asset://b" />); expect(image).not.toHaveClass("is-interactive");
    rerender(<ChatMessageImage {...props} />); expect(image).not.toHaveClass("is-interactive");
    fireEvent.keyDown(image, { key: "Enter" }); expect(props.onOpen).not.toHaveBeenCalled();
    fireEvent.load(image); fireEvent.keyDown(image, { key: "Enter" }); expect(props.onOpen).toHaveBeenCalledTimes(1);
  });
});
