import { useRef } from "react";

import { useChatConnection } from "../features/chat-connection/hooks/useChatConnection";
import type { ChatBusinessServerFrame, ChatConnectionState } from "../features/chat-connection/types";
import { AuthenticatedShell } from "../features/chat/components/AuthenticatedShell";
import { useChatData } from "../features/chat/hooks/useChatData";
import { useChatMessaging } from "../features/chat/hooks/useChatMessaging";
import type { AuthSession } from "../features/login/types";

interface AuthenticatedPageProps {
  apiBaseUrl: string;
  session: AuthSession;
  refreshSession: () => Promise<AuthSession | null>;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ apiBaseUrl, session, refreshSession, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  const chatData = useChatData(apiBaseUrl, session);
  const serverFrameHandlerRef = useRef<(frame: ChatBusinessServerFrame) => void>(() => undefined);
  const chatConnection = useChatConnection({
    session,
    refreshSession,
    onServerFrame: (frame) => serverFrameHandlerRef.current(frame),
  });
  const messaging = useChatMessaging({
    data: chatData.data,
    updateData: chatData.updateData,
    sendTextMessage: chatConnection.sendTextMessage,
  });
  serverFrameHandlerRef.current = messaging.handleServerFrame;

  const canSendMessages = chatConnection.state.status === "authenticated";

  function handleSendText(conversationId: number, text: string): boolean {
    return messaging.send(conversationId, text);
  }

  function handleRetryMessage(clientMessageId: string) {
    messaging.retry(clientMessageId);
  }

  function handleLogout() {
    chatConnection.close();
    onLogout();
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
      retryConversationHistory={chatData.retryHistory}
      loadingConversationId={chatData.loadingConversationId}
      getConversationHistoryError={chatData.historyError}
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
      return "登录凭证已过期，正在刷新聊天连接";
    case "auth_failed":
      return `聊天连接认证失败：${state.errorCode}`;
    case "closed":
      return "聊天连接已关闭";
    case "error":
      return "聊天连接异常";
  }
}
