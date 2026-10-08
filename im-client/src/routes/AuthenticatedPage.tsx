import { useCallback, useEffect, useRef } from "react";

import { useChatConnection } from "../features/chat-connection/hooks/useChatConnection";
import type { ChatBusinessServerFrame, ChatConnectionState } from "../features/chat-connection/types";
import { AuthenticatedShell } from "../features/chat/components/AuthenticatedShell";
import { AvatarResourceCache } from "../features/chat/avatarResourceCache";
import { useChatData } from "../features/chat/hooks/useChatData";
import { useChatMessaging } from "../features/chat/hooks/useChatMessaging";
import { saveCurrentProfile } from "../features/chat/profileApi";
import type { EditableSelfProfile } from "../features/chat/types";
import type { AuthSession } from "../features/login/types";
import { useFriendRequests } from "../features/chat/hooks/useFriendRequests";

interface AuthenticatedPageProps {
  apiBaseUrl: string;
  session: AuthSession;
  refreshSession: () => Promise<AuthSession | null>;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ apiBaseUrl, session, refreshSession, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  const chatData = useChatData(apiBaseUrl, session);
  const avatarResourceCacheRef = useRef<AvatarResourceCache | null>(null);
  if (!avatarResourceCacheRef.current) {
    avatarResourceCacheRef.current = new AvatarResourceCache();
  }
  const avatarResourceCache = avatarResourceCacheRef.current;
  const serverFrameHandlerRef = useRef<(frame: ChatBusinessServerFrame) => void>(() => undefined);
  const chatConnection = useChatConnection({
    session,
    refreshSession,
    onServerFrame: (frame) => serverFrameHandlerRef.current(frame),
  });
  const friendRequests = useFriendRequests(apiBaseUrl, session.accessToken, chatConnection.state.status === "authenticated");
  const pendingDeliveredAcksRef = useRef(new Map<number, number>());
  const pendingReadAcksRef = useRef(new Map<number, number>());
  useEffect(() => () => avatarResourceCache.clear(), [avatarResourceCache]);
  const sendDeliveredAck = useCallback((conversationId: number, deliveredSeq: number) => {
    if (chatConnection.state.status === "authenticated") {
      chatConnection.sendDeliveredAck(conversationId, deliveredSeq);
      return;
    }
    const pendingSeq = pendingDeliveredAcksRef.current.get(conversationId) ?? 0;
    pendingDeliveredAcksRef.current.set(conversationId, Math.max(pendingSeq, deliveredSeq));
  }, [chatConnection.sendDeliveredAck, chatConnection.state.status]);
  const sendReadAck = useCallback((conversationId: number, readSeq: number) => {
    if (chatConnection.state.status === "authenticated") {
      chatConnection.sendReadAck(conversationId, readSeq);
      return;
    }
    const pendingSeq = pendingReadAcksRef.current.get(conversationId) ?? 0;
    pendingReadAcksRef.current.set(conversationId, Math.max(pendingSeq, readSeq));
  }, [chatConnection.sendReadAck, chatConnection.state.status]);
  useEffect(() => {
    if (chatConnection.state.status !== "authenticated") {
      return;
    }
    for (const [conversationId, deliveredSeq] of pendingDeliveredAcksRef.current) {
      try {
        chatConnection.sendDeliveredAck(conversationId, deliveredSeq);
        pendingDeliveredAcksRef.current.delete(conversationId);
      } catch {
        break;
      }
    }
    for (const [conversationId, readSeq] of pendingReadAcksRef.current) {
      try {
        chatConnection.sendReadAck(conversationId, readSeq);
        pendingReadAcksRef.current.delete(conversationId);
      } catch {
        break;
      }
    }
  }, [chatConnection.sendDeliveredAck, chatConnection.sendReadAck, chatConnection.state.status]);
  const messaging = useChatMessaging({
    data: chatData.data,
    updateData: chatData.updateData,
    sendTextMessage: chatConnection.sendTextMessage,
    sendDeliveredAck,
    sendReadAck,
    reloadHistory: chatData.retryHistory,
  });
  serverFrameHandlerRef.current = (frame) => {
    if (frame.type === "friend_request_updated") {
      void friendRequests.refresh();
      void chatData.refreshFriends();
      return;
    }
    messaging.handleServerFrame(frame);
  };

  const canSendMessages = chatConnection.state.status === "authenticated";

  function handleSendText(conversationId: number, text: string): boolean {
    return messaging.send(conversationId, text);
  }

  function handleRetryMessage(clientMessageId: string) {
    messaging.retry(clientMessageId);
  }

  function handleLogout() {
    chatConnection.close();
    avatarResourceCache.clear();
    onLogout();
  }

  async function handleSaveProfile(profile: EditableSelfProfile) {
    const updatedProfile = await saveCurrentProfile(apiBaseUrl, session.accessToken, {
      nickname: profile.name,
      signature: profile.signature,
      avatar: profile.avatar,
    });
    if (profile.avatar.action === "replace" && updatedProfile.avatarObjectKey) {
      avatarResourceCache.prime(updatedProfile.avatarObjectKey, profile.avatar.file);
    }
    chatData.updateSelfProfile(updatedProfile);
  }

  if (chatData.isLoading) {
    return <main className="status-page">正在加载好友和聊天数据...</main>;
  }

  if (chatData.error || !chatData.data) {
    return (
      <main className="status-page">
        <p>好友和聊天数据加载失败（{chatData.error?.code ?? "internal_error"}）</p>
        <button type="button" onClick={() => void chatData.retry()}>重试</button>
      </main>
    );
  }

  return (
    <AuthenticatedShell
      data={chatData.data}
      connectionLabel={describeChatConnection(chatConnection.state)}
      canSendMessages={canSendMessages}
      isLoggingOut={isLoggingOut}
      onLogout={handleLogout}
      onSendText={handleSendText}
      onRetryMessage={handleRetryMessage}
      loadConversationHistory={chatData.loadHistory}
      loadOlderConversationHistory={chatData.loadOlderHistory}
      hasMoreConversationHistory={chatData.hasMoreHistory}
      onDeliveredAck={sendDeliveredAck}
      onReadAck={messaging.markReadThrough}
      retryConversationHistory={chatData.retryHistory}
      loadingConversationId={chatData.loadingConversationId}
      getConversationHistoryError={chatData.historyError}
      friendRequests={friendRequests}
      onRefreshFriends={chatData.refreshFriends}
      apiBaseUrl={apiBaseUrl}
      accessToken={session.accessToken}
      avatarResourceCache={avatarResourceCache}
      onSaveProfile={handleSaveProfile}
    />
  );
}

function describeChatConnection(state: ChatConnectionState): string {
  switch (state.status) {
    case "idle":
      return "聊天连接待启动";
    case "connecting":
      return "正在连接聊天服务";
    case "authenticating":
      return "正在认证聊天连接";
    case "authenticated":
      return `聊天连接在线：${state.connectionId}`;
    case "refreshing":
      return "正在续期登录凭证并恢复聊天连接";
    case "auth_failed":
      return `聊天连接认证失败：${state.errorCode}`;
    case "closed":
      return "聊天连接已关闭";
    case "error":
      return "聊天连接异常";
  }
}
