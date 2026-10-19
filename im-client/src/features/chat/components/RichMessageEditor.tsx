import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";
import { ChatImageNode } from "./ChatImageNode";
import { blocksToDocument, documentToBlocks } from "./richMessageEditorDocument";
import { parseClipboardHtml, type ClipboardContentBlock } from "../clipboardFormat";
import { readChatClipboardHtml } from "../messageClipboardApi";

interface RichMessageEditorProps {
  blocks: ChatDraftBlock[];
  disabled: boolean;
  onChangeBlocks: (blocks: ChatDraftBlock[]) => void;
  onPickFiles: (files: File[]) => DraftImageBlock[];
  onSend: () => void;
  clipboardContextKey?: string;
}

export interface RichMessageEditorHandle {
  insertFiles: (files: File[]) => void;
  insertText: (text: string) => void;
  focus: () => void;
}

const EnterToSend = Extension.create<{ onSend: () => void }>(
  {
    name: "chatComposerBehavior",
    addOptions() {
      return { onSend: () => undefined };
    },
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          if (this.editor.view.composing) return false;
          this.options.onSend();
          return true;
        },
        "Shift-Enter": () => this.editor.commands.setHardBreak(),
      };
    },
  },
);

export const RichMessageEditor = forwardRef<RichMessageEditorHandle, RichMessageEditorProps>(function RichMessageEditor(
  { blocks, disabled, onChangeBlocks, onPickFiles, onSend, clipboardContextKey = "" },
  forwardedRef,
) {
  const blocksRef = useRef(blocks);
  const onChangeBlocksRef = useRef(onChangeBlocks);
  const onPickFilesRef = useRef(onPickFiles);
  const onSendRef = useRef(onSend);
  const pendingImagesRef = useRef(new Map<string, DraftImageBlock>());
  const lastEditorUpdateJSONRef = useRef<string | null>(null);
  const contextRef = useRef(clipboardContextKey);
  const disabledRef = useRef(disabled);
  const pasteGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const [pasteError, setPasteError] = useState("");
  contextRef.current = clipboardContextKey;
  disabledRef.current = disabled;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; pasteGenerationRef.current += 1; }; }, []);
  useEffect(() => { pasteGenerationRef.current += 1; setPasteError(""); }, [clipboardContextKey]);
  blocksRef.current = blocks;
  onChangeBlocksRef.current = onChangeBlocks;
  onPickFilesRef.current = onPickFiles;
  onSendRef.current = onSend;
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const extensions = useMemo(() => [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Placeholder.configure({ placeholder: "输入消息" }),
    ChatImageNode,
    EnterToSend.configure({ onSend: () => onSendRef.current() }),
  ], []);
  const editor = useEditor({
    extensions,
    content: blocksToDocument(blocks),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: "textbox", "aria-label": "输入消息", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => event.key === "Enter" && !event.shiftKey && event.isComposing,
      handlePaste: (_view, event) => {
        if (disabledRef.current) return true;
        setPasteError("");
        const generation = ++pasteGenerationRef.current;
        const context = contextRef.current;
        const state = _view.state;
        const html = event.clipboardData?.getData("text/html") ?? "";
        const plain = event.clipboardData?.getData("text/plain") ?? "";
        const imageFiles = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        const files = imageFiles.length > 0 ? imageFiles : Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        const apply = (content: ClipboardContentBlock[]) => {
          const current = editorRef.current;
          if (!current || current.isDestroyed || !mountedRef.current || disabledRef.current || contextRef.current !== context
            || pasteGenerationRef.current !== generation || current.state !== state) return;
          const imageFiles = content.filter((block): block is Extract<ClipboardContentBlock, { type: "image" }> => block.type === "image").map((block) => block.file);
          const images = imageFiles.length ? onPickFilesRef.current(imageFiles) : [];
          if (images.length !== imageFiles.length) return;
          images.forEach((image) => pendingImagesRef.current.set(image.localId, image));
          let index = 0;
          const inserted: ChatDraftBlock[] = content.map((block) => block.type === "text"
            ? { type: "text", id: crypto.randomUUID(), text: block.text } : images[index++]);
          const nodes = blocksToDocument(inserted).content?.[0]?.content ?? [];
          if (nodes.length) current.commands.insertContentAt({ from: state.selection.from, to: state.selection.to }, nodes);
        };
        const fallback = () => apply(files.length ? files.map((file) => ({ type: "image" as const, file })) : [{ type: "text", text: plain }]);
        const parse = (value: string) => {
          try { apply(parseClipboardHtml(value)); }
          catch { if (mountedRef.current && contextRef.current === context && pasteGenerationRef.current === generation) setPasteError("粘贴失败，请重试"); }
        };
        if (html) { event.preventDefault(); parse(html); return true; }
        if (isTauri()) {
          // Prevent synchronously; otherwise WebView pastes once before the native fallback resolves.
          event.preventDefault();
          void readChatClipboardHtml().then((value) => { if (value) parse(value); else fallback(); }).catch((error: unknown) => {
            const code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
            if (code === "clipboard_content_too_large") {
              if (mountedRef.current && contextRef.current === context && pasteGenerationRef.current === generation) setPasteError("粘贴内容过大");
            } else fallback();
          });
          return true;
        }
        if (!files.length) return false;
        event.preventDefault(); fallback(); return true;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      lastEditorUpdateJSONRef.current = JSON.stringify(updatedEditor.getJSON());
      onChangeBlocksRef.current(documentToBlocks(updatedEditor.getJSON(), blocksRef.current, [...pendingImagesRef.current.values()]));
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    const activeIds = new Set(blocks.filter((block): block is DraftImageBlock => block.type === "image").map((image) => image.localId));
    for (const [localId, image] of pendingImagesRef.current) {
      if (activeIds.has(localId)) pendingImagesRef.current.delete(localId);
      else URL.revokeObjectURL(image.previewUrl);
    }
    if (!editor) return;
    const nextDocument = blocksToDocument(blocks);
    const nextJSON = JSON.stringify(nextDocument);
    const currentJSON = JSON.stringify(editor.getJSON());
    if (currentJSON === nextJSON) {
      lastEditorUpdateJSONRef.current = null;
    } else if (lastEditorUpdateJSONRef.current !== currentJSON) {
      editor.commands.setContent(nextDocument, { emitUpdate: false });
      lastEditorUpdateJSONRef.current = null;
    }
  }, [blocks, editor]);

  useEffect(() => {
    if (editor && editor.isEditable !== !disabled) editor.setEditable(!disabled);
  }, [disabled, editor]);

  const insertFiles = (files: File[]) => {
    if (!editor || files.length === 0) return;
    const images = onPickFilesRef.current(files);
    images.forEach((image) => pendingImagesRef.current.set(image.localId, image));
    insertImagesAtSelection(editor, images, true);
  };

  const insertText = (text: string) => {
    if (!editor || !editor.isEditable || !text) return;
    editor.chain().focus().insertContent(text).run();
  };

  useImperativeHandle(forwardedRef, () => ({
    insertFiles,
    insertText,
    focus: () => editor?.commands.focus(),
  }), [editor, onPickFiles]);

  return (
    <div className="auth-message-input" onClick={() => editor?.commands.focus()}>
      <EditorContent editor={editor} />
      {pasteError ? <output aria-live="polite">{pasteError}</output> : null}
    </div>
  );
});

function insertImagesAtSelection(editor: NonNullable<ReturnType<typeof useEditor>>, images: DraftImageBlock[], focus: boolean) {
  if (images.length === 0) return;
  if (focus) editor.commands.focus();
  const { from, to } = editor.state.selection;
  const nodes = images.map((image) => ({
    type: "chatImage",
    attrs: { localId: image.localId, previewUrl: image.previewUrl, fileName: image.file.name },
  }));
  editor.chain()
    .insertContentAt({ from, to }, nodes)
    .setTextSelection(from + nodes.length)
    .run();
}
