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
}

const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 15_000;

export function useChatMessaging({
  data,
  updateData,
  sendTextMessage,
  clientMessageIdFactory = createClientMessageId,
  now = () => new Date(),
  acknowledgementTimeoutMs = DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
}: UseChatMessagingOptions) {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dataRef = useRef(data);
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
  }, [clearAcknowledgementTimer, updateData]);

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
    }
  }, [handleMessageCreated, handleSendMessageRejected, handleServerAccepted]);

  return {
    send,
    retry,
    handleServerAccepted,
    handleSendMessageRejected,
    handleMessageCreated,
    handleServerFrame,
  };
}

function createClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
