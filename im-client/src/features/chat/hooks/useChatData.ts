import { useCallback, useEffect, useRef, useState } from "react";

import { ChatApiError, loadConversationMessages, loadCurrentUser, loadFriends } from "../api";
import type {
  AvatarTone,
  ChatConversation,
  ChatData,
  ChatFriendDto,
  ChatMessage,
  ChatMessageDto,
  ChatProfile,
  ChatSessionItem,
} from "../types";
import type { AuthSession } from "../../login/types";
import { mergeOfficialMessage, toAcceptedTimelineMessage } from "./messageTimeline";

const AVATAR_TONES: AvatarTone[] = ["blue", "teal", "gold", "orange", "purple", "rose", "green", "gray"];

export function useChatData(apiBaseUrl: string, session: AuthSession) {
  const [data, setData] = useState<ChatData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ChatApiError | null>(null);
  const [loadingConversationId, setLoadingConversationId] = useState<number | null>(null);
  const [historyErrors, setHistoryErrors] = useState<Record<number, ChatApiError>>({});
  const [historyAvailability, setHistoryAvailability] = useState<Record<number, boolean>>({});
  const loadedConversationIdsRef = useRef(new Set<number>());
  const loadingPromisesRef = useRef(new Map<number, Promise<number | null>>());
  const historyCursorsRef = useRef(new Map<number, number | null>());
  const historyAvailabilityRef = useRef(new Map<number, boolean>());
  const historyErrorKindsRef = useRef(new Map<number, "initial" | "older">());
  const generationRef = useRef(0);

  const loadInitialData = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsLoading(true);
    setError(null);
    setData(null);
    loadedConversationIdsRef.current.clear();
    loadingPromisesRef.current.clear();
    historyCursorsRef.current.clear();
    historyAvailabilityRef.current.clear();
    historyErrorKindsRef.current.clear();
    setHistoryAvailability({});
    setHistoryErrors({});

    try {
      const [me, friends] = await Promise.all([
        loadCurrentUser(apiBaseUrl, session.accessToken),
        loadFriends(apiBaseUrl, session.accessToken),
      ]);
      if (generation !== generationRef.current) {
        return;
      }
      setData(buildChatData(me, friends));
    } catch (caught) {
      if (generation !== generationRef.current) {
        return;
      }
      setError(caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"));
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, [apiBaseUrl, session.accessToken]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const loadHistory = useCallback(async (conversationId: number): Promise<number | null> => {
    if (!data || loadedConversationIdsRef.current.has(conversationId)) {
      return null;
    }
    const existingRequest = loadingPromisesRef.current.get(conversationId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      const requestGeneration = generationRef.current;
      setLoadingConversationId(conversationId);
      setHistoryErrors((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      try {
        const page = await loadConversationMessages(apiBaseUrl, session.accessToken, conversationId, { limit: 50 });
        if (requestGeneration !== generationRef.current) {
          return null;
        }
        const pages = [page];
        const savedDeliveredSeq = Math.max(page.deliveredSeq, data.conversations[conversationId]?.deliveredSeq ?? 0);
        let deliveredSeq = savedDeliveredSeq;
        let expectedSeq = deliveredSeq + 1;
        while (expectedSeq <= page.lastSeq) {
          const missingPage = await loadConversationMessages(apiBaseUrl, session.accessToken, conversationId, {
            fromSeq: expectedSeq,
            limit: 50,
          });
          if (requestGeneration !== generationRef.current) {
            return null;
          }
          if (missingPage.messages.length === 0) {
            break;
          }
          const orderedMessages = [...missingPage.messages].sort((left, right) => left.conversationSeq - right.conversationSeq);
          pages.push(missingPage);
          const firstExpectedSeq = expectedSeq;
          for (const message of orderedMessages) {
            if (message.conversationSeq !== expectedSeq) {
              break;
            }
            deliveredSeq = message.conversationSeq;
            expectedSeq += 1;
          }
          if (expectedSeq === firstExpectedSeq) {
            break;
          }
        }
        const incomingMessages = pages.flatMap((currentPage) => currentPage.messages.map(toChatMessage));
        const oldestSequence = page.nextBeforeSeq ?? page.messages[0]?.conversationSeq ?? null;
        historyCursorsRef.current.set(conversationId, oldestSequence);
        historyAvailabilityRef.current.set(conversationId, page.hasMore && oldestSequence !== null);
        historyErrorKindsRef.current.delete(conversationId);
        setHistoryAvailability((current) => ({
          ...current,
          [conversationId]: page.hasMore && oldestSequence !== null,
        }));
        setData((current) => {
          if (!current?.conversations[conversationId]) {
            return current;
          }
          const merged = mergeConversationMessages(current, conversationId, incomingMessages);
          return {
            ...merged,
            conversations: {
              ...merged.conversations,
              [conversationId]: {
                ...merged.conversations[conversationId],
                lastSeq: Math.max(merged.conversations[conversationId].lastSeq ?? 0, page.lastSeq),
                deliveredSeq: Math.max(merged.conversations[conversationId].deliveredSeq ?? 0, page.deliveredSeq),
                readSeq: Math.max(merged.conversations[conversationId].readSeq ?? 0, page.readSeq),
                peerDeliveredSeq: Math.max(merged.conversations[conversationId].peerDeliveredSeq ?? 0, page.peerDeliveredSeq),
                peerReadSeq: Math.max(merged.conversations[conversationId].peerReadSeq ?? 0, page.peerReadSeq),
                messages: merged.conversations[conversationId].messages.map((message) => ({
                  ...message,
                  receipt: message.senderUserId === merged.self.userId && message.conversationSeq !== null
                    ? message.conversationSeq <= Math.max(merged.conversations[conversationId].peerReadSeq ?? 0, page.peerReadSeq)
                      ? "已读"
                      : message.conversationSeq <= Math.max(merged.conversations[conversationId].peerDeliveredSeq ?? 0, page.peerDeliveredSeq) ? "已送达" : undefined
                    : undefined,
                })),
              },
            },
          };
        });
        loadedConversationIdsRef.current.add(conversationId);
        return deliveredSeq > savedDeliveredSeq ? deliveredSeq : null;
      } catch (caught) {
        if (requestGeneration !== generationRef.current) {
          return null;
        }
        historyErrorKindsRef.current.set(conversationId, "initial");
        setHistoryErrors((current) => ({
          ...current,
          [conversationId]: caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"),
        }));
        return null;
      } finally {
        if (requestGeneration === generationRef.current) {
          loadingPromisesRef.current.delete(conversationId);
          setLoadingConversationId((current) => current === conversationId ? null : current);
        }
      }
    })();
    loadingPromisesRef.current.set(conversationId, request);
    return request;
  }, [apiBaseUrl, data, session.accessToken]);

  const loadOlderHistory = useCallback(async (conversationId: number): Promise<number | null> => {
    if (!data || !loadedConversationIdsRef.current.has(conversationId)
      || !historyAvailabilityRef.current.get(conversationId)) {
      return null;
    }
    const existingRequest = loadingPromisesRef.current.get(conversationId);
    if (existingRequest) {
      return existingRequest;
    }
    const beforeSeq = historyCursorsRef.current.get(conversationId);
    if (beforeSeq === null || beforeSeq === undefined) {
      historyAvailabilityRef.current.set(conversationId, false);
      setHistoryAvailability((current) => ({ ...current, [conversationId]: false }));
      return null;
    }

    const request = (async () => {
      const requestGeneration = generationRef.current;
      setLoadingConversationId(conversationId);
      setHistoryErrors((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      try {
        const page = await loadConversationMessages(apiBaseUrl, session.accessToken, conversationId, {
          beforeSeq,
          limit: 50,
        });
        if (requestGeneration !== generationRef.current) {
          return null;
        }
        const incomingMessages = page.messages.map(toChatMessage);
        const nextBeforeSeq = page.nextBeforeSeq ?? page.messages[0]?.conversationSeq ?? null;
        const hasMore = page.hasMore && nextBeforeSeq !== null && nextBeforeSeq < beforeSeq;
        historyCursorsRef.current.set(conversationId, nextBeforeSeq);
        historyAvailabilityRef.current.set(conversationId, hasMore);
        historyErrorKindsRef.current.delete(conversationId);
        setHistoryAvailability((current) => ({ ...current, [conversationId]: hasMore }));
        setData((current) => {
          if (!current?.conversations[conversationId]) {
            return current;
          }
          const merged = mergeConversationMessages(current, conversationId, incomingMessages);
          const conversation = merged.conversations[conversationId];
          return {
            ...merged,
            conversations: {
              ...merged.conversations,
              [conversationId]: {
                ...conversation,
                lastSeq: Math.max(conversation.lastSeq ?? 0, page.lastSeq),
                deliveredSeq: Math.max(conversation.deliveredSeq ?? 0, page.deliveredSeq),
                readSeq: Math.max(conversation.readSeq ?? 0, page.readSeq),
                peerDeliveredSeq: Math.max(conversation.peerDeliveredSeq ?? 0, page.peerDeliveredSeq),
                peerReadSeq: Math.max(conversation.peerReadSeq ?? 0, page.peerReadSeq),
                messages: conversation.messages.map((message) => ({
                  ...message,
                  receipt: message.senderUserId === merged.self.userId && message.conversationSeq !== null
                    ? message.conversationSeq <= Math.max(conversation.peerReadSeq ?? 0, page.peerReadSeq)
                      ? "已读"
                      : message.conversationSeq <= Math.max(conversation.peerDeliveredSeq ?? 0, page.peerDeliveredSeq) ? "已送达" : undefined
                    : undefined,
                })),
              },
            },
          };
        });
      } catch (caught) {
        if (requestGeneration !== generationRef.current) {
          return null;
        }
        historyErrorKindsRef.current.set(conversationId, "older");
        setHistoryErrors((current) => ({
          ...current,
          [conversationId]: caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"),
        }));
      } finally {
        if (requestGeneration === generationRef.current) {
          loadingPromisesRef.current.delete(conversationId);
          setLoadingConversationId((current) => current === conversationId ? null : current);
        }
      }
      return null;
    })();
    loadingPromisesRef.current.set(conversationId, request);
    return request;
  }, [apiBaseUrl, data, session.accessToken]);

  const retryHistory = useCallback((conversationId: number) => {
    if (historyErrorKindsRef.current.get(conversationId) === "older") {
      return loadOlderHistory(conversationId);
    }
    loadedConversationIdsRef.current.delete(conversationId);
    return loadHistory(conversationId);
  }, [loadHistory, loadOlderHistory]);

  const updateData = useCallback((updater: (current: ChatData | null) => ChatData | null) => {
    setData(updater);
  }, []);

  return {
    data,
    isLoading,
    error,
    retry: loadInitialData,
    loadHistory,
    loadOlderHistory,
    retryHistory,
    updateData,
    loadingConversationId,
    historyError: (conversationId: number) => historyErrors[conversationId] ?? null,
    hasMoreHistory: (conversationId: number) => historyAvailability[conversationId] ?? false,
  };
}

function buildChatData(me: {
  userId: number;
  account: string;
  nickname: string;
  signature: string;
  avatarObjectKey: string | null;
}, friends: ChatFriendDto[]): ChatData {
  const self = toSelfProfile(me);
  const contacts = friends.map((friend, index) => toContact(friend, index));
  const sessions: ChatSessionItem[] = [];
  const conversations: Record<number, ChatConversation> = {};

  for (const contact of contacts) {
    if (contact.conversationId === undefined) {
      continue;
    }
    const profile: ChatProfile = {
      userId: contact.userId,
      name: contact.name,
      avatar: contact.avatar,
      tone: contact.tone,
      signature: contact.signature,
      avatarObjectKey: contact.avatarObjectKey,
    };
    sessions.push({
      id: `conversation-${contact.conversationId}`,
      conversationId: contact.conversationId,
      name: contact.name,
      avatar: contact.avatar,
      tone: contact.tone,
      type: "direct",
      preview: "暂无消息",
      time: "",
    });
    conversations[contact.conversationId] = {
      conversationId: contact.conversationId,
      type: "direct",
      name: contact.name,
      avatar: contact.avatar,
      tone: contact.tone,
      status: "状态未知",
      participants: { [profile.userId]: profile },
      messages: [],
      lastSeq: 0,
      deliveredSeq: 0,
      readSeq: 0,
      peerDeliveredSeq: 0,
      peerReadSeq: 0,
    };
  }

  return {
    self,
    sessions,
    conversations,
    contacts,
    contactSections: [{ id: "friends", label: "好友" }],
  };
}

function toSelfProfile(profile: { userId: number; account: string; nickname: string; signature: string; avatarObjectKey: string | null }) {
  const name = displayName(profile.nickname, profile.account);
  return {
    userId: profile.userId,
    name,
    avatar: avatarLetter(name),
    tone: toneForUser(profile.userId),
    account: profile.account,
    signature: profile.signature,
    avatarObjectKey: profile.avatarObjectKey,
  };
}

function toContact(friend: ChatFriendDto, index: number) {
  const name = displayName(friend.nickname, friend.account);
  return {
    id: `user-${friend.userId}`,
    userId: friend.userId,
    name,
    avatar: avatarLetter(name),
    tone: AVATAR_TONES[index % AVATAR_TONES.length],
    account: friend.account,
    region: "未提供",
    status: "状态未知",
    conversationId: friend.conversationId ?? undefined,
    section: "friends",
    signature: friend.signature,
    avatarObjectKey: friend.avatarObjectKey,
  };
}

function toChatMessage(message: ChatMessageDto): ChatMessage {
  return toAcceptedTimelineMessage(message);
}

function mergeConversationMessages(data: ChatData, conversationId: number, incoming: ChatMessage[]): ChatData {
  if (!data.conversations[conversationId]) {
    return data;
  }
  const messagesByID = new Map<string, ChatMessage>();
  incoming.forEach((message) => {
    if (message.messageId !== null) {
      messagesByID.set(message.messageId, message);
    }
  });
  return [...messagesByID.values()].reduce((current, message) => {
    if (message.messageId === null || message.conversationSeq === null || message.createdAt === null) {
      return current;
    }
    return mergeOfficialMessage(current, {
      message_id: message.messageId,
      conversation_id: message.conversationId,
      conversation_seq: message.conversationSeq,
      sender_user_id: message.senderUserId,
      client_message_id: message.clientMessageId,
      message_type: message.messageType,
      content: message.content,
      created_at: message.createdAt,
    });
  }, data);
}

function displayName(nickname: string, account: string): string {
  return nickname.trim() || account;
}

function avatarLetter(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}

function toneForUser(userId: number): AvatarTone {
  return AVATAR_TONES[userId % AVATAR_TONES.length];
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatShortTime(value: string): string {
  return formatMessageTime(value);
}
