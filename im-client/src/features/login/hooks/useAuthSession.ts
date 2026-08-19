import { useCallback, useEffect, useState } from "react";

import { AuthApiError, logout as requestLogout, refresh } from "../api";
import { deleteRefreshToken, loadSavedRefreshToken, saveRefreshToken } from "../credentials";
import type { AuthSession } from "../types";

export function useAuthSession(apiBaseUrl: string) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function restoreSession() {
      if (!apiBaseUrl) {
        if (isMounted) {
          setIsRestoringSession(false);
        }
        return;
      }
      try {
        const savedRefreshToken = await loadSavedRefreshToken();
        if (!savedRefreshToken) {
          return;
        }
        const restoredSession = await refresh(apiBaseUrl, savedRefreshToken);
        if (isMounted) {
          setSession(restoredSession);
        }
      } catch (error) {
        if (shouldDeleteSavedRefreshToken(error)) {
          await deleteRefreshToken().catch(() => undefined);
        }
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
        }
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  const acceptSession = useCallback(async (nextSession: AuthSession) => {
    await saveRefreshToken(nextSession.refreshToken);
    setSession(nextSession);
  }, []);

  const refreshSession = useCallback(async (): Promise<AuthSession | null> => {
    if (!session) {
      return null;
    }
    try {
      const nextSession = await refresh(apiBaseUrl, session.refreshToken);
      setSession(nextSession);
      return nextSession;
    } catch (error) {
      if (shouldDeleteSavedRefreshToken(error)) {
        await deleteRefreshToken().catch(() => undefined);
        setSession(null);
      }
      return null;
    }
  }, [apiBaseUrl, session]);

  const logout = useCallback(async () => {
    if (!session) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await requestLogout(apiBaseUrl, session.refreshToken);
    } catch {
      // 主动退出必须清理本地凭证；服务端 Redis token 可能稍后自然过期。
    } finally {
      await deleteRefreshToken().catch(() => undefined);
      setSession(null);
      setIsLoggingOut(false);
    }
  }, [apiBaseUrl, session]);

  return { session, acceptSession, refreshSession, isRestoringSession, isLoggingOut, logout };
}

function shouldDeleteSavedRefreshToken(error: unknown): boolean {
  if (error instanceof AuthApiError) {
    return error.code === "invalid_refresh_token" || error.code === "refresh_token_expired";
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === "invalid_refresh_token" || error.code === "refresh_token_expired";
  }
  return false;
}
