import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

function mockCanvasRuntime() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 640,
    height: 360,
    top: 0,
    right: 640,
    bottom: 360,
    left: 0,
    toJSON: () => ({}),
  });
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCanvasRuntime();
  });

  it("renders the login content without the HTML preview window shell", () => {
    // 测试目标：验证 Tauri 内容区只渲染登录主体，不再套用 HTML 预览页的假窗口外框。
    // 构造方法：模拟 canvas 运行环境后渲染 LoginPage，并检查用户可见内容和壳层 class。
    // 输入数据：无用户输入，只检查初始页面结构。
    // 预期行为：登录表单和小游戏区域存在，`.client-window`、`.client-titlebar`、`.window-dot` 不存在。
    const { container } = render(<LoginPage />);

    expect(screen.getByLabelText("小恐龙小游戏区域")).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(container.querySelector(".client-window")).not.toBeInTheDocument();
    expect(container.querySelector(".client-titlebar")).not.toBeInTheDocument();
    expect(container.querySelector(".window-dot")).not.toBeInTheDocument();
  });
});
