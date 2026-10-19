import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ChatConversation } from "../types";

export function useReplyNavigation(conversation: ChatConversation, listRef: RefObject<HTMLElement | null>) {
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setHighlightedKey(null); setFeedback("");
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [conversation.conversationId]);
  const locateReply = (messageId: string) => {
    const message = conversation.messages.find((item) => item.messageId === messageId);
    const row = message && Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-message-key]") ?? [])
      .find((element) => element.dataset.messageKey === message.localKey);
    if (!message || !row) { setFeedback("原消息尚未加载，请先加载更早记录"); return; }
    setFeedback("");
    row.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlightedKey(message.localKey);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHighlightedKey(null), 1800);
  };
  return { highlightedKey, feedback, locateReply };
}
