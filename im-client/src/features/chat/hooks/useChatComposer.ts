import { useEffect, useRef, useState } from "react";
import type { ChatContentBlock, ChatReplyTarget } from "../types";
import { useChatDrafts, type DraftImageBlock } from "./useChatDrafts";
import { uploadDraftImages } from "./uploadDraftImages";

export interface ChatComposerOptions {
  conversationId: number;
  apiBaseUrl: string;
  accessToken: string;
  userId: number;
  canSendMessages: boolean;
  onSendText: (conversationId: number, text: string, replyTo?: ChatReplyTarget | null) => boolean | void;
  onSendRich: (conversationId: number, blocks: ChatContentBlock[], replyTo?: ChatReplyTarget | null) => string | null | boolean | void;
}

export function useChatComposer({ conversationId, apiBaseUrl, accessToken, userId, canSendMessages,
  onSendText, onSendRich }: ChatComposerOptions) {
  const drafts = useChatDrafts(conversationId);
  const [statuses, setStatuses] = useState<Record<number, string>>({});
  const busyRef = useRef(new Set<number>());
  const [, setBusyVersion] = useState(0);
  const contextKey = JSON.stringify([apiBaseUrl, accessToken, userId]);
  const currentContextRef = useRef(contextKey);
  currentContextRef.current = contextKey;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const isCurrent = () => mountedRef.current && currentContextRef.current === contextKey;
  const showStatus = (id: number, message: string) => {
    if (isCurrent()) setStatuses((current) => ({ ...current, [id]: message }));
  };

  const sendText = (text: string) => {
    if (!canSendMessages || busyRef.current.has(conversationId) || !text.trim()) return;
    if ([...text.trim()].length > 4096) { showStatus(conversationId, "消息文字不能超过 4096 个字符"); return; }
    const snapshot = drafts.snapshot(conversationId);
    const accepted = snapshot.replyTo ? onSendText(conversationId, text, snapshot.replyTo) : onSendText(conversationId, text);
    if (accepted !== false) drafts.completeSend(snapshot);
  };
  const sendEditor = async () => {
    if (!canSendMessages || busyRef.current.has(conversationId)) return;
    const snapshot = drafts.snapshot(conversationId);
    const text = snapshot.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
    if ([...text].length > 4096) { showStatus(conversationId, "消息文字不能超过 4096 个字符"); return; }
    if (!snapshot.blocks.some((block) => block.type === "image")) { sendText(text.trim()); return; }
    busyRef.current.add(conversationId);
    setBusyVersion((version) => version + 1);
    showStatus(conversationId, "正在上传图片…");
    try {
      const blocks = await uploadDraftImages(apiBaseUrl, accessToken, conversationId, snapshot.blocks,
        (next) => { if (isCurrent()) drafts.mergeUploadMetadata(conversationId, next); });
      if (!isCurrent()) return;
      // The message owns separate previews: clearing the draft must not break pending/failed bubbles.
      const previewUrls: string[] = [];
      const content: ChatContentBlock[] = blocks.flatMap((block): ChatContentBlock[] => {
        if (block.type === "text") return block.text ? [{ type: "text", text: block.text }] : [];
        const previewUrl = URL.createObjectURL(block.file);
        previewUrls.push(previewUrl);
        return [{ type: "image", attachment_id: block.attachmentId!, previewUrl }];
      });
      let accepted: string | null | boolean | void;
      try {
        accepted = snapshot.replyTo ? onSendRich(conversationId, content, snapshot.replyTo) : onSendRich(conversationId, content);
      } catch (error) {
        previewUrls.forEach((url) => URL.revokeObjectURL(url));
        throw error;
      }
      if (accepted !== false && accepted !== null) drafts.completeSend(snapshot);
      else previewUrls.forEach((url) => URL.revokeObjectURL(url));
      showStatus(conversationId, "");
    } catch (error) {
      showStatus(conversationId, error instanceof Error ? error.message : "图片上传失败，请重试");
    } finally {
      busyRef.current.delete(conversationId);
      if (mountedRef.current) setBusyVersion((version) => version + 1);
    }
  };
  const pickImages = (files: File[]): DraftImageBlock[] => {
    if (busyRef.current.has(conversationId)) return [];
    const images = drafts.blocks.filter((block): block is DraftImageBlock => block.type === "image");
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    let error = "";
    if (images.length + files.length > 10) error = "每条消息最多发送 10 张图片";
    else if (files.some((file) => !allowed.has(file.type))) error = "仅支持 JPEG、PNG 或 WebP 图片";
    else if (files.some((file) => file.size > 20 * 1024 * 1024)
      || [...images.map((image) => image.file), ...files].reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024)
      error = "单张图片不能超过 20 MiB，消息图片总量不能超过 50 MiB";
    showStatus(conversationId, error);
    return error ? [] : drafts.createImageBlocks(files);
  };
  return { drafts, statusMessage: statuses[conversationId] ?? "", isBusy: busyRef.current.has(conversationId),
    sendText, sendEditor, pickImages, clipboardContextKey: `${contextKey}:${conversationId}` };
}
