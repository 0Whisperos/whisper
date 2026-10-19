import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatReplyTarget } from "../types";

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

export interface ChatDraftSnapshot {
  conversationId: number | string;
  blocks: ChatDraftBlock[];
  replyTo: ChatReplyTarget | null;
  bodyVersion: number;
  replyVersion: number;
}

const DEFAULT_DRAFT_BLOCKS: ChatDraftBlock[] = [{ type: "text", id: "text-0", text: "" }];
function initialBlocks(): ChatDraftBlock[] { return [{ type: "text", id: "text-0", text: "" }]; }

export function useChatDrafts(activeConversationId: number) {
  const draftsRef = useRef(new Map<number | string, ChatDraftBlock[]>());
  const repliesRef = useRef(new Map<number | string, ChatReplyTarget | null>());
  const bodyVersionsRef = useRef(new Map<number | string, number>());
  const replyVersionsRef = useRef(new Map<number | string, number>());
  const [version, setVersion] = useState(0);
  useEffect(() => () => {
    draftsRef.current.forEach((draft) => draft.forEach((block) => {
      if (block.type === "image") URL.revokeObjectURL?.(block.previewUrl);
    }));
  }, []);
  const blocks = draftsRef.current.get(activeConversationId) ?? DEFAULT_DRAFT_BLOCKS;
  const activeText = [...blocks].reverse().find((block): block is DraftTextBlock => block.type === "text") ?? { type: "text" as const, id: "text-0", text: "" };

  const setBlocksForConversation = useCallback((conversationId: number | string, next: ChatDraftBlock[]) => {
    const previous = draftsRef.current.get(conversationId) ?? [];
    const retainedImageIds = new Set(next.filter((block): block is DraftImageBlock => block.type === "image").map((image) => image.localId));
    previous.forEach((block) => {
      if (block.type === "image" && !retainedImageIds.has(block.localId)) URL.revokeObjectURL(block.previewUrl);
    });
    draftsRef.current.set(conversationId, next.length ? next : initialBlocks());
    bodyVersionsRef.current.set(conversationId, (bodyVersionsRef.current.get(conversationId) ?? 0) + 1);
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
  const setReply = useCallback((target: ChatReplyTarget | null) => {
    repliesRef.current.set(activeConversationId, target);
    replyVersionsRef.current.set(activeConversationId, (replyVersionsRef.current.get(activeConversationId) ?? 0) + 1);
    setVersion((value) => value + 1);
  }, [activeConversationId]);
  const snapshot = useCallback((conversationId: number | string): ChatDraftSnapshot => ({
    conversationId, blocks: draftsRef.current.get(conversationId) ?? initialBlocks(),
    replyTo: repliesRef.current.get(conversationId) ?? null,
    bodyVersion: bodyVersionsRef.current.get(conversationId) ?? 0,
    replyVersion: replyVersionsRef.current.get(conversationId) ?? 0,
  }), []);
  const mergeUploadMetadata = useCallback((conversationId: number | string, uploaded: ChatDraftBlock[]) => {
    const images = new Map(uploaded.filter((block): block is DraftImageBlock => block.type === "image")
      .map((block) => [block.localId, block]));
    const current = draftsRef.current.get(conversationId);
    if (!current) return;
    draftsRef.current.set(conversationId, current.map((block) => block.type === "image" && images.has(block.localId)
      ? { ...block, ...images.get(block.localId)!, file: block.file, previewUrl: block.previewUrl } : block));
    setVersion((value) => value + 1);
  }, []);
  const completeSend = useCallback((sent: ChatDraftSnapshot) => {
    const bodyUnchanged = (bodyVersionsRef.current.get(sent.conversationId) ?? 0) === sent.bodyVersion;
    if (bodyUnchanged) {
      setBlocksForConversation(sent.conversationId, initialBlocks());
    }
    if (bodyUnchanged && (replyVersionsRef.current.get(sent.conversationId) ?? 0) === sent.replyVersion) {
      repliesRef.current.delete(sent.conversationId);
    }
    setVersion((value) => value + 1);
  }, [setBlocksForConversation]);
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
    replyTo: repliesRef.current.get(activeConversationId) ?? null, setReply, snapshot, mergeUploadMetadata, completeSend,
  }), [activeConversationId, activeText.text, blocks, clear, completeSend, createImageBlocks, draft, getDraft, insertFiles, mergeUploadMetadata, removeImage, setBlocks, setBlocksForConversation, setDraft, setDraftForConversation, setReply, snapshot, version]);
}

function createId(): string { return crypto.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`; }
function lastIndexOfText(blocks: ChatDraftBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) if (blocks[index].type === "text") return index;
  return -1;
}
