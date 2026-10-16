import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentResourceCache, attachmentResourceKey } from "../attachmentResourceCache";
import type { AttachmentResource } from "../attachmentResourceCache";
import type { ChatConversation } from "../types";

export function useChatImageResources(conversation: ChatConversation, apiBaseUrl: string, accessToken: string, userId: number,
  attachmentResourceCache?: AttachmentResourceCache) {
  const attachmentIds = useMemo(() => Array.from(new Set(conversation.messages.flatMap((message) =>
    message.messageId !== null && message.localStatus === "accepted" && "blocks" in message.content
      ? message.content.blocks.filter((block) => block.type === "image").map((block) => block.attachment_id)
      : []
  ))).sort(), [conversation.messages]);
  const fallbackAttachmentCacheRef = useRef<AttachmentResourceCache | null>(null);
  if (!fallbackAttachmentCacheRef.current) fallbackAttachmentCacheRef.current = new AttachmentResourceCache();
  const resolvedAttachmentCache = attachmentResourceCache ?? fallbackAttachmentCacheRef.current;
  useEffect(() => () => {
    if (!attachmentResourceCache) fallbackAttachmentCacheRef.current?.clear();
  }, [attachmentResourceCache]);
  const [imageResources, setImageResources] = useState<Record<string, AttachmentResource>>({});
  const [imageFailures, setImageFailures] = useState<Record<string, boolean>>({});
  const imageContext = { apiBaseUrl, accessToken, userId, conversationId: conversation.conversationId };
  const imageContextKey = JSON.stringify([apiBaseUrl.replace(/\/+$/, ""), accessToken, userId, conversation.conversationId]);
  const currentImageContextRef = useRef(imageContextKey);
  currentImageContextRef.current = imageContextKey;
  useEffect(() => {
    let cancelled = false;
    const imageKeys = attachmentIds.map((id) => attachmentResourceKey(imageContext, id));
    setImageResources((current) => Object.fromEntries(Object.entries(current).filter(([key]) => imageKeys.includes(key))));
    setImageFailures((current) => Object.fromEntries(Object.entries(current).filter(([key]) => imageKeys.includes(key))));
    if (attachmentIds.length === 0 || !apiBaseUrl || !accessToken) return () => { cancelled = true; };
    void resolvedAttachmentCache.loadMany(imageContext, attachmentIds)
      .then((results) => {
        if (cancelled || currentImageContextRef.current !== imageContextKey) return;
        setImageResources((current) => {
          const next = { ...current };
          for (const result of results) if (result.resource) next[attachmentResourceKey(imageContext, result.attachmentId)] = result.resource;
          return next;
        });
        setImageFailures((current) => {
          const next = { ...current };
          for (const result of results) {
            const key = attachmentResourceKey(imageContext, result.attachmentId);
            if (result.error) next[key] = true;
            else if (result.resource) delete next[key];
          }
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, apiBaseUrl, attachmentIds, conversation.conversationId, resolvedAttachmentCache, userId]);
  const retryImage = (attachmentId: string) => {
    const contextKey = imageContextKey;
    const resourceKey = attachmentResourceKey(imageContext, attachmentId);
    setImageFailures((current) => ({ ...current, [resourceKey]: false }));
    void resolvedAttachmentCache.retry(imageContext, attachmentId)
      .then((resource) => {
        if (currentImageContextRef.current === contextKey) setImageResources((current) => ({ ...current, [resourceKey]: resource }));
      })
      .catch(() => {
        if (currentImageContextRef.current === contextKey) {
          setImageResources((current) => {
            const next = { ...current };
            delete next[resourceKey];
            return next;
          });
          setImageFailures((current) => ({ ...current, [resourceKey]: true }));
        }
      });
  };
  const recoverImage = (attachmentId: string) => {
    const contextKey = imageContextKey;
    const resourceKey = attachmentResourceKey(imageContext, attachmentId);
    void resolvedAttachmentCache.recoverOnce(imageContext, attachmentId)
      .then((resource) => {
        if (currentImageContextRef.current === contextKey) setImageResources((current) => ({ ...current, [resourceKey]: resource }));
      })
      .catch(() => {
        if (currentImageContextRef.current === contextKey) {
          setImageResources((current) => {
            const next = { ...current };
            delete next[resourceKey];
            return next;
          });
          setImageFailures((current) => ({ ...current, [resourceKey]: true }));
        }
      });
  };
  return { imageResources, imageFailures, imageContext, resolvedAttachmentCache, retryImage, recoverImage };
}
