import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

function InlineImageView({ node, deleteNode }: NodeViewProps) {
  const { localId, previewUrl, fileName } = node.attrs as { localId: string; previewUrl: string; fileName: string };
  return (
    <NodeViewWrapper as="span" className="auth-editor-image" contentEditable={false}>
      <img src={previewUrl} alt={fileName} />
      <button
        type="button"
        aria-label={`移除图片 ${fileName}`}
        title="移除图片"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => deleteNode()}
        data-image-id={localId}
      >×</button>
    </NodeViewWrapper>
  );
}

export const ChatImageNode = Node.create({
  name: "chatImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      localId: { default: null },
      previewUrl: { default: "" },
      fileName: { default: "图片" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-chat-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-chat-image": "true" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineImageView);
  },
});
