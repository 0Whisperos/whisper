import type { AvatarTone, ChatData } from "./types";

export interface ForwardTarget {
  key: string;
  conversationId: number | null;
  name: string;
  avatar: string;
  tone: AvatarTone;
  disabledReason?: string;
}

/** Contacts and already loaded direct conversations share a single selectable target. */
export function buildForwardTargets(data: ChatData): ForwardTarget[] {
  const targets: ForwardTarget[] = [];
  const seen = new Set<number>();
  for (const contact of data.contacts) {
    const conversationId = contact.conversationId ?? null;
    if (conversationId !== null && seen.has(conversationId)) continue;
    if (conversationId !== null) seen.add(conversationId);
    const conversation = conversationId === null ? undefined : data.conversations[conversationId];
    targets.push({ key: conversationId === null ? `contact:${contact.id}` : `conversation:${conversationId}`,
      conversationId, name: contact.name, avatar: contact.avatar, tone: contact.tone,
      ...(conversationId === null ? { disabledReason: "好友尚无可用会话" }
        : !conversation || conversation.type !== "direct" ? { disabledReason: "会话暂不可用" } : {}) });
  }
  const orderedIds = [...data.sessions.map((session) => session.conversationId),
    ...Object.values(data.conversations).map((conversation) => conversation.conversationId)];
  for (const id of orderedIds) {
    const conversation = data.conversations[id];
    if (seen.has(id) || !conversation || conversation.type !== "direct") continue;
    seen.add(id);
    targets.push({ key: `conversation:${id}`, conversationId: id, name: conversation.name,
      avatar: conversation.avatar, tone: conversation.tone });
  }
  return targets;
}
