import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const referenceDir = resolve(process.cwd(), "Reference");
const html = () => readFileSync(resolve(referenceDir, "authenticated-preview.html"), "utf8");
const css = () => readFileSync(resolve(referenceDir, "authenticated-preview.css"), "utf8");
const script = () => readFileSync(resolve(referenceDir, "authenticated-preview.js"), "utf8");
const data = () => readFileSync(resolve(referenceDir, "authenticated-preview-data.js"), "utf8");

function cssRule(source: string, selector: string) {
  const uncommented = source.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = uncommented.match(new RegExp(`^[ \\t]*${escapedSelector}[ \\t\\r\\n]*\\{`, "m"));
  const start = match?.index ?? -1;
  return start === -1 ? "" : uncommented.slice(start, uncommented.indexOf("}", start) + 1);
}

function cssProperty(rule: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rule.match(new RegExp(`(?:^|[;{])\\s*${escapedName}\\s*:\\s*([^;}]+)`))?.[1].trim() ?? "";
}

describe("authenticated preview visual contract", () => {
  it("CSS 规则与属性提取忽略注释并接受合法空白", () => {
    // 测试目标：验证 helper 忽略注释伪规则，接受合法花括号空白，并精确提取指定属性值。
    // 构造方法：构造注释伪规则、无空格规则和 selector 后换行的规则，再提取完整规则及 display 属性。
    // 输入数据：闭合/EOF 注释中的复杂 selector、.foo{} 以及换行后声明 display:grid 的 .bar 规则。
    // 预期行为：注释内容不被提取，两种花括号格式均可解析，属性 helper 返回完整的 grid 值。
    const closedComment = `/*
.message-list > :first-child {
  margin-top: 0;
}
*/
.message-list > :first-child { margin-top: auto; }`;
    const unclosedComment = `/* 未闭合注释
.message-list > :first-child { margin-top: 0; }`;
    expect(cssRule(closedComment, ".message-list > :first-child")).toMatch(/margin-top:\s*auto/);
    expect(cssRule(closedComment, ".message-list > :first-child")).not.toMatch(/margin-top:\s*0/);
    expect(cssRule(unclosedComment, ".message-list > :first-child")).toBe("");
    expect(cssRule(".foo{ display: block; }", ".foo")).toMatch(/display:\s*block/);
    const bar = cssRule(".bar\n{ display: grid; }", ".bar");
    expect(bar).toMatch(/display:\s*grid/);
    expect(cssProperty(bar, "display")).toBe("grid");
  });

  it("数据脚本提供冻结的八类会话和联系人信息", () => {
    // 测试目标：验证静态原型将模拟数据与 DOM 行为分离，并覆盖规定的会话状态和类型。
    // 构造方法：读取数据脚本并在隔离 window 中执行，递归遍历公开数据图中的所有对象和数组。
    // 输入数据：authenticated-preview-data.js 中的 sessions、conversations、contacts、contactSections。
    // 预期行为：完整数据图均已冻结，至少八个指定会话包含单聊、群聊、助手及各类状态。
    expect(existsSync(resolve(referenceDir, "authenticated-preview-data.js"))).toBe(true);
    window.eval(data());
    const prototypeData = window.__whisperAuthenticatedPrototypeData;
    const expectDeepFrozen = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(expectDeepFrozen);
    };
    expectDeepFrozen(prototypeData);
    expect(prototypeData.sessions).toHaveLength(8);
    expect(prototypeData.sessions.map((session) => session.name)).toEqual(expect.arrayContaining(["文件传输助手", "林晓", "家庭群", "产品讨论组", "周然", "陈默", "骑行小队", "许言"]));
    expect(prototypeData.sessions.some((session) => session.type === "assistant")).toBe(true);
    expect(prototypeData.sessions.some((session) => session.type === "group")).toBe(true);
    expect(prototypeData.sessions.some((session) => session.pinned)).toBe(true);
    expect(prototypeData.sessions.some((session) => session.muted)).toBe(true);
    expect(prototypeData.sessions.some((session) => session.draft)).toBe(true);
    expect(prototypeData.sessions.some((session) => session.unread)).toBe(true);
    expect(prototypeData.sessions.some((session) => session.mentionsMe)).toBe(true);
    expect(prototypeData.sessions.some((session) => session.pinned && session.muted && session.draft && session.unread && session.mentionsMe)).toBe(false);
    expect(prototypeData.sessions.every((session) => !/[A-Za-z]/.test(session.name))).toBe(true);
  });

  it("HTML 先延迟加载数据再加载应用，并只使用 SVG 图标", () => {
    // 测试目标：验证 file 协议可按依赖顺序取得数据，且界面图标没有字符实体回退。
    // 构造方法：读取页面源码，检查 defer 脚本顺序、内联 symbol sprite 和资源引用。
    // 输入数据：authenticated-preview.html 的 script、svg、link 与 img 标签。
    // 预期行为：data.js 位于 app.js 前，图标使用 use 引用，无外链资源、图片或字符实体图标。
    const source = html();
    expect(source.indexOf("authenticated-preview-data.js")).toBeLessThan(source.indexOf("authenticated-preview.js"));
    expect(source).toMatch(/<svg[^>]*data-icon-sprite/);
    expect(source).toMatch(/<use href="#icon-message"/);
    expect(source).not.toMatch(/&#\d+;/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/<img\b/);
  });

  it("样式公开三栏尺寸、消息和移动端布局契约", () => {
    // 测试目标：验证三栏尺寸由可调整的宽度变量组成，并继续满足消息与移动端密度契约。
    // 构造方法：分别提取桌面 app-shell、中等断点覆盖和移动断点，并读取 JS 初始布局与默认宽度函数。
    // 输入数据：CSS 的 rail/sidebar 变量与变量网格，以及 JS 的初始 layout 和 defaultSidebarWidth 声明。
    // 预期行为：CSS 和 JS 均约定 rail 为56、桌面 sidebar 为280、中等 sidebar 为240，且移动布局行为保持稳定。
    const source = css();
    const scriptSource = script();
    const appShell = cssRule(source, ".app-shell");
    expect(appShell).toMatch(/--rail-width:\s*56px/);
    expect(appShell).toMatch(/--sidebar-width:\s*280px/);
    expect(appShell).toMatch(/grid-template-columns:\s*var\(--rail-width\) var\(--sidebar-width\) minmax\(360px, 1fr\)/);
    const mediumStart = source.indexOf("@media (max-width: 899px) and (min-width: 680px)");
    const mobileStart = source.indexOf("@media (max-width: 679px)");
    const medium = source.slice(mediumStart, mobileStart);
    expect(cssRule(medium, ".app-shell")).toMatch(/--sidebar-width:\s*240px/);
    expect(scriptSource).toMatch(/var layout\s*=\s*\{\s*rail:\s*56,\s*sidebar:\s*window\.innerWidth\s*<\s*900\s*\?\s*240\s*:\s*280,/);
    expect(scriptSource).toMatch(/function defaultSidebarWidth\(\)\s*\{\s*return window\.innerWidth\s*<\s*900\s*\?\s*240\s*:\s*280;\s*\}/);
    expect(cssRule(source, ".session-row")).toMatch(/min-height:\s*68px/);
    expect(cssRule(source, ".session-row .person-avatar")).toMatch(/width:\s*40px/);
    expect(cssRule(source, ".person-avatar")).toMatch(/width:\s*32px/);
    expect(cssRule(source, ".chat-head, .contacts-head")).toMatch(/height:\s*60px/);
    const mobile = source.slice(mobileStart, source.indexOf("@media (prefers-reduced-motion", mobileStart));
    expect(cssRule(mobile, ".chat-panel")).toMatch(/grid-template-rows:\s*60px minmax\(0,\s*1fr\) 140px/);
    expect(cssRule(mobile, ".composer")).toMatch(/height:\s*140px/);
    expect(mobile).toContain('[data-mobile-panel="chat"] .bottom-nav');
    expect(mobile).toMatch(/\[data-mobile-panel="chat"\]\s+\.bottom-nav(?:\s*,[^{}]+)*\s*\{\s*display:\s*none/);
  });

  it("保留 Islands 主题、无渐变、减弱动画和可读对比度 token", () => {
    // 测试目标：验证亮暗主题保持 Islands 风格的可访问颜色基础，并避免超出原型边界的视觉效果。
    // 构造方法：读取 CSS token、焦点样式和 reduced-motion 规则。
    // 输入数据：亮暗主题变量与全局 CSS 声明。
    // 预期行为：存在 Islands surface/text/focus token，禁用 gradient，保留 reduced-motion 与三像素焦点轮廓。
    const source = css();
    expect(source).toContain("--islands-surface");
    expect(source).toContain(":root[data-theme=\"dark\"]");
    expect(source).not.toMatch(/gradient/i);
    expect(source).toMatch(/outline:\s*3px solid var\(--focus\)/);
    expect(source).toContain("prefers-reduced-motion:reduce");
  });

  it("锁定 Islands 核心调色板与品牌蓝的精确值", () => {
    // 测试目标：验证亮暗主题不会漂移出已确认的 Islands 核心色板。
    // 构造方法：读取 CSS 根变量并按主题块提取核心 surface、文字、边界、选中与品牌色。
    // 输入数据：亮色和深色根选择器中的十一个色值 token。
    // 预期行为：核心 token 匹配锁定十六进制值，两种主题品牌色均为 #3871E1。
    const source = css();
    const token = (selector: string, name: string) => source.slice(source.indexOf(selector), source.indexOf("}", source.indexOf(selector))).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toUpperCase();
    expect(token(":root", "--surface-app")).toBe("#E9EAEE");
    expect(token(":root", "--surface-panel")).toBe("#F7F8F9");
    expect(token(":root", "--surface-raised")).toBe("#FFFFFF");
    expect(token(":root", "--text")).toBe("#000000");
    expect(token(":root", "--muted")).toBe("#5F6269");
    expect(token(":root", "--border-strong")).toBe("#D1D3D9");
    expect(token(":root", "--selected")).toBe("#D0DFFE");
    expect(token(':root[data-theme="dark"]', "--surface-app")).toBe("#191A1C");
    expect(token(':root[data-theme="dark"]', "--surface-panel")).toBe("#26282C");
    expect(token(':root[data-theme="dark"]', "--surface-raised")).toBe("#33353B");
    expect(token(':root[data-theme="dark"]', "--text")).toBe("#D1D3D9");
    expect(token(':root[data-theme="dark"]', "--muted")).toBe("#9FA2A8");
    expect(token(':root[data-theme="dark"]', "--border-strong")).toBe("#40434A");
    expect(token(':root[data-theme="dark"]', "--selected")).toBe("#2A4371");
    expect(token(":root", "--brand")).toBe("#3871E1");
    expect(token(':root[data-theme="dark"]', "--brand")).toBe("#3871E1");
  });

  it("编辑器、详情和移动联系人回退遵守可见尺寸与状态契约", () => {
    // 测试目标：验证编辑器不会以 grid 溢出，所有可操作控件和移动返回入口具有稳定触达面积。
    // 构造方法：读取 CSS 的 composer、可点击控件与窄屏 contact-back 选择器规则。
    // 输入数据：140px 编辑器内部网格、36px 操作控件与 contact-detail 媒体规则。
    // 预期行为：编辑器使用三行安全布局，按钮最小36px，contact-back 只在联系人详情状态显示。
    const source = css();
    expect(cssRule(source, ".composer")).toMatch(/grid-template-rows:\s*36px minmax\(0, 1fr\) 36px/);
    expect(cssRule(source, ".message-input textarea")).toMatch(/height:\s*100%[\s\S]*min-height:\s*0/);
    expect(cssRule(source, ".send-button")).toMatch(/min-height:\s*36px/);
    expect(cssRule(source, ".contact-detail button")).toMatch(/min-height:\s*36px/);
    expect(cssRule(source, ".theme-options button, .logout-button")).toMatch(/min-height:\s*36px/);
    expect(source).toMatch(/\[data-mobile-panel="contact-detail"\]\s+\.contact-back\s*\{\s*display:\s*inline-grid/);
    expect(source).toMatch(/\[data-mobile-panel="contacts"\]\s+\.contact-back\s*\{\s*display:\s*none/);
  });

  it("会话列表在低高度移动视口获得受限且可滚动的剩余空间", () => {
    // 测试目标：验证八条会话在 320x667 等低高度窄屏不会被父容器裁切且无法滚动。
    // 构造方法：读取会话面板与会话列表的 CSS 布局规则，检查纵向空间约束和滚动声明。
    // 输入数据：56px 会话头部、20px 固定状态区、68px 会话行与移动断点的单面板布局。
    // 预期行为：父面板建立纵向 grid 或 flex，列表可收缩至剩余空间并启用纵向滚动。
    const source = css();
    const panel = cssRule(source, ".session-panel");
    const list = cssRule(source, ".session-list");
    expect(panel).toMatch(/display:\s*(grid|flex)/);
    expect(panel).toMatch(/grid-template-rows:\s*56px 20px minmax\(0,\s*1fr\)|flex-direction:\s*column/);
    expect(list).toMatch(/min-height:\s*0/);
    expect(list).toMatch(/overflow-y:\s*auto/);
  });

  it("短消息记录从列表顶部排列且长记录保持可滚动", () => {
    // 测试目标：验证短消息从容器顶部开始排列，同时长消息记录仍可纵向滚动访问。
    // 构造方法：读取 message-list 与其首个直接子项的独立 CSS 规则块。
    // 输入数据：消息列表的 flex、overflow、justify-content 和首项 margin-top 声明。
    // 预期行为：列表保持纵向 flex 与自动滚动，不使用 flex-end，首项也不存在 auto 顶部外边距。
    const source = css();
    const list = cssRule(source, ".message-list");
    expect(cssProperty(list, "display")).toBe("flex");
    expect(cssProperty(list, "flex-direction")).toBe("column");
    expect(cssProperty(list, "justify-content")).toBe("flex-start");
    expect(cssProperty(list, "overflow-y")).toBe("auto");
    expect(cssRule(source, ".message-list > :first-child")).toBe("");
  });

  it("全局滚动条在亮暗主题与主流浏览器中使用统一视觉契约", () => {
    // 测试目标：验证所有可滚动区域共享明确的亮暗色 thumb token 和紧凑滚动条外观。
    // 构造方法：提取根主题、标准属性以及 WebKit scrollbar 各伪元素的完整 CSS 规则。
    // 输入数据：亮色 #85888f、深色 #666970、10px WebKit 尺寸及透明轨道和隐藏按钮声明。
    // 预期行为：标准与 WebKit 实现均引用同一 token，轨道区域透明，按钮不显示且不占尺寸。
    const source = css();
    expect(cssRule(source, ":root")).toMatch(/--scrollbar-thumb:\s*#85888f/i);
    expect(cssRule(source, ':root[data-theme="dark"]')).toMatch(/--scrollbar-thumb:\s*#666970/i);
    const global = cssRule(source, "*");
    expect(global).toMatch(/scrollbar-width:\s*thin/);
    expect(global).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent/);
    const scrollbar = cssRule(source, "*::-webkit-scrollbar");
    expect(scrollbar).toMatch(/width:\s*10px/);
    expect(scrollbar).toMatch(/height:\s*10px/);
    expect(scrollbar).toMatch(/background:\s*transparent/);
    const thumb = cssRule(source, "*::-webkit-scrollbar-thumb");
    expect(thumb).toMatch(/background:\s*var\(--scrollbar-thumb\)/);
    expect(thumb).toMatch(/border-radius:\s*999px/);
    const transparentParts = cssRule(source, "*::-webkit-scrollbar-track, *::-webkit-scrollbar-track-piece, *::-webkit-scrollbar-corner");
    expect(transparentParts).toMatch(/background:\s*transparent/);
    const button = cssRule(source, "*::-webkit-scrollbar-button");
    expect(button).toMatch(/display:\s*none/);
    expect(button).toMatch(/width:\s*0/);
    expect(button).toMatch(/height:\s*0/);
  });
});
