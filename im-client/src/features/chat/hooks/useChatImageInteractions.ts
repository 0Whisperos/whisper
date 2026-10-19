import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { copyImage, saveImage } from "../../image-viewer/api";
import { imageViewerCoordinator } from "../../image-viewer/coordinator";
import type { ImageTarget } from "../../image-viewer/types";
import type { AttachmentLoadContext, AttachmentResourceCache } from "../attachmentResourceCache";
import type { ChatConversation, ChatMessage, ChatReplyTarget } from "../types";
import { replyTargetFromMessage } from "../messageReply";
import { copyChatMessage } from "../messageClipboardApi";

interface ChatInteractionMenu {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  label: string;
  ownerKey: string;
  ownerState: string;
  anchor: HTMLElement;
}

export function useChatImageInteractions(conversation: ChatConversation, selfUserId: number,
  context: AttachmentLoadContext, cache: AttachmentResourceCache, onReply?: (target: ChatReplyTarget) => void) {
  const [menu, setMenu] = useState<ChatInteractionMenu | null>(null);
  const [feedback, setFeedback] = useState("");
  const contextKey = JSON.stringify([context.apiBaseUrl, context.accessToken, context.userId, context.conversationId]);
  const currentContextRef = useRef(contextKey);
  currentContextRef.current = contextKey;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { setMenu(null); setFeedback(""); }, [contextKey]);
  useEffect(() => {
    if (menu && (!menu.anchor.isConnected || !conversation.messages.some((message) => message.localKey === menu.ownerKey
      && messageState(message) === menu.ownerState))) closeMenu();
  }, [conversation.messages, menu, closeMenu]);
  const report = (value: string) => {
    if (mountedRef.current && currentContextRef.current === contextKey) setFeedback(value);
  };
  const runImageAction = (attachmentId: string, action: (target: ImageTarget) => Promise<unknown>, errorMessage: string) => {
    report("");
    void (async () => {
      const [result] = await cache.loadMany(context, [attachmentId]);
      let resource = result?.resource;
      if (!resource || resource.source !== "asset") resource = await cache.recoverOnce(context, attachmentId);
      if (resource.source !== "asset") throw new Error("image_load_failed");
      if (!mountedRef.current || currentContextRef.current !== contextKey) return;
      const target: ImageTarget = { kind: "chat", apiBaseUrl: context.apiBaseUrl, userId: context.userId,
        conversationId: context.conversationId, attachmentId };
      try { await action(target); }
      catch (error) {
        if (!isMissingCachedImage(error)) throw error;
        const recovered = await cache.recoverOnce(context, attachmentId);
        if (recovered.source !== "asset") throw new Error("image_load_failed");
        if (!mountedRef.current || currentContextRef.current !== contextKey) return;
        await action(target);
      }
    })().catch(() => report(errorMessage));
  };
  const openMessageMenu = (event: MouseEvent<HTMLElement>, message: ChatMessage) => {
    event.preventDefault(); event.stopPropagation(); setFeedback("");
    const labels = message.messageId !== null && message.localStatus === "accepted"
      ? ["复制", "回复", "转发", ...(message.senderUserId === selfUserId ? ["撤回"] : [])] : ["复制"];
    setMenu({ position: { x: event.clientX, y: event.clientY }, label: "消息菜单", ownerKey: message.localKey, ownerState: messageState(message),
      anchor: event.currentTarget, items: labels.map((label) => ({ label, onSelect: () => {
        if (label === "复制") {
          void copyChatMessage(message, context, cache).catch(() => report("复制失败，请重试"));
        } else if (label === "回复") {
          const target = replyTargetFromMessage(message);
          if (target) onReply?.(target);
        } else report("该功能暂未实现");
      } })) });
  };
  const openImageMenu = (event: MouseEvent<HTMLElement>, message: ChatMessage, attachmentId: string) => {
    event.preventDefault(); event.stopPropagation(); setFeedback("");
    if (message.localStatus !== "accepted" || !message.messageId) {
      const block = "blocks" in message.content && message.content.blocks.find((item) => item.type === "image" && item.attachment_id === attachmentId);
      if (!block) return;
      setMenu({ position: { x: event.clientX, y: event.clientY }, label: "图片菜单", ownerKey: message.localKey, ownerState: messageState(message),
        anchor: event.currentTarget, items: [{ label: "复制", onSelect: () => {
          void copyChatMessage({ ...message, content: { blocks: [block] } }, context, cache).catch(() => report("复制失败，请重试"));
        } }] });
      return;
    }
    setMenu({ position: { x: event.clientX, y: event.clientY }, label: "图片菜单", ownerKey: message.localKey, ownerState: messageState(message),
      anchor: event.currentTarget, items: [
        { label: "复制", onSelect: () => runImageAction(attachmentId, copyImage, "复制失败，请重试") },
        { label: "下载原图", onSelect: () => runImageAction(attachmentId, saveImage, "保存失败") },
      ] });
  };
  const openImage = (message: ChatMessage, blockIndex: number) => {
    closeMenu(); report("");
    if (message.messageId === null || message.localStatus !== "accepted") return;
    void imageViewerCoordinator.open(context, conversation, `${message.messageId}:${blockIndex}`, cache)
      .catch(() => report("图片加载失败"));
  };
  return { menu, feedback, closeMenu, openMessageMenu, openImageMenu, openImage };
}

function isMissingCachedImage(error: unknown): boolean {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message
    : error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["image_not_cached", "image_unavailable", "image_cache_missing", "invalid_cached_image"].includes(code);
}

function messageState(message: ChatMessage): string {
  return `${message.localStatus}:${message.messageId ?? ""}`;
}
