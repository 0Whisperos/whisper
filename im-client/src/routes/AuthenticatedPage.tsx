import { useChatConnection } from "../features/chat-connection/hooks/useChatConnection";
import type { ChatConnectionState } from "../features/chat-connection/types";
import type { AuthSession } from "../features/login/types";

interface AuthenticatedPageProps {
  session: AuthSession;
  refreshSession: () => Promise<AuthSession | null>;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ session, refreshSession, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  const chatConnection = useChatConnection({ session, refreshSession });

  function handleLogout() {
    chatConnection.close();
    onLogout();
  }

  return (
    <main className="status-page">
      <section className="status-content" aria-label="已登录">
        <h1>已登录</h1>
        <p>聊天服务：{session.imChatWsUrl}</p>
        <p>{describeChatConnection(chatConnection.state)}</p>
        <button type="button" onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? "退出中" : "退出登录"}
        </button>
      </section>
    </main>
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
