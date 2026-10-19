import type { ChatMessage, ChatMessageContent, ChatReplyTarget, ChatReplyTargetDto } from "./types";

export function replySummary(content: ChatMessageContent): string {
  const blocks = "text" in content ? [{ type: "text" as const, text: content.text }] : content.blocks;
  const firstText = blocks.find((block) => block.type === "text" && block.text.trim());
  const text = firstText?.type === "text"
    ? [...firstText.text.trim().replace(/\s+/gu, " ")].slice(0, 80).join("") : "";
  const count = blocks.filter((block) => block.type === "image").length;
  return [text, count > 1 ? `[${count}张图片]` : count === 1 ? "[图片]" : ""].filter(Boolean).join(" ");
}

export function replyTargetFromMessage(message: ChatMessage): ChatReplyTarget | null {
  return message.messageId && message.localStatus === "accepted" ? {
    messageId: message.messageId, senderUserId: message.senderUserId,
    messageType: message.messageType, content: message.content,
  } : null;
}

export function parseReplyTarget(value: ChatReplyTargetDto | null | undefined): ChatReplyTarget | null {
  return value ? { messageId: value.message_id, senderUserId: value.sender_user_id,
    messageType: value.message_type, content: value.content } : null;
}

export function replyTargetToDto(value: ChatReplyTarget | null | undefined): ChatReplyTargetDto | null {
  return value ? { message_id: value.messageId, sender_user_id: value.senderUserId,
    message_type: value.messageType, content: value.content } : null;
}

export function isReplyMetadata(value: object): value is {
  reply_to_message_id?: string | null; reply_to?: ChatReplyTargetDto | null;
} {
  const record = value as Record<string, unknown>;
  if (record.reply_to_message_id !== undefined && record.reply_to_message_id !== null
    && (typeof record.reply_to_message_id !== "string" || !record.reply_to_message_id)) return false;
  if (record.reply_to === undefined || record.reply_to === null) return true;
  const target = record.reply_to;
  if (typeof target !== "object" || target === null) return false;
  const reply = target as Record<string, unknown>;
  return typeof reply.message_id === "string" && Boolean(reply.message_id)
    && typeof reply.sender_user_id === "number" && Number.isSafeInteger(reply.sender_user_id) && reply.sender_user_id > 0
    && (reply.message_type === "text" || reply.message_type === "rich")
    && isMessageContent(reply.message_type, reply.content)
    && (record.reply_to_message_id === undefined || record.reply_to_message_id === reply.message_id);
}

function isMessageContent(type: "text" | "rich", value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (type === "text") return "text" in value && typeof value.text === "string";
  return "blocks" in value && Array.isArray(value.blocks) && value.blocks.every((block: unknown) => {
    if (typeof block !== "object" || block === null || !("type" in block)) return false;
    return block.type === "text" ? "text" in block && typeof block.text === "string"
      : block.type === "image" && "attachment_id" in block && typeof block.attachment_id === "string";
  });
}
