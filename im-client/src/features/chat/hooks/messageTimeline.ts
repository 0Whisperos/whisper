import type { ChatData, ChatMessage, ChatMessageDto } from "../types";

export interface PendingTextMessageInput {
  conversationId: number;
  senderUserId: number;
  clientMessageId: string;
  text: string;
  clientSentAt: string;
}

export interface ServerTextMessage {
  message_id: string;
  conversation_id: number;
  conversation_seq: number;
  sender_user_id: number;
  client_message_id: string;
  message_type: "text";
  content: { text: string };
  created_at: string;
}

export function insertPendingTextMessage(data: ChatData, input: PendingTextMessageInput): ChatData {
  const conversation = data.conversations[input.conversationId];
  if (!conversation || conversation.messages.some((message) => message.clientMessageId === input.clientMessageId)) {
    return data;
  }
  const message: ChatMessage = {
    localKey: `local:${input.clientMessageId}`,
    messageId: null,
    conversationId: input.conversationId,
    conversationSeq: null,
    senderUserId: input.senderUserId,
    clientMessageId: input.clientMessageId,
    messageType: "text",
    content: { text: input.text },
    createdAt: null,
    clientSentAt: input.clientSentAt,
    localStatus: "sending",
    displayTime: formatMessageTime(input.clientSentAt),
    showTime: true,
    showAvatar: true,
  };
  return replaceConversationMessages(data, input.conversationId, [...conversation.messages, message]);
}

export function mergeOfficialMessage(data: ChatData, incoming: ServerTextMessage): ChatData {
  const conversation = data.conversations[incoming.conversation_id];
  if (!conversation) {
    return data;
  }
  const byMessageId = conversation.messages.find((message) => message.messageId === incoming.message_id);
  const local = incoming.sender_user_id === data.self.userId
    ? conversation.messages.find((message) => (
      message.messageId === null
      && message.senderUserId === data.self.userId
      && message.clientMessageId === incoming.client_message_id
    ))
    : undefined;
  if (byMessageId) {
    return local
      ? replaceConversationMessages(data, incoming.conversation_id, conversation.messages.filter((message) => message !== local))
      : data;
  }
  const official = toOfficialMessage(incoming, local);
  const messages = local
    ? conversation.messages.map((message) => message === local ? official : message)
    : [...conversation.messages, official];
  return replaceConversationMessages(data, incoming.conversation_id, messages);
}

export function markMessageFailed(data: ChatData, clientMessageId: string, errorCode: string): ChatData {
  let changed = false;
  const conversations = Object.fromEntries(Object.entries(data.conversations).map(([key, conversation]) => {
    let conversationChanged = false;
    const messages = conversation.messages.map((message) => {
      if (
        message.senderUserId !== data.self.userId
        || message.clientMessageId !== clientMessageId
        || message.localStatus === "accepted"
      ) {
        return message;
      }
      conversationChanged = true;
      changed = true;
      return { ...message, localStatus: "failed" as const, errorCode };
    });
    return [key, conversationChanged ? { ...conversation, messages } : conversation];
  })) as ChatData["conversations"];
  return changed ? { ...data, conversations } : data;
}

export function markMessageSending(data: ChatData, clientMessageId: string): ChatData {
  let changed = false;
  const conversations = Object.fromEntries(Object.entries(data.conversations).map(([key, conversation]) => {
    let conversationChanged = false;
    const messages = conversation.messages.map((message) => {
      if (
        message.senderUserId !== data.self.userId
        || message.clientMessageId !== clientMessageId
        || message.localStatus !== "failed"
      ) {
        return message;
      }
      conversationChanged = true;
      changed = true;
      const { errorCode: _errorCode, ...retrying } = message;
      return { ...retrying, localStatus: "sending" as const };
    });
    return [key, conversationChanged ? { ...conversation, messages } : conversation];
  })) as ChatData["conversations"];
  return changed ? { ...data, conversations } : data;
}

export function toAcceptedTimelineMessage(message: ChatMessageDto): ChatMessage {
  return {
    ...message,
    localKey: message.messageId,
    clientSentAt: message.createdAt,
    localStatus: "accepted",
    displayTime: formatMessageTime(message.createdAt),
    showTime: true,
    showAvatar: true,
  };
}

export function sortTimelineMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftSequence = left.message.conversationSeq;
      const rightSequence = right.message.conversationSeq;
      if (leftSequence !== null && rightSequence !== null) {
        return leftSequence - rightSequence;
      }
      if (leftSequence !== null) {
        return -1;
      }
      if (rightSequence !== null) {
        return 1;
      }
      const leftTime = Date.parse(left.message.clientSentAt);
      const rightTime = Date.parse(right.message.clientSentAt);
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    })
    .map(({ message }) => message);
}

function toOfficialMessage(incoming: ServerTextMessage, local?: ChatMessage): ChatMessage {
  return {
    localKey: local?.localKey ?? incoming.message_id,
    messageId: incoming.message_id,
    conversationId: incoming.conversation_id,
    conversationSeq: incoming.conversation_seq,
    senderUserId: incoming.sender_user_id,
    clientMessageId: incoming.client_message_id,
    messageType: "text",
    content: incoming.content,
    createdAt: incoming.created_at,
    clientSentAt: local?.clientSentAt ?? incoming.created_at,
    localStatus: "accepted",
    displayTime: formatMessageTime(incoming.created_at),
    showTime: local?.showTime ?? true,
    showAvatar: local?.showAvatar ?? true,
    receipt: local?.receipt,
  };
}

function replaceConversationMessages(data: ChatData, conversationId: number, unsortedMessages: ChatMessage[]): ChatData {
  const conversation = data.conversations[conversationId];
  if (!conversation) {
    return data;
  }
  const messages = sortTimelineMessages(unsortedMessages);
  const lastMessage = messages[messages.length - 1];
  return {
    ...data,
    sessions: data.sessions.map((session) => session.conversationId === conversationId
      ? {
        ...session,
        preview: lastMessage?.content.text ?? "暂无消息",
        time: lastMessage ? formatMessageTime(lastMessage.createdAt ?? lastMessage.clientSentAt) : "",
      }
      : session),
    conversations: {
      ...data.conversations,
      [conversationId]: { ...conversation, messages },
    },
  };
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
