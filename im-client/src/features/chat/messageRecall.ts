import type { ChatData, ChatMessage, ChatReplyTarget } from "./types";

export interface MessageRecallStatus { message_id: string; recalled_at: string | null }
export type RecallStates = NonNullable<ChatData["recalledMessages"]>;

export function canRecallMessage(message: ChatMessage, selfUserId: number): boolean {
  return message.senderUserId === selfUserId && message.localStatus === "accepted"
    && Boolean(message.messageId) && !message.recalledAt;
}

export function recallReply(target: ChatReplyTarget | null | undefined, states: Record<string, string> = {}): ChatReplyTarget | null {
  if (!target) return null;
  const recalledAt = states[target.messageId] ?? target.recalledAt;
  return recalledAt && recalledAt !== target.recalledAt ? { ...target, recalledAt } : target;
}

/** Merge terminal facts without deleting bodies or inserting unloaded messages. */
export function mergeRecallStatuses(data: ChatData, conversationId: number, statuses: MessageRecallStatus[]): ChatData {
  const states = { ...(data.recalledMessages?.[conversationId] ?? {}) };
  let changed = false;
  for (const status of statuses) if (status.recalled_at && !states[status.message_id]) {
    states[status.message_id] = status.recalled_at; changed = true;
  }
  const conversation = data.conversations[conversationId];
  const messages = conversation?.messages.map((message) => {
    const recalledAt = (message.messageId && states[message.messageId]) || message.recalledAt;
    const replyTo = recallReply(message.replyTo, states);
    const replyToRecalledAt = (message.replyToMessageId && states[message.replyToMessageId]) || message.replyToRecalledAt;
    if (recalledAt === message.recalledAt && replyTo === (message.replyTo ?? null) && replyToRecalledAt === message.replyToRecalledAt) return message;
    changed = true;
    return { ...message, ...(recalledAt ? { recalledAt } : {}), ...(replyTo ? { replyTo } : {}),
      ...(replyToRecalledAt ? { replyToRecalledAt } : {}) };
  });
  if (!changed) return data;
  const last = messages?.[messages.length - 1];
  return { ...data, recalledMessages: { ...data.recalledMessages, [conversationId]: states },
    ...(conversation && messages ? { conversations: { ...data.conversations, [conversationId]: { ...conversation, messages } } } : {}),
    sessions: data.sessions.map((session) => session.conversationId === conversationId && last?.recalledAt
      ? { ...session, preview: last.senderUserId === data.self.userId ? "你撤回了一条消息" : "对方撤回了一条消息" } : session),
  };
}

export function rememberDataRecalls(data: ChatData, states: RecallStates): ChatData {
  let next = data;
  for (const conversation of Object.values(data.conversations)) {
    const known = { ...(states[conversation.conversationId] ?? {}), ...data.recalledMessages?.[conversation.conversationId] };
    for (const message of conversation.messages) {
      if (message.messageId && message.recalledAt) known[message.messageId] ??= message.recalledAt;
      if (message.replyTo?.recalledAt) known[message.replyTo.messageId] ??= message.replyTo.recalledAt;
    }
    states[conversation.conversationId] = known;
  }
  for (const [id, known] of Object.entries(states)) next = mergeRecallStatuses(next, Number(id),
    Object.entries(known).map(([message_id, recalled_at]) => ({ message_id, recalled_at })));
  return next;
}

export function isOptionalRecallTimestamp(value: Record<string, unknown>): boolean {
  return value.recalled_at === undefined || value.recalled_at === null
    || (typeof value.recalled_at === "string" && Number.isFinite(Date.parse(value.recalled_at)));
}
