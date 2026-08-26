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
    // Test goal: verify the Tauri content area renders the login experience without the old preview window chrome.
    // Construction: mock the canvas runtime, render LoginPage, and inspect user-visible content plus shell classes.
    // Input data: no saved users and no user input.
    // Expected behavior: the login form and game area exist while preview-window classes are absent.
    const { container } = render(
      <LoginPage
        savedUsers={[]}
        credentialWarning={null}
        isLoadingSavedUsers={false}
        onPasswordLogin={() => undefined}
        onSavedUserLogin={() => undefined}
      />,
    );

    expect(screen.getByLabelText("小恐龙小游戏区域")).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(container.querySelector(".client-window")).not.toBeInTheDocument();
    expect(container.querySelector(".client-titlebar")).not.toBeInTheDocument();
    expect(container.querySelector(".window-dot")).not.toBeInTheDocument();
  });
});
