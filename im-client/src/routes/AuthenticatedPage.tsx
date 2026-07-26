interface AuthenticatedPageProps {
  account: string;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedPage({ account, isLoggingOut, onLogout }: AuthenticatedPageProps) {
  return (
    <main className="status-page">
      <section className="status-content" aria-label="已登录">
        <h1>已登录</h1>
        <p>账号：{account}</p>
        <button type="button" onClick={onLogout} disabled={isLoggingOut}>
          {isLoggingOut ? "退出中" : "退出登录"}
        </button>
      </section>
    </main>
  );
}
