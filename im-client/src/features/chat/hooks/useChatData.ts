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

const AVATAR_TONES: AvatarTone[] = ["blue", "teal", "gold", "orange", "purple", "rose", "green", "gray"];

export function useChatData(apiBaseUrl: string, session: AuthSession) {
  const [data, setData] = useState<ChatData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ChatApiError | null>(null);
  const [loadingConversationId, setLoadingConversationId] = useState<number | null>(null);
  const [historyErrors, setHistoryErrors] = useState<Record<number, ChatApiError>>({});
  const loadedConversationIdsRef = useRef(new Set<number>());
  const loadingPromisesRef = useRef(new Map<number, Promise<void>>());
  const generationRef = useRef(0);

  const loadInitialData = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsLoading(true);
    setError(null);
    setData(null);
    loadedConversationIdsRef.current.clear();
    loadingPromisesRef.current.clear();
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

  const loadHistory = useCallback(async (conversationId: number) => {
    if (!data || loadedConversationIdsRef.current.has(conversationId)) {
      return;
    }
    const existingRequest = loadingPromisesRef.current.get(conversationId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      setLoadingConversationId(conversationId);
      setHistoryErrors((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      try {
        const page = await loadConversationMessages(apiBaseUrl, session.accessToken, conversationId, { limit: 50 });
        const incomingMessages = page.messages.map(toChatMessage);
        setData((current) => current ? mergeConversationMessages(current, conversationId, incomingMessages) : current);
        loadedConversationIdsRef.current.add(conversationId);
      } catch (caught) {
        setHistoryErrors((current) => ({
          ...current,
          [conversationId]: caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"),
        }));
      } finally {
        loadingPromisesRef.current.delete(conversationId);
        setLoadingConversationId((current) => current === conversationId ? null : current);
      }
    })();
    loadingPromisesRef.current.set(conversationId, request);
    return request;
  }, [apiBaseUrl, data, session.accessToken]);

  const retryHistory = useCallback((conversationId: number) => {
    loadedConversationIdsRef.current.delete(conversationId);
    return loadHistory(conversationId);
  }, [loadHistory]);

  return {
    data,
    isLoading,
    error,
    retry: loadInitialData,
    loadHistory,
    retryHistory,
    loadingConversationId,
    historyError: (conversationId: number) => historyErrors[conversationId] ?? null,
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
  return {
    ...message,
    displayTime: formatMessageTime(message.createdAt),
    showTime: true,
    showAvatar: true,
  };
}

function mergeConversationMessages(data: ChatData, conversationId: number, incoming: ChatMessage[]): ChatData {
  const conversation = data.conversations[conversationId];
  if (!conversation) {
    return data;
  }
  const byId = new Map(conversation.messages.map((message) => [message.messageId, message]));
  incoming.forEach((message) => byId.set(message.messageId, message));
  const messages = Array.from(byId.values()).sort((left, right) => left.conversationSeq - right.conversationSeq);
  const lastMessage = messages[messages.length - 1];
  const sessions = data.sessions.map((session) => session.conversationId === conversationId
    ? {
      ...session,
      preview: lastMessage?.content.text ?? "暂无消息",
      time: lastMessage ? formatShortTime(lastMessage.createdAt) : "",
    }
    : session);
  return {
    ...data,
    sessions,
    conversations: {
      ...data.conversations,
      [conversationId]: { ...conversation, messages },
    },
  };
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
