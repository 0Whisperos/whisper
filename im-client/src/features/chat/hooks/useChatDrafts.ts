import { useCallback, useMemo, useRef, useState } from "react";

export function useChatDrafts(activeConversationId: number) {
  const draftsRef = useRef(new Map<number | string, string>());
  const [version, setVersion] = useState(0);

  const draft = draftsRef.current.get(activeConversationId) ?? "";

  const setDraft = useCallback((value: string) => {
    draftsRef.current.set(activeConversationId, value);
    setVersion((current) => current + 1);
  }, [activeConversationId]);

  const getDraft = useCallback((conversationId: number | string) => {
    return draftsRef.current.get(conversationId) ?? "";
  }, []);

  const setDraftForConversation = useCallback((conversationId: number | string, value: string) => {
    draftsRef.current.set(conversationId, value);
    setVersion((current) => current + 1);
  }, []);

  return useMemo(() => ({
    draft,
    version,
    canSend: draft.trim().length > 0,
    setDraft,
    getDraft,
    setDraftForConversation,
  }), [draft, getDraft, setDraft, setDraftForConversation, version]);
}
