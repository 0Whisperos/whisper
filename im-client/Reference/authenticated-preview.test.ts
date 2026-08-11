import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const referenceDir = resolve(process.cwd(), "Reference");
const htmlPath = resolve(referenceDir, "authenticated-preview.html");
const scriptPath = resolve(referenceDir, "authenticated-preview.js");
const dataPath = resolve(referenceDir, "authenticated-preview-data.js");
const cssPath = resolve(referenceDir, "authenticated-preview.css");
const themeStorageKey = "whisper.authenticatedPrototype.themeMode";
const nativeStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
const nativeMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const nativeConfirmDescriptor = Object.getOwnPropertyDescriptor(window, "confirm");

type MediaQueryController = {
  setMatches: (matches: boolean) => void;
};

type PrototypeData = {
  sessions: Array<Record<string, unknown>>;
  conversations: Record<string, unknown>;
  [key: string]: unknown;
};

type LoadPrototypeOptions = {
  darkSystem?: boolean;
  storageAvailable?: boolean;
  preserveStorage?: boolean;
  width?: number;
  messageScrollHeight?: number;
  prepareData?: (data: PrototypeData) => void;
};

function installMatchMedia(initialMatches = false): MediaQueryController {
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
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    }),
  });

  return {
    setMatches(nextMatches) {
      matches = nextMatches;
      const event = { matches, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function loadPrototype(options: LoadPrototypeOptions = {}) {
  expect(existsSync(htmlPath), "页面产物应先存在，随后才能载入真实 DOM").toBe(true);
  expect(existsSync(scriptPath), "页面脚本应先存在，随后才能执行真实交互").toBe(true);
  expect(existsSync(dataPath), "数据脚本应先存在，随后才能执行真实交互").toBe(true);

  document.open();
  document.write(readFileSync(htmlPath, "utf8"));
  document.close();
  const media = installMatchMedia(options.darkSystem ?? false);

  if (options.messageScrollHeight !== undefined) {
    const messageList = document.querySelector<HTMLElement>("[data-message-list]");
    expect(messageList, "真实消息列表应存在，随后才能定义可观察滚动高度").not.toBeNull();
    Object.defineProperty(messageList, "scrollHeight", { configurable: true, value: options.messageScrollHeight });
  }

  Object.defineProperty(window, "innerWidth", { configurable: true, value: options.width ?? 1120 });

  if (options.storageAvailable === false) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  } else if (!options.preserveStorage) {
    window.localStorage.clear();
  }

  window.eval(readFileSync(dataPath, "utf8"));
  if (options.prepareData) {
    const source = window.__whisperAuthenticatedPrototypeData as PrototypeData;
    const prepared = {
      ...source,
      sessions: source.sessions.slice(),
      conversations: Object.assign(Object.create(null) as Record<string, unknown>, source.conversations),
    };
    options.prepareData(prepared);
    window.__whisperAuthenticatedPrototypeData = prepared;
  }
  window.eval(readFileSync(scriptPath, "utf8"));
  return media;
}

function clickByLabel(label: string) {
  const button = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  button?.click();
}

function rgb(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3) throw new Error(`无法解析颜色 ${hex}`);
  return channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
}

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const [red, green, blue] = rgb(hex);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function cssToken(css: string, selector: string, token: string) {
  const start = css.indexOf(selector);
  const block = start === -1 ? undefined : css.slice(start, css.indexOf("}", start));
  const value = block?.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`未找到 ${selector} 的 ${token}`);
  return value;
}

afterEach(() => {
  window.__whisperAuthenticatedPrototype?.destroy();
  delete (window as typeof window & { __whisperAuthenticatedPrototype?: unknown }).__whisperAuthenticatedPrototype;
  delete window.__whisperAuthenticatedPrototypeData;
  if (nativeStorageDescriptor) {
    Object.defineProperty(window, "localStorage", nativeStorageDescriptor);
  } else {
    delete (window as typeof window & { localStorage?: Storage }).localStorage;
  }
  if (nativeMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", nativeMatchMediaDescriptor);
  } else {
    delete (window as typeof window & { matchMedia?: typeof window.matchMedia }).matchMedia;
  }
  if (nativeConfirmDescriptor) {
    Object.defineProperty(window, "confirm", nativeConfirmDescriptor);
  } else {
    delete (window as unknown as { confirm?: typeof window.confirm }).confirm;
  }
  try {
    window.localStorage.clear();
  } catch {
    // 存储不可用场景会在下一次真实 DOM 载入时恢复。
  }
});

describe("authenticated preview", () => {
  it("账号弹出层使用自洽的 dialog 与 radio 语义", () => {
    // 测试目标：验证账号设置不是不完整 menu，而是有标签的非模态 dialog 与主题单选组。
    // 构造方法：载入真实 HTML DOM 与脚本后查询账号触发器、弹出容器和主题选项。
    // 输入数据：账号触发器、主题 fieldset 与三个主题按钮。
    // 预期行为：触发器声明 dialog，容器为 dialog，主题使用 radiogroup/radio，退出为普通链接。
    loadPrototype();
    expect(document.querySelector("[aria-label='账号与设置']")?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.querySelector("[data-theme-menu]")?.getAttribute("role")).toBe("dialog");
    expect(document.querySelector("[data-theme-options]")?.getAttribute("role")).toBe("radiogroup");
    expect(document.querySelectorAll("[data-theme-option][role='radio']")).toHaveLength(3);
    expect(document.querySelector("[data-logout]")?.tagName).toBe("A");
  });

  it("重复初始化会重置账号菜单状态且仍可关闭", () => {
    // 测试目标：验证同一 DOM 重复执行真实脚本不会遗留打开的账号菜单状态。
    // 构造方法：载入页面后打开账号菜单，再直接 eval 同一真实脚本并重新打开菜单。
    // 输入数据：打开状态的账号菜单和 authenticated-preview.js 的第二次执行。
    // 预期行为：重初始化后菜单隐藏、触发器收起，重新打开后 Escape 仍能关闭。
    loadPrototype();
    clickByLabel("账号与设置");
    window.eval(readFileSync(scriptPath, "utf8"));
    const account = document.querySelector<HTMLElement>("[aria-label='账号与设置']");
    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(true);
    expect(account?.getAttribute("aria-expanded")).toBe("false");
    account?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(true);
  });

  it("重复初始化只保留一组会话切换监听器", () => {
    // 测试目标：验证同一 DOM 重复执行应用脚本后，旧实例监听器会被清理且不重复恢复草稿。
    // 构造方法：二次初始化后建立周然草稿并返回林晓，清空 textarea value setter spy 再切到周然。
    // 输入数据：authenticated-preview.js 二次执行、周然草稿“重初始化目标草稿”和一次会话点击。
    // 预期行为：最终切换只调用一次 value setter，并恢复周然会话的目标草稿。
    loadPrototype();
    window.eval(readFileSync(scriptPath, "utf8"));
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const valueSetter = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");

    try {
      document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
      input!.value = "重初始化目标草稿";
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLElement>("[data-conversation-id='linxiao']")?.click();
      valueSetter.mockClear();

      document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();

      expect(valueSetter).toHaveBeenCalledTimes(1);
      expect(valueSetter).toHaveBeenCalledWith("重初始化目标草稿");
      expect(input?.value).toBe("重初始化目标草稿");
    } finally {
      valueSetter.mockRestore();
    }
  });

  it("跨断点 resize 保留已打开的聊天面板", () => {
    // 测试目标：验证窄屏已选择会话的 chat 面板不会在桌面往返 resize 后被重置。
    // 构造方法：以 320px 载入页面选择会话，依次切到 1120px 和回到 320px 并派发 resize。
    // 输入数据：周然会话、宽度 1120 与 320 的 resize 事件。
    // 预期行为：data-mobile-panel 始终保留 chat，返回窄屏仍显示该聊天详情。
    loadPrototype({ width: 320 });
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1120 });
    window.dispatchEvent(new Event("resize"));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    window.dispatchEvent(new Event("resize"));
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("chat");
  });

  it("桌面与中等断点同步布局变量和分隔条当前值", () => {
    // 测试目标：验证运行时布局值与 CSS 的桌面和中等断点 rail/sidebar 宽度契约一致。
    // 构造方法：以1120px载入原型检查初值，再改为800px并派发 resize 后检查更新值。
    // 输入数据：1120px 桌面宽度、800px 中等宽度，以及 rail/sidebar 两个 separator。
    // 预期行为：rail 始终为56，sidebar 从280变为240，inline 变量和 aria-valuenow 同步。
    loadPrototype({ width: 1120 });
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    const rail = document.querySelector<HTMLElement>("[data-resizer='rail']");
    const sidebar = document.querySelector<HTMLElement>("[data-resizer='sidebar']");
    expect(shell?.style.getPropertyValue("--rail-width")).toBe("56px");
    expect(shell?.style.getPropertyValue("--sidebar-width")).toBe("280px");
    expect(rail?.getAttribute("aria-valuenow")).toBe("56");
    expect(sidebar?.getAttribute("aria-valuenow")).toBe("280");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));

    expect(shell?.style.getPropertyValue("--rail-width")).toBe("56px");
    expect(shell?.style.getPropertyValue("--sidebar-width")).toBe("240px");
    expect(rail?.getAttribute("aria-valuenow")).toBe("56");
    expect(sidebar?.getAttribute("aria-valuenow")).toBe("240");
  });

  it("跨断点打开的账号面板 Escape 返回当前可见触发器", () => {
    // 测试目标：验证桌面打开账号面板后缩至窄屏，Escape 将焦点归还给底部账号入口。
    // 构造方法：桌面加载页面打开账号面板，改为 320px 并派发 resize，随后发送 Escape。
    // 输入数据：1120 到 320 的 resize 事件与 Escape 键盘输入。
    // 预期行为：面板关闭后焦点位于可见的移动底部账号按钮。
    loadPrototype({ width: 1120 });
    clickByLabel("账号与设置");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".bottom-nav [aria-label='账号与设置']")).toHaveFocus();
  });

  it("退出链接保留 file 相对 href 并只在取消时阻止导航", () => {
    // 测试目标：验证退出使用原生相对链接，并且确认取消会阻止默认导航。
    // 构造方法：载入真实页面，将 confirm 设为 false，监听退出链接 click 的默认取消状态。
    // 输入数据：href=login-preview.html 与 confirm 返回 false。
    // 预期行为：链接目标正确、click 被 preventDefault，且不会标记确认退出状态。
    loadPrototype();
    const logout = document.querySelector<HTMLAnchorElement>("[data-logout]");
    let prevented = false;
    logout?.addEventListener("click", (event) => { prevented = event.defaultPrevented; });
    window.confirm = vi.fn(() => false);
    logout?.click();
    expect(logout?.getAttribute("href")).toBe("login-preview.html");
    expect(prevented).toBe(true);
    expect(document.documentElement.dataset.logoutState).not.toBe("confirmed");
  });

  it("退出确认保留原生链接导航并记录确认状态", () => {
    // 测试目标：验证确认退出不会被脚本重写为 location 赋值，而保留链接默认语义。
    // 构造方法：载入页面，将 confirm 设为 true，并在后置监听器中阻止 jsdom 的实际导航。
    // 输入数据：href=login-preview.html 与 confirm 返回 true 的 click 事件。
    // 预期行为：脚本标记 confirmed，且在测试后置监听器介入前未取消默认链接行为。
    loadPrototype();
    const logout = document.querySelector<HTMLAnchorElement>("[data-logout]");
    let preventedBeforeHarness = false;
    logout?.addEventListener("click", (event) => { preventedBeforeHarness = event.defaultPrevented; event.preventDefault(); });
    window.confirm = vi.fn(() => true);
    logout?.click();
    expect(preventedBeforeHarness).toBe(false);
    expect(document.documentElement.dataset.logoutState).toBe("confirmed");
  });

  it("消息渲染通过 DOM textContent 保留文本内容", () => {
    // 测试目标：验证消息渲染不再以 HTML 字符串拼接用户可见文本。
    // 构造方法：读取真实脚本源码，并载入真实页面后选择周然会话。
    // 输入数据：authenticated-preview.js 源码和周然的模拟消息。
    // 预期行为：源码不对消息列表赋 innerHTML，界面仍呈现周然的消息文本。
    expect(readFileSync(scriptPath, "utf8")).not.toMatch(/messages\.innerHTML\s*=/);
    loadPrototype();
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    expect(document.querySelector("[data-message-list]")?.textContent).toContain("明天十点同步可以吗？");
  });

  it("初始加载有溢出消息时定位到最新消息", () => {
    // 测试目标：验证原型首次渲染消息记录后直接定位到列表底部。
    // 构造方法：在执行真实脚本前为真实消息列表定义可观察的 scrollHeight，再载入原型。
    // 输入数据：消息列表 scrollHeight 为 640，初始会话为林晓。
    // 预期行为：首次 render 完成后 scrollTop 等于 640。
    loadPrototype({ messageScrollHeight: 640 });
    expect(document.querySelector<HTMLElement>("[data-message-list]")?.scrollTop).toBe(640);
  });

  it("点击切换会话后定位到新会话的最新消息", () => {
    // 测试目标：验证用户主动切换会话时，新消息记录从底部最新位置呈现。
    // 构造方法：载入具有可观察滚动高度的真实页面，将列表移到顶部后点击周然会话。
    // 输入数据：消息列表 scrollHeight 为 720、切换前 scrollTop 为 0、conversationId 为 zhouran。
    // 预期行为：会话消息重建后 scrollTop 等于 720。
    loadPrototype({ messageScrollHeight: 720 });
    const messageList = document.querySelector<HTMLElement>("[data-message-list]");
    if (messageList) messageList.scrollTop = 0;
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    expect(messageList?.scrollTop).toBe(720);
  });

  it("resize 重建消息 DOM 后保留用户的非零滚动位置", () => {
    // 测试目标：验证纯布局 resize 不会把正在阅读历史消息的用户强制带回列表底部。
    // 构造方法：记录首个节点，设置非零 scrollTop 并派发 scroll，随后静默归零模拟隐藏布局盒并 resize。
    // 输入数据：scrollHeight 900、用户滚动值 137、静默 DOM 值 0，以及从 1120 到 800 的窗口变化。
    // 预期行为：消息节点被重建，缓存的用户滚动值将 scrollTop 恢复为 137。
    loadPrototype({ messageScrollHeight: 900, width: 1120 });
    const messageList = document.querySelector<HTMLElement>("[data-message-list]");
    const firstMessage = messageList?.firstElementChild;
    if (messageList) {
      messageList.scrollTop = 137;
      messageList.dispatchEvent(new Event("scroll"));
      messageList.scrollTop = 0;
    }
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));
    expect(messageList?.firstElementChild).not.toBe(firstMessage);
    expect(messageList?.scrollTop).toBe(137);
  });

  it("从有效联系人资料进入会话时定位到最新消息", () => {
    // 测试目标：验证有效 data-enter-chat 导航会将目标会话定位到消息列表底部。
    // 构造方法：进入好友视图并选择有关联会话的周然，将列表移到历史位置后点击发消息。
    // 输入数据：scrollHeight 为 900、进入聊天前 scrollTop 为 317、data-enter-chat 为 zhouran。
    // 预期行为：切回周然聊天后 scrollTop 等于 900。
    loadPrototype({ messageScrollHeight: 900 });
    clickByLabel("好友");
    document.querySelector<HTMLElement>("[data-contact-id='zhouran']")?.click();
    const messageList = document.querySelector<HTMLElement>("[data-message-list]");
    if (messageList) messageList.scrollTop = 317;
    document.querySelector<HTMLElement>("[data-enter-chat='zhouran']")?.click();
    expect(messageList?.scrollTop).toBe(900);
  });

  it("非会话切换导航重建消息 DOM 时逐步保留滚动位置", () => {
    // 测试目标：验证视图切换、联系人选择和两个移动返回入口均不改变用户的消息滚动位置。
    // 构造方法：每次设置哨兵并派发 scroll 后静默归零，再依次切视图、选联系人及使用两个返回入口。
    // 输入数据：320px 视口、scrollHeight 900、静默 DOM 值 0，以及用户哨兵值 101、202、303、404。
    // 预期行为：四类非会话重绘均从缓存恢复各自的用户哨兵值，而不采用静默归零值。
    loadPrototype({ messageScrollHeight: 900, width: 320 });
    const messageList = document.querySelector<HTMLElement>("[data-message-list]");

    if (messageList) {
      messageList.scrollTop = 101;
      messageList.dispatchEvent(new Event("scroll"));
      messageList.scrollTop = 0;
    }
    document.querySelector<HTMLElement>(".bottom-nav [data-view-target='contacts']")?.click();
    expect(messageList?.scrollTop).toBe(101);

    if (messageList) {
      messageList.scrollTop = 202;
      messageList.dispatchEvent(new Event("scroll"));
      messageList.scrollTop = 0;
    }
    document.querySelector<HTMLElement>("[data-contact-id='zhouran']")?.click();
    expect(messageList?.scrollTop).toBe(202);

    if (messageList) {
      messageList.scrollTop = 303;
      messageList.dispatchEvent(new Event("scroll"));
      messageList.scrollTop = 0;
    }
    document.querySelector<HTMLElement>("[aria-label='返回联系人']")?.click();
    expect(messageList?.scrollTop).toBe(303);

    document.querySelector<HTMLElement>(".bottom-nav [data-view-target='messages']")?.click();
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    if (messageList) {
      messageList.scrollTop = 404;
      messageList.dispatchEvent(new Event("scroll"));
      messageList.scrollTop = 0;
    }
    document.querySelector<HTMLElement>("[aria-label='返回会话']")?.click();
    expect(messageList?.scrollTop).toBe(404);
  });

  it("关键前景与边界 token 满足主题对比度规则", () => {
    // 测试目标：验证真实 CSS 的文字、危险操作、头像、控件边界和焦点颜色满足指定对比度。
    // 构造方法：读取 authenticated-preview.css 并以 WCAG 相对亮度公式计算 token 组合。
    // 输入数据：light/dark 根 token 与关键交互区域背景 token。
    // 预期行为：正文色至少 4.5:1，控件边界和焦点至少 3:1，brand token 保持独立。
    const css = readFileSync(cssPath, "utf8");
    const light = (token: string) => cssToken(css, ":root", token);
    const dark = (token: string) => cssToken(css, ':root[data-theme="dark"]', token);

    expect(contrast(light("--active-text"), light("--selected"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--active-text"), dark("--selected"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light("--muted-selected"), light("--selected"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--muted-selected"), dark("--selected"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light("--danger"), light("--surface-raised"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--danger"), dark("--surface-raised"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light("--avatar-gold-foreground"), light("--avatar-gold"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light("--control-border"), light("--surface-raised"))).toBeGreaterThanOrEqual(3);
    expect(contrast(dark("--control-border"), dark("--surface-raised"))).toBeGreaterThanOrEqual(3);
    expect(contrast(dark("--focus"), dark("--surface-raised"))).toBeGreaterThanOrEqual(3);
    expect(contrast(dark("--focus"), dark("--selected"))).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/\.contacts-panel\s*\{[^}]*grid-column:\s*2\s*\/\s*-1/);
    expect(css).toMatch(/\.logout-button\s*\{[^}]*text-decoration:\s*none/);
    expect(css).toContain("a:focus-visible");
  });
  it("首次加载在 system 模式下采用系统配色", () => {
    // 测试目标：验证首次进入页面默认使用 system 模式并采纳深色系统偏好。
    // 构造方法：清空浏览器存储，载入真实 HTML DOM 与真实页面脚本。
    // 输入数据：prefers-color-scheme: dark 为 true，且不存在已保存主题。
    // 预期行为：根元素同时暴露 data-theme=dark、data-theme-mode=system 和 dark color-scheme。
    loadPrototype({ darkSystem: true });

    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("三种主题模式会立即切换并持久化", () => {
    // 测试目标：验证账号菜单的 system、light、dark 三个单选项均可应用和保存。
    // 构造方法：载入真实页面，打开账号菜单并依次点击三个主题单选项。
    // 输入数据：主题模式 system、light、dark，以及可用的 localStorage。
    // 预期行为：根元素主题随模式变化，选项 ARIA 状态更新且最后选择可在重新载入后恢复。
    loadPrototype({ darkSystem: true });
    clickByLabel("账号与设置");

    document.querySelector<HTMLElement>("[data-theme-option='system']")?.click();
    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("system");

    clickByLabel("账号与设置");

    document.querySelector<HTMLElement>("[data-theme-option='light']")?.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");

    window.__whisperAuthenticatedPrototype?.destroy();
    loadPrototype({ darkSystem: true, preserveStorage: true });
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    clickByLabel("账号与设置");
    document.querySelector<HTMLElement>("[data-theme-option='dark']")?.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector("[data-theme-option='dark']")?.getAttribute("aria-checked")).toBe("true");

    window.__whisperAuthenticatedPrototype?.destroy();
    loadPrototype({ darkSystem: false, preserveStorage: true });
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    clickByLabel("账号与设置");
    document.querySelector<HTMLElement>("[data-theme-option='system']")?.click();
    window.__whisperAuthenticatedPrototype?.destroy();
    loadPrototype({ darkSystem: true, preserveStorage: true });
    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("只有 system 模式响应系统配色变化，存储异常不阻止切换", () => {
    // 测试目标：验证 system 会追随系统变化，手动主题保持稳定且存储故障被安全忽略。
    // 构造方法：使用可触发的 matchMedia 测试替身，先在 system 再在手动模式下改变系统偏好。
    // 输入数据：系统深浅色变更与不可用 localStorage。
    // 预期行为：仅 system 更新 data-theme，light/dark 忽略系统变更且仍可切换。
    const media = loadPrototype({ darkSystem: false, storageAvailable: false });
    media.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    clickByLabel("账号与设置");
    document.querySelector<HTMLElement>("[data-theme-option='light']")?.click();
    media.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("light");

    clickByLabel("账号与设置");
    document.querySelector<HTMLElement>("[data-theme-option='dark']")?.click();
    media.setMatches(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("消息和好友入口切换主要视图", () => {
    // 测试目标：验证功能栏可在会话消息与好友联系人两个主要视图间导航。
    // 构造方法：载入真实页面并按顺序点击消息与好友入口。
    // 输入数据：带 aria-label 的“消息”和“好友”导航按钮。
    // 预期行为：应用 data-view 与页面标题分别更新为 messages 和 contacts 对应状态。
    loadPrototype();
    clickByLabel("好友");
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-view")).toBe("contacts");
    expect(document.querySelector("[data-main-title]")?.textContent).toContain("好友");

    clickByLabel("消息");
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-view")).toBe("messages");
  });

  it("选择会话会更新聊天标题与消息内容", () => {
    // 测试目标：验证点击不同会话后，聊天区渲染对应联系人和消息记录。
    // 构造方法：载入真实页面后点击带周然会话 ID 的会话行。
    // 输入数据：data-conversation-id 为 zhouran 的会话按钮。
    // 预期行为：应用记录活动会话，标题显示周然，消息区域显示该会话的文本。
    loadPrototype();
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();

    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-active-conversation")).toBe("zhouran");
    expect(document.querySelector("[data-chat-title]")?.textContent).toBe("周然");
    expect(document.querySelector("[data-message-list]")?.textContent).toContain("明天十点同步可以吗？");
  });

  it("窄屏选中会话后可返回会话列表", () => {
    // 测试目标：验证小于 680px 的单面板流程具有可见且可用的返回入口。
    // 构造方法：以 320px 宽度载入真实页面，选择会话后点击返回按钮。
    // 输入数据：窄屏宽度 320、周然会话与“返回会话”按钮。
    // 预期行为：初始显示会话列表，选择后显示聊天详情，返回后恢复列表。
    loadPrototype({ width: 320 });
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("sessions");

    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("chat");

    clickByLabel("返回会话");
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("sessions");
  });

  it("主题菜单支持方向键、确认键和焦点返回", () => {
    // 测试目标：验证主题菜单提供键盘单选导航、ARIA 状态和确认选择后的焦点恢复。
    // 构造方法：打开账号菜单，将焦点置于 system 项，发送 ArrowDown 和 Enter 键盘事件。
    // 输入数据：ArrowDown 与 Enter 两个键盘输入。
    // 预期行为：light 项被选中，菜单关闭且焦点返回账号按钮，并保留正确 aria-expanded 状态。
    loadPrototype();
    const account = document.querySelector<HTMLElement>("[aria-label='账号与设置']");
    account?.click();
    const system = document.querySelector<HTMLElement>("[data-theme-option='system']");
    system?.focus();
    system?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const light = document.querySelector<HTMLElement>("[data-theme-option='light']");
    expect(light).toHaveFocus();
    expect(light?.getAttribute("aria-checked")).toBe("true");
    expect(system?.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
    expect(light?.tabIndex).toBe(0);
    expect(system?.tabIndex).toBe(-1);
    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(false);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(document.querySelector("[data-theme-option='light']")?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(true);
    expect(account).toHaveFocus();
    expect(account?.getAttribute("aria-expanded")).toBe("false");
  });

  it("窄屏账号菜单关闭后把焦点还给可见的触发按钮", () => {
    // 测试目标：验证窄屏的账号主题菜单关闭后不会将键盘焦点放到隐藏侧栏。
    // 构造方法：以 320px 宽度加载页面，通过底部账号入口打开菜单并发送 Escape。
    // 输入数据：移动端“账号与设置”按钮与 Escape 键盘输入。
    // 预期行为：菜单关闭且 document.activeElement 是实际点击的底部账号按钮。
    loadPrototype({ width: 320 });
    const mobileAccount = document.querySelector<HTMLElement>(".bottom-nav [aria-label='账号与设置']");
    mobileAccount?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(true);
    expect(mobileAccount).toHaveFocus();
  });

  it("移动导航公开当前视图状态", () => {
    // 测试目标：验证移动底部导航在切换好友后同时提供可见和 ARIA 当前页状态。
    // 构造方法：以窄屏载入真实页面并点击底部“好友”入口。
    // 输入数据：data-view-target 为 contacts 的移动导航按钮。
    // 预期行为：该按钮具有 is-active 样式钩子及 aria-current=page。
    loadPrototype({ width: 320 });
    const contacts = document.querySelector<HTMLElement>(".bottom-nav [data-view-target='contacts']");
    contacts?.click();

    expect(contacts).toHaveClass("is-active");
    expect(contacts?.getAttribute("aria-current")).toBe("page");
  });

  it("群聊切换渲染成员数、发送者名、连续消息和最后已读状态", () => {
    // 测试目标：验证群聊的头部与结构化消息字段会转换为用户可见的群聊信息。
    // 构造方法：载入真实原型后选择产品讨论组，并查询消息列表的名称、连续状态和回执。
    // 输入数据：conversationId=product 的固定群聊及其三条结构化消息。
    // 预期行为：头部显示成员数，左侧消息显示周然名，连续消息缩减头像，最后己方消息显示已读。
    loadPrototype();
    document.querySelector<HTMLElement>("[data-conversation-id='product']")?.click();

    expect(document.querySelector("[data-chat-presence]")?.textContent).toBe("12 位成员");
    expect(document.querySelector(".message-sender")?.textContent).toBe("周然");
    expect(document.querySelector(".message-row.compact")).not.toBeNull();
    expect(document.querySelector(".message-row.self .message-footer")?.textContent).toContain("已读");
  });

  it("联系人选择更新资料并可进入关联会话", () => {
    // 测试目标：验证通讯录列表、详情面板与会话导航共享明确的联系人关联数据。
    // 构造方法：切换到好友视图，选择周然，再点击详情中的发消息按钮。
    // 输入数据：contactId=zhouran 与其 conversationId=zhouran。
    // 预期行为：详情显示账号和地区，发消息后切回消息视图并打开周然会话。
    loadPrototype();
    clickByLabel("好友");
    document.querySelector<HTMLElement>("[data-contact-id='zhouran']")?.click();

    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-active-contact")).toBe("zhouran");
    expect(document.querySelector("[data-contact-detail]")?.textContent).toContain("账号：zhouran");
    document.querySelector<HTMLElement>("[data-enter-chat='zhouran']")?.click();
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-view")).toBe("messages");
    expect(document.querySelector("[data-chat-title]")?.textContent).toBe("周然");
  });

  it("输入、发送与媒体入口只改变固定状态而不追加消息", () => {
    // 测试目标：验证原型交互不会伪造真实消息发送、清空草稿、权限申请或搜索筛选。
    // 构造方法：记录初始消息数，输入文本后点击发送和截图入口。
    // 输入数据：textarea 文本“测试预览”和 data-tool=截图。
    // 预期行为：发送后文本与可发送状态保留、消息数量不变，状态区依次显示预览提示。
    loadPrototype();
    const list = document.querySelector("[data-message-list]");
    const before = list?.querySelectorAll(".message-row").length;
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const send = document.querySelector<HTMLButtonElement>("[aria-label='发送消息']");
    input!.value = "测试预览";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(send?.disabled).toBe(false);
    clickByLabel("发送消息");
    expect(input?.value).toBe("测试预览");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");
    expect(list?.querySelectorAll(".message-row")).toHaveLength(before ?? 0);
    expect(document.querySelector("[data-activity-status]")?.textContent).toBe("发送仅作界面预览");
    clickByLabel("截图");
    expect(document.querySelector("[data-activity-status]")?.textContent).toBe("截图仅作界面预览");
  });

  it("按会话独立保存并恢复输入草稿", () => {
    // 测试目标：验证不同会话的输入文本互不覆盖，并从当前恢复文本派生发送按钮状态。
    // 构造方法：依次在林晓和周然会话输入草稿，再往返点击两个会话行观察编辑器与按钮。
    // 输入数据：林晓草稿“晚饭草稿”、周然草稿“同步草稿”及两次会话往返切换。
    // 预期行为：首次进入周然为空且不可发送，随后两个会话各自恢复草稿并保持可发送状态。
    loadPrototype();
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const send = document.querySelector<HTMLButtonElement>("[aria-label='发送消息']");

    input!.value = "晚饭草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    expect(input?.value).toBe("");
    expect(send?.disabled).toBe(true);
    expect(send).not.toHaveClass("ready");

    input!.value = "同步草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='linxiao']")?.click();
    expect(input?.value).toBe("晚饭草稿");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");

    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    expect(input?.value).toBe("同步草稿");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");
  });

  it("原型链同名会话仍使用独立的 own 草稿槽位", () => {
    // 测试目标：验证 conversationId 与 Object 原型属性同名时，草稿存储仍按会话隔离且初值为空。
    // 构造方法：应用启动前注入 own constructor 会话，依次为林晓和特殊会话输入草稿并往返切换。
    // 输入数据：conversationId=constructor、林晓草稿“普通会话草稿”和特殊草稿“特殊会话草稿”。
    // 预期行为：特殊会话首次为空且禁用发送，随后两个会话各自恢复文本并派生 enabled/ready。
    loadPrototype({
      prepareData(data) {
        data.sessions.push({ id: "constructor", name: "构造会话", avatar: "构", tone: "gray", type: "direct", preview: "特殊会话", time: "现在" });
        data.conversations["constructor"] = {
          id: "constructor",
          type: "direct",
          name: "构造会话",
          avatar: "构",
          tone: "gray",
          status: "在线",
          participants: {},
          messages: [],
        };
        expect(Object.hasOwn(data.conversations, "constructor")).toBe(true);
      },
    });
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const send = document.querySelector<HTMLButtonElement>("[aria-label='发送消息']");

    input!.value = "普通会话草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='constructor']")?.click();
    expect(input?.value).toBe("");
    expect(send?.disabled).toBe(true);
    expect(send).not.toHaveClass("ready");

    input!.value = "特殊会话草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='linxiao']")?.click();
    expect(input?.value).toBe("普通会话草稿");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");

    document.querySelector<HTMLElement>("[data-conversation-id='constructor']")?.click();
    expect(input?.value).toBe("特殊会话草稿");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");
  });

  it("原样恢复纯空白草稿但保持发送禁用", () => {
    // 测试目标：验证草稿保存不修剪用户输入，而发送可用性仍按 trim 后内容判断。
    // 构造方法：在林晓会话输入三个空格，切到周然写入不同草稿，再切回林晓检查编辑器与按钮。
    // 输入数据：林晓的三个空格、周然的“周然临时草稿”和一次会话往返切换。
    // 预期行为：三个空格原样恢复，发送按钮保持 disabled 且没有 ready 类。
    loadPrototype();
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const send = document.querySelector<HTMLButtonElement>("[aria-label='发送消息']");

    input!.value = "   ";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    input!.value = "周然临时草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='linxiao']")?.click();

    expect(input?.value).toBe("   ");
    expect(send?.disabled).toBe(true);
    expect(send).not.toHaveClass("ready");
  });

  it("从联系人资料进入会话时恢复该会话草稿", () => {
    // 测试目标：验证联系人资料的发消息入口与会话列表切换共享同一套会话草稿恢复行为。
    // 构造方法：先为周然保存草稿，切回林晓写入不同草稿，再从好友视图选择周然并点击发消息。
    // 输入数据：周然的“联系人入口草稿”、林晓的“林晓草稿”和 data-enter-chat=zhouran 的资料按钮。
    // 预期行为：进入周然会话后恢复既有草稿，并从非空文本派生 enabled 与 ready 状态。
    loadPrototype();
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const send = document.querySelector<HTMLButtonElement>("[aria-label='发送消息']");

    document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")?.click();
    input!.value = "联系人入口草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-conversation-id='linxiao']")?.click();
    input!.value = "林晓草稿";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    clickByLabel("好友");
    document.querySelector<HTMLElement>("[data-contact-id='zhouran']")?.click();
    document.querySelector<HTMLElement>("[data-enter-chat='zhouran']")?.click();

    expect(input?.value).toBe("联系人入口草稿");
    expect(send?.disabled).toBe(false);
    expect(send).toHaveClass("ready");
  });

  it("同一会话的 resize 与视图切换不重写输入文本", () => {
    // 测试目标：验证没有切换 conversation 时，布局和主视图重绘不会程序化重写 textarea.value。
    // 构造方法：输入林晓草稿后清空 value setter spy，依次触发 resize、切到好友并切回消息。
    // 输入数据：草稿“保持光标的草稿”、800px resize 以及 contacts/messages 视图往返。
    // 预期行为：三个同会话 render 均不调用 value setter，textarea 仍保留原始草稿。
    loadPrototype({ width: 1120 });
    const input = document.querySelector<HTMLTextAreaElement>("[aria-label='输入消息']");
    const valueSetter = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");

    try {
      input!.value = "保持光标的草稿";
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      valueSetter.mockClear();

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
      window.dispatchEvent(new Event("resize"));
      clickByLabel("好友");
      clickByLabel("消息");

      expect(valueSetter).not.toHaveBeenCalled();
      expect(input?.value).toBe("保持光标的草稿");
    } finally {
      valueSetter.mockRestore();
    }
  });

  it("会话搜索仅显示预览状态且不筛选固定会话", () => {
    // 测试目标：验证搜索输入不改变静态原型数据，只提供稳定的视觉反馈。
    // 构造方法：记录会话行数量，在会话搜索框输入一个不会匹配的文本。
    // 输入数据：搜索会话输入值“不存在的联系人”。
    // 预期行为：会话数量不变，固定状态区显示搜索仅作界面预览。
    loadPrototype();
    const count = document.querySelectorAll("[data-conversation-id]").length;
    const search = document.querySelector<HTMLInputElement>("[aria-label='搜索会话']");
    search!.value = "不存在的联系人";
    search?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(count);
    expect(document.querySelector("[data-session-status]")?.textContent).toBe("搜索仅作界面预览");
  });

  it("会话详情面板可通过 Escape 或外部点击关闭并归还焦点", () => {
    // 测试目标：验证非模态会话详情面板不会困住键盘焦点，并支持常规关闭方式。
    // 构造方法：点击详情触发器，先发送 Escape，再次打开并点击聊天头部空白区域。
    // 输入数据：data-detail-trigger、Escape 键和 chat-head 外部区域。
    // 预期行为：两次面板均关闭，Escape 关闭后焦点返回原详情触发器。
    loadPrototype();
    const trigger = document.querySelector<HTMLElement>("[data-detail-trigger]");
    trigger?.click();
    expect(document.querySelector("[data-detail-panel]")?.hasAttribute("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-detail-panel]")?.hasAttribute("hidden")).toBe(true);
    expect(trigger).toHaveFocus();
    trigger?.click();
    document.querySelector<HTMLElement>(".chat-head")?.click();
    expect(document.querySelector("[data-detail-panel]")?.hasAttribute("hidden")).toBe(true);
  });

  it("窄屏联系人详情返回联系人列表并恢复底部导航状态", () => {
    // 测试目标：验证小于 680px 时通讯录与联系人详情是可返回的单面板流程。
    // 构造方法：以 320px 进入好友页，选择许言联系人，再点击返回联系人按钮。
    // 输入数据：320px 宽度、contactId=xuyan 和返回联系人按钮。
    // 预期行为：选择后 mobile-panel 为 contact-detail 且底部导航隐藏，返回后恢复 contacts 状态。
    loadPrototype({ width: 320 });
    document.querySelector<HTMLElement>(".bottom-nav [data-view-target='contacts']")?.click();
    document.querySelector<HTMLElement>("[data-contact-id='xuyan']")?.click();
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("contact-detail");
    document.querySelector<HTMLElement>("[aria-label='返回联系人']")?.click();
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-mobile-panel")).toBe("contacts");
  });

  it("缺失数据脚本时显示受控失败状态而不抛出异常", () => {
    // 测试目标：验证 file 加载顺序异常时应用不会因缺少模拟数据而产生未捕获错误。
    // 构造方法：写入真实 HTML，临时移除 window 数据对象，只执行应用脚本。
    // 输入数据：不存在 window.__whisperAuthenticatedPrototypeData 的页面环境。
    // 预期行为：应用脚本可安全返回，页面显示预览数据未加载的明确状态文案。
    document.open();
    document.write(readFileSync(htmlPath, "utf8"));
    document.close();
    const prototypeData = window.__whisperAuthenticatedPrototypeData;
    delete window.__whisperAuthenticatedPrototypeData;
    expect(() => window.eval(readFileSync(scriptPath, "utf8"))).not.toThrow();
    expect(document.querySelector("[data-prototype-error]")?.hasAttribute("hidden")).toBe(false);
    window.__whisperAuthenticatedPrototypeData = prototypeData;
  });

  it("当前移动会话与通讯录操作在各自可见反馈区显示状态", () => {
    // 测试目标：验证窄屏中被聊天面板遮住时，搜索和系统入口仍在当前视图提供反馈。
    // 构造方法：以 320px 先输入会话搜索，再进入通讯录点击新的朋友入口。
    // 输入数据：搜索文本“周末”和 data-tool=新的朋友 的系统联系人按钮。
    // 预期行为：session 与 contacts 各自的状态输出包含预览文案，而不是只更新隐藏聊天编辑器。
    loadPrototype({ width: 320 });
    const search = document.querySelector<HTMLInputElement>("[aria-label='搜索会话']");
    search!.value = "周末";
    search?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("[data-session-status]")?.textContent).toContain("搜索");
    document.querySelector<HTMLElement>(".bottom-nav [data-view-target='contacts']")?.click();
    document.querySelector<HTMLElement>("[data-tool='新的朋友']")?.click();
    expect(document.querySelector("[data-contact-status]")?.textContent).toContain("新的朋友");
  });

  it("会话详情触发器同步 ARIA 展开状态并在关闭后收起", () => {
    // 测试目标：验证详情非模态面板和其触发器公开一致的可访问状态。
    // 构造方法：载入原型后点击会话详情按钮，依次检查打开和 Escape 关闭状态。
    // 输入数据：data-detail-trigger 详情按钮与 Escape 键盘事件。
    // 预期行为：触发器有 id/aria-controls，打开为 true，关闭后恢复 false 并归还焦点。
    loadPrototype();
    const trigger = document.querySelector<HTMLElement>("[data-detail-trigger]");
    expect(trigger?.id).not.toBe("");
    expect(trigger?.getAttribute("aria-controls")).toBe("conversation-detail-panel");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    trigger?.click();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("会话详情工具将预览反馈写入聊天状态区", () => {
    // 测试目标：验证 DOM 位于聊天面板外的会话详情浮层仍按聊天工具分配反馈作用域。
    // 构造方法：载入原型，打开会话详情浮层，再点击其中的置顶聊天操作。
    // 输入数据：data-detail-trigger 与 detail-panel 内 data-tool=置顶聊天 的按钮。
    // 预期行为：chat 状态区显示置顶预览提示，session 状态区保持未写入。
    loadPrototype();
    document.querySelector<HTMLElement>("[data-detail-trigger]")?.click();
    document.querySelector<HTMLElement>("[data-detail-panel] [data-tool='置顶聊天']")?.click();
    expect(document.querySelector("[data-chat-status]")?.textContent).toBe("置顶聊天仅作界面预览");
    expect(document.querySelector("[data-session-status]")?.textContent).toBe("");
  });

  it("连续群聊消息只显示一次发送者名而保留两条正文", () => {
    // 测试目标：验证连续群消息减少重复身份信息，同时不丢失消息内容。
    // 构造方法：选择产品讨论组并统计显示“周然”的发送者标签与消息正文。
    // 输入数据：产品讨论组中同一发送者的两条连续左侧消息。
    // 预期行为：发送者标签“周然”仅一处，两条对应文本都保留在消息列表。
    loadPrototype();
    document.querySelector<HTMLElement>("[data-conversation-id='product']")?.click();
    const names = [...document.querySelectorAll(".message-sender")].filter((node) => node.textContent === "周然");
    expect(names).toHaveLength(1);
    expect(document.querySelector("[data-message-list]")?.textContent).toContain("版本说明已更新");
    expect(document.querySelector("[data-message-list]")?.textContent).toContain("截图也放到共享文件夹了");
  });

  it("详情外部点击和账号外部点击关闭时不抢回触发器焦点", () => {
    // 测试目标：验证鼠标式外部关闭不制造意外焦点跳转。
    // 构造方法：分别打开会话详情和账号菜单，再点击聊天身份区域的外部位置。
    // 输入数据：会话详情触发器、账号触发器和 chat-identity 外部点击目标。
    // 预期行为：两个面板关闭，但 activeElement 不被强制改回各自触发器。
    loadPrototype();
    const detail = document.querySelector<HTMLElement>("[data-detail-trigger]");
    const account = document.querySelector<HTMLElement>(".function-rail [aria-label='账号与设置']");
    detail?.click();
    document.querySelector<HTMLElement>(".chat-identity")?.click();
    expect(document.querySelector("[data-detail-panel]")?.hasAttribute("hidden")).toBe(true);
    expect(detail).not.toHaveFocus();
    account?.click();
    document.querySelector<HTMLElement>(".chat-identity")?.click();
    expect(document.querySelector("[data-theme-menu]")?.hasAttribute("hidden")).toBe(true);
    expect(account).not.toHaveFocus();
  });

  it("侧栏设置将反馈写入当前可见的联系人或会话区域", () => {
    // 测试目标：验证不属于具体面板的设置入口不会把提示写进被隐藏的聊天区。
    // 构造方法：分别处于好友和消息视图时点击桌面功能栏的设置图标。
    // 输入数据：data-tool=设置 的功能栏按钮与 messages、contacts 两种 view 状态。
    // 预期行为：好友视图更新联系人状态区，消息视图更新可见会话状态区。
    loadPrototype();
    const settings = document.querySelector<HTMLElement>(".function-rail [data-tool='设置']");
    clickByLabel("好友");
    settings?.click();
    expect(document.querySelector("[data-contact-status]")?.textContent).toBe("设置仅作界面预览");
    clickByLabel("消息");
    settings?.click();
    expect(document.querySelector("[data-session-status]")?.textContent).toBe("设置仅作界面预览");
  });

  it("无效联系人会话关联不导航且不回落到默认聊天", () => {
    // 测试目标：验证联系人资料中的无效会话 ID 不会伪装为可用发消息导航。
    // 构造方法：进入通讯录后把当前资料按钮的 data-enter-chat 临时改为不存在的 ID 并点击。
    // 输入数据：不存在于 conversations 的 conversationId=missing-conversation。
    // 预期行为：仍停留联系人视图与原活动会话，不会切换或回落到林晓聊天。
    loadPrototype();
    clickByLabel("好友");
    const action = document.querySelector<HTMLElement>("[data-enter-chat]");
    action?.setAttribute("data-enter-chat", "missing-conversation");
    action?.click();
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-view")).toBe("contacts");
    expect(document.querySelector("[data-app-shell]")?.getAttribute("data-active-conversation")).toBe("linxiao");
  });
});
