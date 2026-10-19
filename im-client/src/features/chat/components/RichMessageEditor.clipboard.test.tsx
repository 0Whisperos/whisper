import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";

const { nativeHtml, desktop } = vi.hoisted(() => ({ nativeHtml: vi.fn(), desktop: vi.fn(() => false) }));
vi.mock("../messageClipboardApi", () => ({ readChatClipboardHtml: nativeHtml }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: desktop }));
import { RichMessageEditor, type RichMessageEditorHandle } from "./RichMessageEditor";

function fixture(context = "a") {
  const onChangeBlocks = vi.fn();
  const onPickFiles = vi.fn((files: File[]) => files.map((file, index): DraftImageBlock => ({ type: "image", localId: `image-${index}`, file, previewUrl: `blob:${index}` })));
  const props = { blocks: [{ type: "text", id: "empty", text: "" }] as ChatDraftBlock[], disabled: false, onChangeBlocks, onPickFiles, onSend: vi.fn(), clipboardContextKey: context };
  return { ...render(<RichMessageEditor {...props} />), props, onChangeBlocks, onPickFiles };
}
function paste(html: string, plain = "", files: File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/html" ? html : type === "text/plain" ? plain : "", items: [], files, types: html ? ["text/html", "text/plain"] : ["text/plain"] } });
  fireEvent(screen.getByRole("textbox", { name: "输入消息" }), event);
  return event;
}

function setCaret(editor: HTMLElement, offset: number) {
  const text = editor.querySelector("p")?.firstChild;
  if (!(text instanceof Text)) throw new Error("编辑器中未找到文字节点");
  const selection = window.getSelection();
  if (!selection) throw new Error("当前环境不支持文本选区");
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("rich editor clipboard", () => {
  beforeEach(() => { desktop.mockReturnValue(false); nativeHtml.mockReset(); });
  afterEach(cleanup);

  it("restores interleaved HTML at the caret and prefers HTML over duplicate files", async () => {
    // 测试目标：混排图文粘贴在光标处保持顺序，不重复插入 files 中的图片。
    // 构造方法：输入前后在当前光标粘贴自有 HTML，并同时提供图片 file。
    // 输入数据：文字前、HTML 的中图尾和 duplicate.png。
    // 预期行为：草稿为前中、图片、尾；只校验 HTML 的一张图片。
    const { onChangeBlocks, onPickFiles } = fixture();
    await userEvent.type(screen.getByRole("textbox"), "前");
    expect(paste('<div data-whisper-message-version="1"><p data-whisper-block="text">中</p><img data-whisper-block="image" src="data:image/png;base64,AQID"><p data-whisper-block="text">尾</p></div>', "fallback", [new File(["duplicate"], "duplicate.png", { type: "image/png" })]).defaultPrevented).toBe(true);
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([expect.objectContaining({ type: "text", text: "前中" }), expect.objectContaining({ type: "image" }), expect.objectContaining({ type: "text", text: "尾" })]));
    expect(onPickFiles).toHaveBeenCalledTimes(1); expect(onPickFiles.mock.calls[0][0][0].name).toBe("pasted-1.png");
  });

  it.each([false, true])("pastes plain HTML source literally with desktop=%s", async (isDesktop) => {
    // 测试目标：text/plain 的 HTML 源码绝不通过 HTML 解析器。
    // 构造方法：在浏览器和桌面 runtime 聚焦编辑器后派发仅有纯文字的源码 paste。
    // 输入数据：<div><img src="data:image/png;base64,AQID"></div>，原生 HTML 返回 null。
    // 预期行为：完整源码成为文字，无图片和文件校验，桌面仅读取一次显式 fallback。
    desktop.mockReturnValue(isDesktop); nativeHtml.mockResolvedValue(null);
    const { onChangeBlocks, onPickFiles } = fixture(); await userEvent.click(screen.getByRole("textbox"));
    const source = '<div><img src="data:image/png;base64,AQID"></div>';
    paste("", source);
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([expect.objectContaining({ type: "text", text: source })]));
    expect(onPickFiles).not.toHaveBeenCalled(); expect(nativeHtml).toHaveBeenCalledTimes(isDesktop ? 1 : 0);
  });

  it("pastes escaped source from HTML code blocks as visible text", async () => {
    // 测试目标：HTML 代码块里的实体转义源码不进行第二次解析。
    // 构造方法：粘贴 pre/code 的转义 img 源码。
    // 输入数据：&lt;img src=x&gt;。
    // 预期行为：编辑器内为 <img src=x> 文字且无图片块。
    const { onChangeBlocks, onPickFiles } = fixture();
    paste("<pre><code>&lt;img src=x&gt;</code></pre>");
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([expect.objectContaining({ type: "text", text: "<img src=x>" })]));
    expect(onPickFiles).not.toHaveBeenCalled();
  });

  it("inserts a multi-code-point emoji sequence intact at the saved editor selection", async () => {
    // 测试目标：验证肤色修饰与 ZWJ 组成的表情序列会作为完整文本插入，且焦点回到编辑器。
    // 构造方法：在“前后”之间放置选区，调用编辑器公开的 insertText 方法。
    // 输入数据：序列“👨🏽‍💻👨‍👩‍👧‍👦”。
    // 预期行为：草稿文本精确保留完整序列并位于前后文字之间，编辑器获得焦点。
    const user = userEvent.setup();
    const onChangeBlocks = vi.fn();
    const editorRef = createRef<RichMessageEditorHandle>();
    render(<RichMessageEditor ref={editorRef} blocks={[{ type: "text", id: "text", text: "前后" }]}
      disabled={false} onChangeBlocks={onChangeBlocks} onPickFiles={() => []} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });
    await user.click(editor);
    act(() => setCaret(editor, 1));

    act(() => editorRef.current?.insertText("👨🏽‍💻👨‍👩‍👧‍👦"));

    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "text", text: "前👨🏽‍💻👨‍👩‍👧‍👦后" }),
    ]));
    expect(editor).toHaveFocus();
  });

  it("prevents default synchronously and discards a native fallback after switching context", async () => {
    // 测试目标：异步原生读取不会在默认粘贴后重复插入或污染新会话。
    // 构造方法：让读取 pending，paste 后切换 context，再完成 HTML 读取。
    // 输入数据：旧会话 a 到 b、原生 <p>旧文字</p>。
    // 预期行为：事件立即被阻止，新会话不出现旧文字或草稿更新。
    desktop.mockReturnValue(true); let finish!: (value: string) => void;
    nativeHtml.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { props, rerender, onChangeBlocks } = fixture();
    expect(paste("", "旧fallback").defaultPrevented).toBe(true);
    rerender(<RichMessageEditor {...props} clipboardContextKey="b" />);
    finish("<p>旧文字</p>");
    await waitFor(() => expect(nativeHtml).toHaveBeenCalledOnce());
    expect(onChangeBlocks).not.toHaveBeenCalled(); expect(screen.getByRole("textbox")).not.toHaveTextContent("旧");
  });

  it("uses native HTML when missing from the event and abandons stale selection results", async () => {
    // 测试目标：原生 fallback 可恢复图文且选区变化会使旧读取结果失效。
    // 构造方法：先立即返回 HTML 进行粘贴，再暂停第二次读取并继续输入文字。
    // 输入数据：原生 <p>原生</p>、第二次待返回 <p>过期</p> 和用户输入 新。
    // 预期行为：原生首次成功，第二次不覆盖用户后续编辑。
    desktop.mockReturnValue(true); nativeHtml.mockResolvedValueOnce("<p>原生</p>");
    const { onChangeBlocks } = fixture();
    paste("", "fallback");
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([expect.objectContaining({ text: "原生" })]));
    let finish!: (value: string) => void;
    nativeHtml.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    paste("", "fallback"); await userEvent.type(screen.getByRole("textbox"), "新");
    finish("<p>过期</p>");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("新"));
    expect(screen.getByRole("textbox")).not.toHaveTextContent("过期");
  });
});
