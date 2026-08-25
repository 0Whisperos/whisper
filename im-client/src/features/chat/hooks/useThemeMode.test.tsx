import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useThemeMode } from "./useThemeMode";

const nativeStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
const nativeMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return matches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    }),
  });
  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (nativeStorageDescriptor) {
    Object.defineProperty(window, "localStorage", nativeStorageDescriptor);
    window.localStorage.clear();
  }
  if (nativeMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", nativeMatchMediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

describe("useThemeMode", () => {
  it("switches theme modes and persists the selected mode", () => {
    // 测试目标：验证主题模式可在 system/light/dark 间切换并持久化。
    // 构造方法：安装浅色系统 matchMedia，渲染 hook 后依次切换主题。
    // 输入数据：themeMode=dark 和 themeMode=light。
    // 预期行为：appliedTheme 跟随显式模式变化，localStorage 保存最后选择。
    installMatchMedia(false);
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.themeMode).toBe("system");
    expect(result.current.appliedTheme).toBe("light");
    act(() => result.current.setThemeMode("dark"));
    expect(result.current.appliedTheme).toBe("dark");
    act(() => result.current.setThemeMode("light"));

    expect(result.current.appliedTheme).toBe("light");
    expect(window.localStorage.getItem("whisper.authenticated.themeMode")).toBe("light");
  });

  it("only system mode follows media changes and storage failures are tolerated", () => {
    // 测试目标：验证只有 system 模式响应系统深色变化，且 storage 异常不会阻止切换。
    // 构造方法：安装可控 matchMedia，并把 localStorage getter 设为抛出异常。
    // 输入数据：系统深色变化 true，以及显式 themeMode=light。
    // 预期行为：system 下 appliedTheme 变 dark；显式 light 后系统变化不再覆盖。
    const media = installMatchMedia(false);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
    const { result } = renderHook(() => useThemeMode());

    act(() => media.setMatches(true));
    expect(result.current.appliedTheme).toBe("dark");
    act(() => result.current.setThemeMode("light"));
    act(() => media.setMatches(false));

    expect(result.current.themeMode).toBe("light");
    expect(result.current.appliedTheme).toBe("light");
  });
});
