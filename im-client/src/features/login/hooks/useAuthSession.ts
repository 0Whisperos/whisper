import { useCallback, useState } from "react";

import { logout as requestLogout } from "../api";
import type { AuthSession } from "../types";

export function useAuthSession(apiBaseUrl: string) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    if (!session) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await requestLogout(apiBaseUrl, session.accessToken);
    } catch {
      // Local authentication state must be cleared even when the request cannot reach the server.
    } finally {
      setSession(null);
      setIsLoggingOut(false);
    }
  }, [apiBaseUrl, session]);

  return { session, setSession, isLoggingOut, logout };
}
