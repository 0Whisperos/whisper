interface AuthenticatedPageProps {
  imChatWsUrl: string;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ imChatWsUrl, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  return (
    <main className="status-page">
      <section className="status-content" aria-label="已登录">
        <h1>已登录</h1>
        <p>聊天服务：{imChatWsUrl}</p>
        <button type="button" onClick={onLogout} disabled={isLoggingOut}>
          {isLoggingOut ? "退出中" : "退出登录"}
        </button>
      </section>
    </main>
  );
}
