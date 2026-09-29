import type { ChatData, ChatMessage, ChatMessageDto } from "../types";

const MESSAGE_GROUP_GAP_MS = 10 * 60 * 1000;

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
  if (!conversation || conversation.messages.some((message) => (
    message.senderUserId === input.senderUserId
    && message.clientMessageId === input.clientMessageId
  ))) {
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

export function sortTimelineMessages(messages: ChatMessage[], now = new Date()): ChatMessage[] {
  const sorted = messages
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

  return sorted.map((message, index) => {
    const currentTimestamp = getMessageTimestamp(message);
    const currentDate = parseMessageDate(currentTimestamp);
    const previous = sorted[index - 1];
    const previousTimestamp = previous ? getMessageTimestamp(previous) : null;
    const previousDate = previousTimestamp ? parseMessageDate(previousTimestamp) : null;
    const crossesDate = Boolean(currentDate && previousDate && !isSameLocalDate(currentDate, previousDate));
    const elapsed = currentDate && previousDate ? currentDate.getTime() - previousDate.getTime() : null;
    const currentIsToday = Boolean(currentDate && isSameLocalDate(currentDate, now));
    const showTime = currentDate !== null && (
      !previous
      || previousDate === null
      || crossesDate
      || (currentIsToday && (elapsed === null || elapsed < 0 || elapsed >= MESSAGE_GROUP_GAP_MS))
    );

    return {
      ...message,
      displayTime: currentDate && showTime ? formatTimelineSeparatorTime(currentDate, now) : "",
      showTime,
    };
  });
}

export function isCompactMessage(previous: ChatMessage | undefined, current: ChatMessage, now = new Date()): boolean {
  if (!previous || previous.senderUserId !== current.senderUserId) {
    return false;
  }
  const previousDate = parseMessageDate(getMessageTimestamp(previous));
  const currentDate = parseMessageDate(getMessageTimestamp(current));
  if (!previousDate || !currentDate || !isSameLocalDate(previousDate, currentDate)) {
    return false;
  }
  if (!isSameLocalDate(currentDate, now)) {
    return true;
  }
  const elapsed = currentDate.getTime() - previousDate.getTime();
  return elapsed >= 0 && elapsed < MESSAGE_GROUP_GAP_MS;
}

export function formatHoverMessageTime(value: string, includeDateContext: boolean, now = new Date()): string | null {
  const date = parseMessageDate(value);
  if (!date) {
    return null;
  }
  return includeDateContext
    ? formatContextualMessageTime(date, now, true)
    : formatClockTime(date, true);
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

function getMessageTimestamp(message: ChatMessage): string {
  return message.createdAt ?? message.clientSentAt;
}

function parseMessageDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimelineSeparatorTime(date: Date, now: Date): string {
  if (isSameLocalDate(date, now)) {
    return formatClockTime(date, false);
  }
  return date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatContextualMessageTime(date: Date, now: Date, includeSeconds: boolean): string {
  const time = formatClockTime(date, includeSeconds);
  if (isSameLocalDate(date, now)) {
    return time;
  }
  const dateLabel = date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return `${dateLabel} ${time}`;
}

function formatClockTime(date: Date, includeSeconds: boolean): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).format(date);
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
