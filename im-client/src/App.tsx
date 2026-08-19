import { useEffect, useState } from "react";

import { loadClientConfig } from "./features/client-config/api";
import type { ClientConfig } from "./features/client-config/types";
import { useAuthSession } from "./features/login/hooks/useAuthSession";
import { AuthenticatedPage } from "./routes/AuthenticatedPage";
import { LoginPage } from "./routes/LoginPage";

export function App() {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [hasConfigError, setHasConfigError] = useState(false);
  const { session, acceptSession, refreshSession, isRestoringSession, isLoggingOut, logout } = useAuthSession(config?.apiBaseUrl ?? "");

  useEffect(() => {
    let isMounted = true;
    void loadClientConfig()
      .then((loadedConfig) => {
        if (isMounted) {
          setConfig(loadedConfig);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasConfigError(true);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsConfigLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (isConfigLoading) {
    return <main className="status-page">正在加载客户端配置...</main>;
  }
  if (hasConfigError || !config) {
    return <main className="status-page">客户端配置无效，请修正后重新启动 Whisper</main>;
  }
  if (isRestoringSession) {
    return <main className="status-page">正在恢复登录状态...</main>;
  }
  if (session) {
    return (
      <AuthenticatedPage
        session={session}
        refreshSession={refreshSession}
        isLoggingOut={isLoggingOut}
        onLogout={() => void logout()}
      />
    );
  }
  return <LoginPage apiBaseUrl={config.apiBaseUrl} onAuthenticated={acceptSession} />;
}
