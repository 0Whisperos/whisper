import { useEffect, useRef, useState } from "react";

import { loadClientConfig } from "./features/client-config/api";
import type { ClientConfig } from "./features/client-config/types";
import { useAuthSession } from "./features/login/hooks/useAuthSession";
import { AuthenticatedPage } from "./routes/AuthenticatedPage";
import { LoginPage } from "./routes/LoginPage";
import { destroyAppWindow, listenAppCloseRequested } from "./shared/tauri/appWindow";

export function App() {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [hasConfigError, setHasConfigError] = useState(false);
  const {
    session,
    savedUsers,
    credentialWarning,
    authenticateWithPassword,
    loginSavedUser,
    refreshSession,
    isLoadingSavedUsers,
    isLoggingOut,
    logout,
    cleanupBeforeAppClose,
  } = useAuthSession(config?.apiBaseUrl ?? "");
  const isDestroyingWindowRef = useRef(false);

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

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listenAppCloseRequested(async (event) => {
      event.preventDefault();
      if (isDestroyingWindowRef.current) {
        return;
      }
      isDestroyingWindowRef.current = true;
      try {
        await cleanupBeforeAppClose();
      } catch {
        // Window closing is best-effort cleanup; the app should still close.
      } finally {
        await destroyAppWindow().catch(() => undefined);
      }
    })
      .then((nextUnlisten) => {
        if (isDisposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [cleanupBeforeAppClose]);

  if (isConfigLoading) {
    return <main className="status-page">正在加载客户端配置...</main>;
  }
  if (hasConfigError || !config) {
    return <main className="status-page">客户端配置无效，请修正后重新启动 Whisper</main>;
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
  return (
    <LoginPage
      savedUsers={savedUsers}
      credentialWarning={credentialWarning}
      isLoadingSavedUsers={isLoadingSavedUsers}
      onPasswordLogin={authenticateWithPassword}
      onSavedUserLogin={loginSavedUser}
    />
  );
}
