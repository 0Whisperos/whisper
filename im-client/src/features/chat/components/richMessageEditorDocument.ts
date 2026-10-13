import type { JSONContent } from "@tiptap/core";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";

function textNodes(text: string): JSONContent[] {
  const parts = text.split("\n");
  const nodes: JSONContent[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    if (part) nodes.push({ type: "text", text: part });
  });
  return nodes;
}

export function blocksToDocument(blocks: ChatDraftBlock[]): JSONContent {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    if (block.type === "text") content.push(...textNodes(block.text));
    else content.push({ type: "chatImage", attrs: { localId: block.localId, previewUrl: block.previewUrl, fileName: block.file.name } });
  }
  return { type: "doc", content: [content.length ? { type: "paragraph", content } : { type: "paragraph" }] };
}

export function documentToBlocks(document: JSONContent, existing: ChatDraftBlock[], pendingImages: DraftImageBlock[]): ChatDraftBlock[] {
  const imageById = new Map([...existing, ...pendingImages]
    .filter((block): block is DraftImageBlock => block.type === "image")
    .map((image) => [image.localId, image]));
  const result: ChatDraftBlock[] = [];
  let text = "";
  const flushText = () => {
    if (!text) return;
    result.push({ type: "text", id: createDraftId(), text });
    text = "";
  };
  const appendNode = (node: JSONContent) => {
    if (node.type === "text") text += node.text ?? "";
    else if (node.type === "hardBreak") text += "\n";
    else if (node.type === "chatImage") {
      const attrs = node.attrs as { localId?: string; previewUrl?: string } | undefined;
      const image = attrs?.localId ? imageById.get(attrs.localId) : undefined;
      if (image) {
        flushText();
        result.push({ ...image, previewUrl: attrs?.previewUrl || image.previewUrl });
      }
    }
  };
  const paragraphs = document.content ?? [];
  paragraphs.forEach((paragraph, index) => {
    for (const node of paragraph.content ?? []) appendNode(node);
    if (index < paragraphs.length - 1) text += "\n";
  });
  flushText();
  return result.length > 0 ? result : [{ type: "text", id: createDraftId(), text: "" }];
}

function createDraftId(): string {
  return crypto.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`;
}
