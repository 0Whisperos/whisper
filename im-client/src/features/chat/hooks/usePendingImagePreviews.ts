import { useCallback, useEffect, useRef } from "react";
import type { ChatContentBlock, ChatData } from "../types";

/** Own message previews independently of the editor draft until a formal message replaces them. */
export function usePendingImagePreviews(data: ChatData | null) {
  const previewsRef = useRef(new Map<string, string[]>());
  useEffect(() => {
    const pending = new Set(Object.values(data?.conversations ?? {}).flatMap((conversation) => conversation.messages)
      .filter((message) => message.messageId === null && message.senderUserId === data?.self.userId)
      .map((message) => message.clientMessageId));
    for (const [id, urls] of previewsRef.current) {
      if (pending.has(id)) continue;
      urls.forEach((url) => URL.revokeObjectURL?.(url));
      previewsRef.current.delete(id);
    }
  }, [data]);
  useEffect(() => () => {
    previewsRef.current.forEach((urls) => urls.forEach((url) => URL.revokeObjectURL?.(url)));
    previewsRef.current.clear();
  }, []);
  return useCallback((clientMessageId: string, blocks: ChatContentBlock[]) => {
    previewsRef.current.set(clientMessageId, blocks.flatMap((block) => block.type === "image"
      && block.previewUrl?.startsWith("blob:") ? [block.previewUrl] : []));
  }, []);
}
