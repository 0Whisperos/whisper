import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
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

interface RichMessageEditorProps {
  blocks: ChatDraftBlock[];
  disabled: boolean;
  onChangeBlocks: (blocks: ChatDraftBlock[]) => void;
  onPickFiles: (files: File[]) => DraftImageBlock[];
  onSend: () => void;
}

export interface RichMessageEditorHandle {
  insertFiles: (files: File[]) => void;
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
  { blocks, disabled, onChangeBlocks, onPickFiles, onSend },
  forwardedRef,
) {
  const blocksRef = useRef(blocks);
  const onChangeBlocksRef = useRef(onChangeBlocks);
  const onPickFilesRef = useRef(onPickFiles);
  const onSendRef = useRef(onSend);
  const pendingImagesRef = useRef(new Map<string, DraftImageBlock>());
  const lastEditorUpdateJSONRef = useRef<string | null>(null);
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
        const imageFiles = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        const files = imageFiles.length > 0 ? imageFiles : Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        const images = onPickFilesRef.current(files);
        images.forEach((image) => pendingImagesRef.current.set(image.localId, image));
        if (editorRef.current) insertImagesAtSelection(editorRef.current, images, false);
        return true;
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

  useImperativeHandle(forwardedRef, () => ({
    insertFiles,
    focus: () => editor?.commands.focus(),
  }), [editor, onPickFiles]);

  return (
    <div className="auth-message-input" onClick={() => editor?.commands.focus()}>
      <EditorContent editor={editor} />
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
