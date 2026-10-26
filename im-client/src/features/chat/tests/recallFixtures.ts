import type { ChatData, ChatMessage } from "../types";
export const recalledAt = "2026-10-23T09:00:00Z";
export function recallMessage(id = "m", overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { localKey: id, messageId: id, conversationId: 42, conversationSeq: 1, senderUserId: 1,
    clientMessageId: `client-${id}`, messageType: "text", content: { text: "保留的原文" },
    createdAt: "2020-01-01T00:00:00Z", clientSentAt: "2020-01-01T00:00:00Z", localStatus: "accepted",
    displayTime: "", showTime: true, showAvatar: true, ...overrides };
}
export function recallData(messages = [recallMessage()]): ChatData {
  return { self: { userId: 1, account: "self", name: "我", avatar: "我", tone: "blue" },
    conversations: { 42: { conversationId: 42, type: "direct", name: "好友", avatar: "友", tone: "blue",
      status: "", participants: {}, messages, lastSeq: 9, deliveredSeq: 8, readSeq: 7 } },
    sessions: [{ id: "s", conversationId: 42, name: "好友", avatar: "友", tone: "blue", type: "direct", preview: "保留的原文", time: "" }],
    contacts: [], contactSections: [] };
}
