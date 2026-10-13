import { useCallback, useMemo, useRef, useState } from "react";

export interface DraftImageBlock {
  type: "image";
  localId: string;
  file: File;
  previewUrl: string;
  attachmentId?: string;
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
  uploadExpiresAt?: string;
  uploaded?: boolean;
}
export interface DraftTextBlock { type: "text"; id: string; text: string }
export type ChatDraftBlock = DraftTextBlock | DraftImageBlock;

const DEFAULT_DRAFT_BLOCKS: ChatDraftBlock[] = [{ type: "text", id: "text-0", text: "" }];
function initialBlocks(): ChatDraftBlock[] { return [{ type: "text", id: "text-0", text: "" }]; }

export function useChatDrafts(activeConversationId: number) {
  const draftsRef = useRef(new Map<number | string, ChatDraftBlock[]>());
  const [version, setVersion] = useState(0);
  const blocks = draftsRef.current.get(activeConversationId) ?? DEFAULT_DRAFT_BLOCKS;
  const activeText = [...blocks].reverse().find((block): block is DraftTextBlock => block.type === "text") ?? { type: "text" as const, id: "text-0", text: "" };

  const setBlocksForConversation = useCallback((conversationId: number | string, next: ChatDraftBlock[]) => {
    const previous = draftsRef.current.get(conversationId) ?? [];
    const retainedImageIds = new Set(next.filter((block): block is DraftImageBlock => block.type === "image").map((image) => image.localId));
    previous.forEach((block) => {
      if (block.type === "image" && !retainedImageIds.has(block.localId)) URL.revokeObjectURL(block.previewUrl);
    });
    draftsRef.current.set(conversationId, next.length ? next : initialBlocks());
    setVersion((current) => current + 1);
  }, []);
  const setBlocks = useCallback((next: ChatDraftBlock[]) => setBlocksForConversation(activeConversationId, next), [activeConversationId, setBlocksForConversation]);
  const setDraft = useCallback((value: string) => {
    const current = draftsRef.current.get(activeConversationId) ?? initialBlocks();
    const lastTextIndex = lastIndexOfText(current);
    const index = lastTextIndex < 0 ? current.length : lastTextIndex;
    const next = [...current];
    if (index === current.length) next.push({ type: "text", id: createId(), text: value });
    else next[index] = { ...(next[index] as DraftTextBlock), text: value };
    setBlocks(next);
  }, [activeConversationId, setBlocks]);
  const createImageBlocks = useCallback((files: File[]) => files.map((file): DraftImageBlock => ({
    type: "image",
    localId: createId(),
    file,
    previewUrl: URL.createObjectURL(file),
  })), []);
  const insertFiles = useCallback((files: File[], caretOffset?: number) => {
    if (files.length === 0) return;
    const current = [...(draftsRef.current.get(activeConversationId) ?? initialBlocks())];
    const lastTextIndex = lastIndexOfText(current);
    const index = lastTextIndex < 0 ? current.length : lastTextIndex;
    const text = current[index]?.type === "text" ? current[index].text : "";
    const offset = Math.max(0, Math.min(caretOffset ?? text.length, text.length));
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    const inserted: ChatDraftBlock[] = [{ type: "text", id: createId(), text: before }];
    inserted.push(...createImageBlocks(files));
    inserted.push({ type: "text", id: createId(), text: after });
    current.splice(index, 1, ...inserted);
    setBlocks(current);
  }, [activeConversationId, createImageBlocks, setBlocks]);
  const removeImage = useCallback((localId: string) => {
    const current = draftsRef.current.get(activeConversationId) ?? initialBlocks();
    setBlocks(current.filter((block) => block.type !== "image" || block.localId !== localId));
  }, [activeConversationId, setBlocks]);
  const clear = useCallback(() => {
    setBlocks(initialBlocks());
  }, [activeConversationId, setBlocks]);
  const draft = blocks.filter((block): block is DraftTextBlock => block.type === "text").map((block) => block.text).join("");
  const getDraft = useCallback((conversationId: number | string) => (draftsRef.current.get(conversationId) ?? [])
    .filter((block): block is DraftTextBlock => block.type === "text").map((block) => block.text).join(""), []);
  const setDraftForConversation = useCallback((conversationId: number | string, value: string) => {
    setBlocksForConversation(conversationId, [{ type: "text", id: createId(), text: value }]);
  }, [setBlocksForConversation]);
  return useMemo(() => ({
    draft: activeText.text,
    canSend: draft.trim().length > 0 || blocks.some((block) => block.type === "image"),
    blocks, version, setDraft, setBlocks, setBlocksForConversation, setDraftForConversation, getDraft, insertFiles, createImageBlocks, removeImage, clear,
  }), [activeText.text, blocks, clear, createImageBlocks, draft, getDraft, insertFiles, removeImage, setBlocks, setBlocksForConversation, setDraft, setDraftForConversation, version]);
}

function createId(): string { return crypto.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`; }
function lastIndexOfText(blocks: ChatDraftBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) if (blocks[index].type === "text") return index;
  return -1;
}
