import { useCallback, useEffect, useRef, useState } from "react";

import { useChatConnection } from "../features/chat-connection/hooks/useChatConnection";
import type { ChatBusinessServerFrame, ChatConnectionState } from "../features/chat-connection/types";
import { AuthenticatedShell } from "../features/chat/components/AuthenticatedShell";
import { AvatarResourceCache } from "../features/chat/avatarResourceCache";
import { AttachmentResourceCache } from "../features/chat/attachmentResourceCache";
import { useChatData } from "../features/chat/hooks/useChatData";
import { useChatMessaging } from "../features/chat/hooks/useChatMessaging";
import { useMessageRecall } from "../features/chat/hooks/useMessageRecall";
import { useRecallStatusSync, type RecallTarget } from "../features/chat/hooks/useRecallStatusSync";
import { saveCurrentProfile } from "../features/chat/profileApi";
import type { ChatContentBlock, ChatReplyTarget, EditableSelfProfile } from "../features/chat/types";
import type { ForwardMessageBody } from "../features/chat/messageForwarding";
import type { AuthSession } from "../features/login/types";
import { useFriendRequests } from "../features/chat/hooks/useFriendRequests";
import { imageViewerCoordinator } from "../features/image-viewer/coordinator";
import { useImageViewerLifecycle } from "./useImageViewerLifecycle";

const EMPTY_RECALL_TARGETS: RecallTarget[] = [];

interface AuthenticatedPageProps {
  apiBaseUrl: string;
  session: AuthSession;
  refreshSession: () => Promise<AuthSession | null>;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ apiBaseUrl, session, refreshSession, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  const owner = `${apiBaseUrl.replace(/\/+$/, "")}:${session.userId}`;
  const currentOwnerRef = useRef(owner);
  currentOwnerRef.current = owner;
  const chatData = useChatData(apiBaseUrl, session);
  const avatarResourceCacheRef = useRef<AvatarResourceCache | null>(null);
  if (!avatarResourceCacheRef.current) {
    avatarResourceCacheRef.current = new AvatarResourceCache();
  }
  const avatarResourceCache = avatarResourceCacheRef.current;
  const attachmentResourceCacheRef = useRef<AttachmentResourceCache | null>(null);
  if (!attachmentResourceCacheRef.current) attachmentResourceCacheRef.current = new AttachmentResourceCache();
  const attachmentResourceCache = attachmentResourceCacheRef.current;
  useImageViewerLifecycle(apiBaseUrl, session.userId, chatData.data?.conversations, session.accessToken, attachmentResourceCache);
  const serverFrameHandlerRef = useRef<(frame: ChatBusinessServerFrame) => void>(() => undefined);
  const chatConnection = useChatConnection({
    owner,
    session,
    refreshSession,
    onServerFrame: (frame) => serverFrameHandlerRef.current(frame),
  });
  const friendRequests = useFriendRequests(apiBaseUrl, session.accessToken, chatConnection.state.status === "authenticated");
  const pendingDeliveredAcksRef = useRef(new Map<number, number>());
  const pendingReadAcksRef = useRef(new Map<number, number>());
  useEffect(() => () => {
    avatarResourceCache.clear();
    attachmentResourceCache.clear();
  }, [attachmentResourceCache, avatarResourceCache]);
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
    sendRichMessage: chatConnection.sendRichMessage,
    sendDeliveredAck,
    sendReadAck,
    reloadHistory: chatData.retryHistory,
  });
  const [draftRecallState, setDraftRecallState] = useState<{ owner: string; targets: RecallTarget[] }>(() => ({ owner, targets: [] }));
  const draftRecallTargets = draftRecallState.owner === owner ? draftRecallState.targets : EMPTY_RECALL_TARGETS;
  const updateDraftRecallTargets = useCallback((targets: RecallTarget[]) => {
    if (currentOwnerRef.current !== owner) return;
    setDraftRecallState((previous) => previous.owner === owner && JSON.stringify(previous.targets) === JSON.stringify(targets)
      ? previous : { owner, targets });
  }, [owner]);
  const recall = useMessageRecall({ owner,
    data: chatData.data, canSend: chatConnection.state.status === "authenticated" && !isLoggingOut,
    sendRecall: chatConnection.sendRecallMessage, mergeRecalls: chatData.mergeRecalls });
  const recallSync = useRecallStatusSync({ apiBaseUrl, userId: session.userId, accessToken: session.accessToken,
    connectionId: chatConnection.state.status === "authenticated" ? chatConnection.state.connectionId : null,
    data: chatData.data, draftTargets: draftRecallTargets, mergeRecalls: chatData.mergeRecalls });
  serverFrameHandlerRef.current = (frame) => {
    if (recall.handleFrame(frame)) return;
    if (frame.type === "friend_request_updated") {
      void friendRequests.refresh();
      void chatData.refreshFriends();
      return;
    }
    messaging.handleServerFrame(frame);
  };

  const canSendMessages = chatConnection.state.status === "authenticated";

  function handleSendText(conversationId: number, text: string, replyTo?: ChatReplyTarget | null): boolean {
    if (!canSendMessages) return false;
    return messaging.send(conversationId, text, replyTo);
  }

  function handleSendRich(conversationId: number, blocks: ChatContentBlock[], replyTo?: ChatReplyTarget | null): string | null {
    if (chatConnection.state.status !== "authenticated") return null;
    return messaging.sendRich(conversationId, blocks, replyTo);
  }

  function handleRetryMessage(clientMessageId: string) {
    if (!canSendMessages || isLoggingOut) return;
    messaging.retry(clientMessageId);
  }

  function handleForwardMessage(conversationId: number, body: ForwardMessageBody): string | null {
    if (!canSendMessages || isLoggingOut) return null;
    return messaging.forward(conversationId, body);
  }

  function handleLogout() {
    chatConnection.close();
    avatarResourceCache.clear();
    attachmentResourceCache.clear();
    void imageViewerCoordinator.close().catch(() => undefined).then(onLogout);
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
      canSendMessages={canSendMessages && !isLoggingOut}
      isLoggingOut={isLoggingOut}
      onLogout={handleLogout}
      onSendText={handleSendText}
      onSendRich={handleSendRich}
      onForwardMessage={handleForwardMessage}
      onRetryMessage={handleRetryMessage}
      onRecallMessage={recall.recall}
      pendingRecallIds={recall.pendingIds}
      recallFeedback={recall.feedback}
      recallSyncError={recallSync.error}
      onRetryRecallSync={recallSync.retry}
      onReplyTargetsChange={updateDraftRecallTargets}
      loadConversationHistory={chatData.loadHistory}
      loadOlderConversationHistory={chatData.loadOlderHistory}
      hasMoreConversationHistory={chatData.hasMoreHistory}
      onDeliveredAck={sendDeliveredAck}
      onReadAck={messaging.markReadThrough}
      retryConversationHistory={(conversationId) => { void chatData.retryHistory(conversationId); recallSync.retry(); }}
      loadingConversationId={chatData.loadingConversationId}
      getConversationHistoryError={chatData.historyError}
      friendRequests={friendRequests}
      onRefreshFriends={chatData.refreshFriends}
      apiBaseUrl={apiBaseUrl}
      accessToken={session.accessToken}
      avatarResourceCache={avatarResourceCache}
      attachmentResourceCache={attachmentResourceCache}
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
