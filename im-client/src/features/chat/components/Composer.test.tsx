import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { DraftImageBlock } from "../hooks/useChatDrafts";

function makeImage(file = new File(["png"], "photo.png", { type: "image/png" })): DraftImageBlock {
  return { type: "image", localId: "photo-id", file, previewUrl: "blob:photo" };
}

function setCaret(editor: HTMLElement, offset: number, textNodeIndex = 0) {
  const textNodes = Array.from(editor.querySelector("p")?.childNodes ?? []).filter((node): node is Text => node instanceof Text);
  const text = textNodes[textNodeIndex];
  if (!(text instanceof Text)) throw new Error("编辑器中未找到文字节点");
  act(() => {
    const selection = window.getSelection();
    if (!selection) throw new Error("当前环境不支持文本选区");
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function StatefulComposer({ initialBlocks, onSendText }: { initialBlocks: Array<{ type: "text"; id: string; text: string } | DraftImageBlock>; onSendText: (text: string) => void }) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const draft = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  const canSend = Boolean(draft.trim()) || blocks.some((block) => block.type === "image");
  return <Composer draft={draft} canSend={canSend} statusMessage="" onToolPreview={vi.fn()} onSendText={onSendText}
    blocks={blocks} onChangeBlocks={setBlocks} onPickFiles={vi.fn(() => [])} />;
}

describe("Composer rich editor", () => {
  it("renders text and image nodes inline without a separate preview strip", async () => {
    // 测试目标：验证草稿文字和图片直接按顺序显示在同一个富文本输入区。
    // 构造方法：渲染包含前置文字、图片和后置文字的草稿 blocks。
    // 输入数据：文字“前”“后”和 photo.png 图片块。
    // 预期行为：图片位于输入编辑器内部，前后文字均可见，且不渲染独立预览栏。
    render(<Composer draft="后" canSend statusMessage="" onToolPreview={vi.fn()} onSendText={vi.fn()}
      blocks={[{ type: "text", id: "before", text: "前" }, makeImage(), { type: "text", id: "after", text: "后" }]}
      onChangeBlocks={vi.fn()} onPickFiles={vi.fn(() => [])} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });
    expect(editor).toContainElement(await screen.findByRole("img", { name: "photo.png" }));
    expect(editor).toHaveTextContent("前");
    expect(editor).toHaveTextContent("后");
    expect(document.querySelector(".auth-composer-inline-blocks")).not.toBeInTheDocument();
  });

  it("inserts a selected emoji at the editor caret and sends it through the normal text action", async () => {
    // 测试目标：验证选中 Unicode 表情后插入当前光标位置，且仍由用户主动触发普通文本发送。
    // 构造方法：将光标放在“ab”的中间，打开选择器并选择“😀”，再点击发送按钮。
    // 输入数据：草稿“ab”和表情“😀”。
    // 预期行为：草稿变为“a😀b”，选择表情时不发送，发送按钮收到完整文本且编辑器恢复焦点。
    const user = userEvent.setup();
    const onSendText = vi.fn();
    render(<StatefulComposer initialBlocks={[{ type: "text", id: "text", text: "ab" }]} onSendText={onSendText} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });

    await user.click(editor);
    setCaret(editor, 1);
    await user.click(screen.getByRole("button", { name: "表情" }));
    const emoji = await waitFor(() => {
      const result = document.querySelector<HTMLElement>('[role="gridcell"][data-epr-unified="1f600"]');
      if (!result) throw new Error("未找到 😀 表情格");
      return result;
    });
    await user.click(emoji);

    await waitFor(() => expect(editor).toHaveTextContent("a😀b"));
    expect(onSendText).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSendText).toHaveBeenCalledWith("a😀b");
  });

  it("sends a selected emoji with Enter through the normal text action", async () => {
    // 测试目标：验证插入 Unicode 表情后按 Enter 会走现有文本发送回调。
    // 构造方法：将光标放在“a”末尾，选中“😀”，再在编辑器聚焦时按 Enter。
    // 输入数据：“a”加表情“😀”。
    // 预期行为：只发送一次，回调收到完整文本“a😀”。
    const user = userEvent.setup();
    const onSendText = vi.fn();
    render(<StatefulComposer initialBlocks={[{ type: "text", id: "text", text: "a" }]} onSendText={onSendText} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });

    await user.click(editor);
    setCaret(editor, 1);
    await user.click(screen.getByRole("button", { name: "表情" }));
    const emoji = await waitFor(() => {
      const result = document.querySelector<HTMLElement>('[role="gridcell"][data-epr-unified="1f600"]');
      if (!result) throw new Error("未找到 😀 表情格");
      return result;
    });
    await user.click(emoji);
    expect(editor).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onSendText).toHaveBeenCalledOnce();
    expect(onSendText).toHaveBeenCalledWith("a😀");
  });

  it("keeps emoji insertion in the text block after an inline image", async () => {
    // 测试目标：验证含图片的富文本草稿在图片后的文字块插入表情时仍保持块顺序。
    // 构造方法：渲染“前文、图片、后文”的草稿，将光标移至末尾并从选择器添加表情。
    // 输入数据：前文“前”、photo.png、后文“后”和表情“😀”。
    // 预期行为：onChangeBlocks 仍按文本、图片、文本顺序返回，末尾文字为“后😀”。
    const user = userEvent.setup();
    const image = makeImage();
    const onChangeBlocks = vi.fn();
    render(<Composer draft="前后" canSend statusMessage="" onToolPreview={vi.fn()} onSendText={vi.fn()}
      blocks={[{ type: "text", id: "before", text: "前" }, image, { type: "text", id: "after", text: "后" }]}
      onChangeBlocks={onChangeBlocks} onPickFiles={vi.fn(() => [])} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });

    await user.click(editor);
    setCaret(editor, 1, 1);
    await user.click(screen.getByRole("button", { name: "表情" }));
    const emoji = await waitFor(() => {
      const result = document.querySelector<HTMLElement>('[role="gridcell"][data-epr-unified="1f600"]');
      if (!result) throw new Error("未找到 😀 表情格");
      return result;
    });
    await user.click(emoji);

    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "text", text: "前" }),
      expect.objectContaining({ type: "image", localId: image.localId }),
      expect.objectContaining({ type: "text", text: "后😀" }),
    ]));
  });

  it("inserts pasted images at the caret and serializes surrounding text in clipboard order", async () => {
    // 测试目标：验证剪贴板图片插入到当前选区，并将文字与图片按编辑顺序回写草稿。
    // 构造方法：在编辑器输入“前”，于当前光标粘贴两张 PNG，再继续输入“后”。
    // 输入数据：剪贴板文件 pasted-1.png、pasted-2.png，先后输入文字“前”“后”。
    // 预期行为：两图按剪贴板顺序位于“前”和“后”之间，onChangeBlocks 回传相同顺序。
    const user = userEvent.setup();
    const images = [
      makeImage(new File(["png-1"], "pasted-1.png", { type: "image/png" })),
      { ...makeImage(new File(["png-2"], "pasted-2.png", { type: "image/png" })), localId: "photo-id-2", previewUrl: "blob:photo-2" },
    ];
    const onPickFiles = vi.fn(() => images);
    const onChangeBlocks = vi.fn();
    render(<Composer draft="" canSend statusMessage="" onToolPreview={vi.fn()} onSendText={vi.fn()}
      blocks={[{ type: "text", id: "empty", text: "" }]} onChangeBlocks={onChangeBlocks} onPickFiles={onPickFiles} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(editor, "前");
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: {
      items: images.map((image) => ({ kind: "file", type: "image/png", getAsFile: () => image.file })),
      files: images.map((image) => image.file),
      types: ["Files"],
      getData: () => "",
    } });
    fireEvent(editor, pasteEvent);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onPickFiles).toHaveBeenCalledWith(images.map((image) => image.file));
    await user.keyboard("后");
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "text", text: "前" }),
      expect.objectContaining({ type: "image", localId: images[0].localId }),
      expect.objectContaining({ type: "image", localId: images[1].localId }),
      expect.objectContaining({ type: "text", text: "后" }),
    ]));
    const previewImages = editor.querySelectorAll(".auth-editor-image img");
    expect(previewImages).toHaveLength(2);
    expect(previewImages[0]).toHaveAttribute("alt", "pasted-1.png");
    expect(previewImages[1]).toHaveAttribute("alt", "pasted-2.png");
  });

  it("inserts selected files at the editor selection and clears the picker for re-use", async () => {
    // 测试目标：验证文件选择入口把图片插入编辑器当前选区，并允许重复选择同一文件。
    // 构造方法：在文字末尾打开图片选择器，上传一张 PNG。
    // 输入数据：编辑器文字“消息”和文件 photo.png。
    // 预期行为：onPickFiles 收到所选文件，图片内联显示，文件控件值清空。
    const user = userEvent.setup();
    const file = new File(["png"], "photo.png", { type: "image/png" });
    const onPickFiles = vi.fn(() => [makeImage(file)]);
    render(<Composer draft="" canSend statusMessage="" onToolPreview={vi.fn()} onSendText={vi.fn()}
      blocks={[{ type: "text", id: "empty", text: "" }]} onChangeBlocks={vi.fn()} onPickFiles={onPickFiles} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(editor, "消息");
    await user.click(screen.getByRole("button", { name: "发送图片" }));
    const picker = screen.getByLabelText("选择图片") as HTMLInputElement;
    await user.upload(picker, file);
    expect(onPickFiles).toHaveBeenCalledWith([file]);
    expect(picker.files).toHaveLength(0);
    expect(await screen.findByRole("img", { name: "photo.png" })).toBeInTheDocument();
  });

  it("keeps plain text paste and Shift+Enter while Enter sends", async () => {
    // 测试目标：验证普通文字仍可粘贴，Shift+Enter 插入换行，Enter 发送消息。
    // 构造方法：渲染空编辑器，先派发纯文本 paste，再分别按 Shift+Enter 和 Enter。
    // 输入数据：剪贴板“你好”、Shift+Enter、Enter。
    // 预期行为：普通粘贴不被图片处理拦截，Shift+Enter 不发送，Enter 恰好发送一次。
    const user = userEvent.setup();
    const onSendText = vi.fn();
    const onChangeBlocks = vi.fn();
    const onPickFiles = vi.fn(() => []);
    render(<Composer draft="你好" canSend statusMessage="" onToolPreview={vi.fn()} onSendText={onSendText}
      blocks={[{ type: "text", id: "text", text: "你好" }]} onChangeBlocks={onChangeBlocks} onPickFiles={onPickFiles} />);
    const editor = screen.getByRole("textbox", { name: "输入消息" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: { items: [], files: [], types: ["text/plain"], getData: () => "补充文字" } });
    fireEvent(editor, pasteEvent);
    expect(onPickFiles).not.toHaveBeenCalled();
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "text", text: expect.stringContaining("补充文字") }),
    ]));
    await user.click(editor);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSendText).not.toHaveBeenCalled();
    await waitFor(() => expect(onChangeBlocks).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "text", text: expect.stringContaining("\n") }),
    ]));
    await user.keyboard("{Enter}");
    expect(onSendText).toHaveBeenCalledTimes(1);
  });
});
