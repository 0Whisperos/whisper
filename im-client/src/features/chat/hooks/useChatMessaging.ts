import { useCallback, useEffect, useRef } from "react";

import type {
  ChatBusinessServerFrame,
  ChatMessageCreatedFrame,
  ChatSendMessageRejectedFrame,
  ChatServerAcceptedFrame,
} from "../../chat-connection/types";
import type { ChatData } from "../types";
import {
  insertPendingTextMessage,
  markMessageFailed,
  markMessageSending,
  mergeOfficialMessage,
} from "./messageTimeline";

export interface SendTextMessageInput {
  clientMessageId: string;
  conversationId: number;
  text: string;
  clientSentAt: string;
}

interface UseChatMessagingOptions {
  data: ChatData | null;
  updateData: (updater: (current: ChatData | null) => ChatData | null) => void;
  sendTextMessage: (input: SendTextMessageInput) => void;
  clientMessageIdFactory?: () => string;
  now?: () => Date;
  acknowledgementTimeoutMs?: number;
  sendDeliveredAck?: (conversationId: number, deliveredSeq: number) => void;
  sendReadAck?: (conversationId: number, readSeq: number) => void;
  reloadHistory?: (conversationId: number) => Promise<number | null>;
}

const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 15_000;

export function useChatMessaging({
  data,
  updateData,
  sendTextMessage,
  clientMessageIdFactory = createClientMessageId,
  now = () => new Date(),
  acknowledgementTimeoutMs = DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
  sendDeliveredAck,
  sendReadAck,
  reloadHistory,
}: UseChatMessagingOptions) {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dataRef = useRef(data);
  const pendingReadAcksRef = useRef(new Map<number, { readSeq: number; retryAfterDelivery: boolean }>());
  dataRef.current = data;

  const clearAcknowledgementTimer = useCallback((clientMessageId: string) => {
    const timer = timersRef.current.get(clientMessageId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(clientMessageId);
    }
  }, []);

  const startAcknowledgementTimer = useCallback((clientMessageId: string) => {
    clearAcknowledgementTimer(clientMessageId);
    timersRef.current.set(clientMessageId, setTimeout(() => {
      timersRef.current.delete(clientMessageId);
      updateData((current) => current ? markMessageFailed(current, clientMessageId, "acknowledgement_timeout") : current);
    }, acknowledgementTimeoutMs));
  }, [acknowledgementTimeoutMs, clearAcknowledgementTimer, updateData]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const send = useCallback((conversationId: number, rawText: string): boolean => {
    const text = rawText.trim();
    const current = dataRef.current;
    if (!text || !current?.conversations[conversationId]) {
      return false;
    }
    const clientMessageId = clientMessageIdFactory();
    const clientSentAt = now().toISOString();
    updateData((latest) => latest ? insertPendingTextMessage(latest, {
      conversationId,
      senderUserId: latest.self.userId,
      clientMessageId,
      text,
      clientSentAt,
    }) : latest);
    startAcknowledgementTimer(clientMessageId);
    try {
      sendTextMessage({ clientMessageId, conversationId, text, clientSentAt });
    } catch {
      clearAcknowledgementTimer(clientMessageId);
      updateData((latest) => latest ? markMessageFailed(latest, clientMessageId, "send_failed") : latest);
    }
    return true;
  }, [clearAcknowledgementTimer, clientMessageIdFactory, now, sendTextMessage, startAcknowledgementTimer, updateData]);

  const retry = useCallback((clientMessageId: string): boolean => {
    const current = dataRef.current;
    const message = current && Object.values(current.conversations)
      .flatMap((conversation) => conversation.messages)
      .find((candidate) => (
        candidate.senderUserId === current.self.userId
        && candidate.clientMessageId === clientMessageId
        && candidate.localStatus === "failed"
      ));
    if (!message) {
      return false;
    }
    updateData((latest) => latest ? markMessageSending(latest, clientMessageId) : latest);
    startAcknowledgementTimer(clientMessageId);
    try {
      sendTextMessage({
        clientMessageId: message.clientMessageId,
        conversationId: message.conversationId,
        text: message.content.text,
        clientSentAt: message.clientSentAt,
      });
    } catch {
      clearAcknowledgementTimer(clientMessageId);
      updateData((latest) => latest ? markMessageFailed(latest, clientMessageId, "send_failed") : latest);
    }
    return true;
  }, [clearAcknowledgementTimer, sendTextMessage, startAcknowledgementTimer, updateData]);

  const handleServerAccepted = useCallback((frame: ChatServerAcceptedFrame) => {
    if (dataRef.current?.self.userId !== frame.payload.message.sender_user_id) {
      return;
    }
    const clientMessageId = frame.payload.client_message_id;
    clearAcknowledgementTimer(clientMessageId);
    updateData((current) => current ? mergeOfficialMessage(current, frame.payload.message) : current);
  }, [clearAcknowledgementTimer, updateData]);

  const handleSendMessageRejected = useCallback((frame: ChatSendMessageRejectedFrame) => {
    const clientMessageId = frame.payload.client_message_id;
    const hasLocalMessage = Object.values(dataRef.current?.conversations ?? {})
      .flatMap((conversation) => conversation.messages)
      .some((message) => (
        message.senderUserId === dataRef.current?.self.userId
        && message.clientMessageId === clientMessageId
        && message.localStatus !== "accepted"
      ));
    if (!hasLocalMessage) {
      return;
    }
    clearAcknowledgementTimer(clientMessageId);
    updateData((current) => current ? markMessageFailed(current, clientMessageId, frame.payload.error_code) : current);
  }, [clearAcknowledgementTimer, updateData]);

  const handleMessageCreated = useCallback((frame: ChatMessageCreatedFrame) => {
    if (dataRef.current?.self.userId === frame.payload.message.sender_user_id) {
      clearAcknowledgementTimer(frame.payload.message.client_message_id);
    }
    updateData((current) => current ? mergeOfficialMessage(current, frame.payload.message) : current);
    const message = frame.payload.message;
    const conversation = dataRef.current?.conversations[message.conversation_id];
    if (!conversation) {
      return;
    }
    const deliveredSeq = conversation.deliveredSeq ?? 0;
    if (message.conversation_seq > (conversation.lastSeq ?? 0)) {
      updateData((current) => current ? {
        ...current,
        conversations: {
          ...current.conversations,
          [message.conversation_id]: {
            ...current.conversations[message.conversation_id],
            lastSeq: message.conversation_seq,
          },
        },
      } : current);
    }
    const sequences = new Set(conversation.messages
      .map((item) => item.conversationSeq)
      .filter((sequence): sequence is number => sequence !== null));
    sequences.add(message.conversation_seq);
    let nextDeliveredSeq = deliveredSeq;
    while (sequences.has(nextDeliveredSeq + 1)) {
      nextDeliveredSeq += 1;
    }
    if (nextDeliveredSeq > deliveredSeq) {
      sendDeliveredAck?.(message.conversation_id, nextDeliveredSeq);
    } else if (message.conversation_seq > deliveredSeq + 1 && reloadHistory) {
      void reloadHistory(message.conversation_id).then((caughtUpSeq) => {
        if (caughtUpSeq !== null) {
          sendDeliveredAck?.(message.conversation_id, caughtUpSeq);
        }
      });
    }
  }, [clearAcknowledgementTimer, reloadHistory, sendDeliveredAck, updateData]);

  const markReadThrough = useCallback((conversationId: number, readSeq: number) => {
    const conversation = dataRef.current?.conversations[conversationId];
    if (!conversation || readSeq <= (conversation.readSeq ?? 0) || readSeq > (conversation.deliveredSeq ?? 0)) {
      return;
    }
    const pending = pendingReadAcksRef.current.get(conversationId);
    if (!pending || readSeq > pending.readSeq) {
      pendingReadAcksRef.current.set(conversationId, { readSeq, retryAfterDelivery: false });
    }
    try {
      sendReadAck?.(conversationId, readSeq);
    } catch {
      return;
    }
  }, [sendReadAck]);

  const handleReceiptUpdated = useCallback((frame: Extract<ChatBusinessServerFrame, { type: "conversation_receipt_updated" }>) => {
    updateData((current) => {
      const conversation = current?.conversations[frame.payload.conversation_id];
      if (!current || !conversation || frame.payload.user_id === current.self.userId) {
        return current;
      }
      const peerDeliveredSeq = Math.max(conversation.peerDeliveredSeq ?? 0, frame.payload.delivered_seq);
      const peerReadSeq = Math.max(conversation.peerReadSeq ?? 0, frame.payload.read_seq);
      return updateConversationCursors(current, frame.payload.conversation_id, { peerDeliveredSeq, peerReadSeq });
    });
  }, [updateData]);

  const handleServerFrame = useCallback((frame: ChatBusinessServerFrame) => {
    switch (frame.type) {
      case "server_accepted":
        handleServerAccepted(frame);
        return;
      case "send_message_rejected":
        handleSendMessageRejected(frame);
        return;
      case "message_created":
        handleMessageCreated(frame);
        return;
      case "delivered_ack_accepted":
        updateData((current) => current ? updateConversationCursors(current, frame.payload.conversation_id, {
          deliveredSeq: frame.payload.delivered_seq,
        }) : current);
        {
          const pending = pendingReadAcksRef.current.get(frame.payload.conversation_id);
          if (pending?.retryAfterDelivery && pending.readSeq <= frame.payload.delivered_seq && sendReadAck) {
            try {
              sendReadAck(frame.payload.conversation_id, pending.readSeq);
              pending.retryAfterDelivery = false;
            } catch {
              // Keep the pending cursor marked for retry after a later accepted delivery cursor.
            }
          }
        }
        return;
      case "read_ack_accepted":
        {
          const pending = pendingReadAcksRef.current.get(frame.payload.conversation_id);
          if (pending && pending.readSeq <= frame.payload.read_seq) {
            pendingReadAcksRef.current.delete(frame.payload.conversation_id);
          }
        }
        updateData((current) => current ? updateConversationCursors(current, frame.payload.conversation_id, {
          readSeq: frame.payload.read_seq,
        }) : current);
        return;
      case "delivered_ack_rejected":
        if (frame.payload.conversation_id !== undefined && reloadHistory) {
          const conversationId = frame.payload.conversation_id;
          void reloadHistory(conversationId).then((caughtUpSeq) => {
            if (caughtUpSeq !== null) {
              sendDeliveredAck?.(conversationId, caughtUpSeq);
            }
          });
        }
        return;
      case "read_ack_rejected":
        if (frame.payload.conversation_id !== undefined) {
          const conversationId = frame.payload.conversation_id;
          const pending = pendingReadAcksRef.current.get(conversationId);
          if (pending) {
            pending.retryAfterDelivery = true;
          }
          if (reloadHistory) {
            void reloadHistory(conversationId).then((caughtUpSeq) => {
              if (caughtUpSeq !== null) {
                sendDeliveredAck?.(conversationId, caughtUpSeq);
              }
            });
          }
        }
        return;
      case "conversation_receipt_updated":
        handleReceiptUpdated(frame);
    }
  }, [handleMessageCreated, handleReceiptUpdated, handleSendMessageRejected, handleServerAccepted, reloadHistory, sendDeliveredAck, updateData]);

  return {
    send,
    retry,
    handleServerAccepted,
    handleSendMessageRejected,
    handleMessageCreated,
    markReadThrough,
    handleServerFrame,
  };
}

function updateConversationCursors(
  data: ChatData,
  conversationId: number,
  cursors: Partial<Pick<NonNullable<ChatData["conversations"][number]>, "deliveredSeq" | "readSeq" | "peerDeliveredSeq" | "peerReadSeq">>,
): ChatData {
  const conversation = data.conversations[conversationId];
  if (!conversation) {
    return data;
  }
  const next = {
    ...conversation,
    ...cursors,
    deliveredSeq: Math.max(conversation.deliveredSeq ?? 0, cursors.deliveredSeq ?? 0),
    readSeq: Math.max(conversation.readSeq ?? 0, cursors.readSeq ?? 0),
    peerDeliveredSeq: Math.max(conversation.peerDeliveredSeq ?? 0, cursors.peerDeliveredSeq ?? 0),
    peerReadSeq: Math.max(conversation.peerReadSeq ?? 0, cursors.peerReadSeq ?? 0),
  };
  next.messages = next.messages.map((message) => ({
    ...message,
    receipt: message.senderUserId === data.self.userId && message.conversationSeq !== null
      ? message.conversationSeq <= (next.peerReadSeq ?? 0)
        ? "已读"
        : message.conversationSeq <= (next.peerDeliveredSeq ?? 0) ? "已送达" : undefined
      : undefined,
  }));
  return { ...data, conversations: { ...data.conversations, [conversationId]: next } };
}

function createClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
