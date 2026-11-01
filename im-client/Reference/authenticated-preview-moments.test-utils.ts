import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, within } from "@testing-library/react";

const referenceDir = resolve(process.cwd(), "Reference");
export const appScript = () => readFileSync(resolve(referenceDir, "authenticated-preview.js"), "utf8");
const descriptors = new Map([
  ["Image", Object.getOwnPropertyDescriptor(window, "Image")],
  ["matchMedia", Object.getOwnPropertyDescriptor(window, "matchMedia")],
  ["confirm", Object.getOwnPropertyDescriptor(window, "confirm")],
]);
const urlDescriptors = new Map([
  ["createObjectURL", Object.getOwnPropertyDescriptor(URL, "createObjectURL")],
  ["revokeObjectURL", Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")],
]);
type ImageProbe = { onload: (() => void) | null; onerror: (() => void) | null; src: string };
export let images: ImageProbe[] = [];
export let createUrl: ReturnType<typeof vi.fn>;
export let revokeUrl: ReturnType<typeof vi.fn>;

export function load(width = 1120) {
  document.open();
  document.write(readFileSync(resolve(referenceDir, "authenticated-preview.html"), "utf8"));
  document.close();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
  images = [];
  Object.defineProperty(window, "Image", { configurable: true, value: class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    constructor() { images.push(this); }
  } });
  createUrl = vi.fn((_file: Blob) => `blob:moment-${createUrl.mock.calls.length}`);
  revokeUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
  window.localStorage.clear();
  for (const tag of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    window.eval(readFileSync(resolve(referenceDir, tag.getAttribute("src")!), "utf8"));
  }
  return document.querySelector<HTMLElement>("[data-moments-root]")!;
}

export function nav(view: string, mobile = false) {
  const button = document.querySelector<HTMLButtonElement>(`${mobile ? ".bottom-nav" : ".function-rail"} [data-view-target='${view}']`);
  expect(button, `应存在 ${view} 导航入口`).not.toBeNull();
  fireEvent.click(button!);
  return button!;
}

export function enter(width = 1120) {
  const root = load(width);
  nav("moments", width < 680);
  return root;
}

export function button(name: string, root: HTMLElement = document.body) {
  return within(root).getByRole("button", { name, exact: true });
}

export function openComposer(root: HTMLElement) {
  fireEvent.click(button("发布动态", root));
  return within(root).getByRole("dialog", { name: /发布/ });
}

export function inputText(name: string, value: string, root: HTMLElement = document.body) {
  const input = within(root).getByLabelText(name);
  input.focus();
  fireEvent.input(input, { target: { value } });
}

export function cards(root: HTMLElement) { return [...root.querySelectorAll<HTMLElement>("[data-moment-id]")]; }

export function reader(root: HTMLElement) { return root.querySelector<HTMLElement>("[data-moments-reader]")!; }

export function readComments(root: HTMLElement, card: HTMLElement = cards(root)[0]) {
  fireEvent.click(button("评论", card));
  expect(reader(root), "评论入口应进入阅读页").not.toBeNull();
  return reader(root);
}

export function selectImage(dialog: HTMLElement, name = "周末.png", type = "image/png") {
  fireEvent.change(within(dialog).getByLabelText("选择动态图片"), { target: { files: [new File(["picture"], name, { type })] } });
}

export async function finishImage(index = images.length - 1, success = true) {
  const probe = images[index];
  expect(probe, "选择图片后应验证其实际可解码性").toBeDefined();
  if (success) probe.onload?.(); else probe.onerror?.();
  await Promise.resolve();
  await Promise.resolve();
}

export function cleanupPrototype() {
  window.__whisperAuthenticatedPrototype?.destroy();
  delete window.__whisperAuthenticatedPrototype;
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else delete (window as unknown as Record<string, unknown>)[name];
  }
  for (const [name, descriptor] of urlDescriptors) {
    if (descriptor) Object.defineProperty(URL, name, descriptor);
    else delete (URL as unknown as Record<string, unknown>)[name];
  }
  vi.restoreAllMocks();
}

