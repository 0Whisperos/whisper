import { useCallback, useEffect, useState } from "react";

import { AuthApiError, login, logout as requestLogout, refresh } from "../api";
import { deleteRefreshToken, listSavedUsers, loadSavedRefreshToken, saveRefreshToken } from "../credentials";
import type { AuthSession, RefreshTokenPersistence, SavedUser } from "../types";

const READ_WARNING = "无法读取已保存用户。";
const SAVE_WARNING = "自动登录未保存，请稍后重试。";
const DELETE_WARNING = "未能清理本地自动登录凭据，请稍后重试。";

export function useAuthSession(apiBaseUrl: string) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [savedUsers, setSavedUsers] = useState<SavedUser[]>([]);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);
  const [isLoadingSavedUsers, setIsLoadingSavedUsers] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const reloadSavedUsers = useCallback(async () => {
    try {
      setSavedUsers(await listSavedUsers());
    } catch {
      setSavedUsers([]);
      setCredentialWarning(READ_WARNING);
    }
  }, []);

  const deleteSavedUser = useCallback(
    async (userId: number) => {
      await deleteRefreshToken(userId).catch(() => undefined);
      await reloadSavedUsers();
    },
    [reloadSavedUsers],
  );

  const applyAutoLoginPreference = useCallback(
    async (nextSession: AuthSession, account: string, autoLogin: boolean): Promise<RefreshTokenPersistence> => {
      let refreshTokenPersistence: RefreshTokenPersistence = "session_only";
      if (autoLogin) {
        try {
          await saveRefreshToken(nextSession.userId, account, nextSession.refreshToken);
          refreshTokenPersistence = "saved";
        } catch {
          await deleteRefreshToken(nextSession.userId).catch(() => undefined);
          setCredentialWarning(SAVE_WARNING);
        }
      } else {
        try {
          await deleteRefreshToken(nextSession.userId);
        } catch {
          setCredentialWarning(DELETE_WARNING);
        }
      }
      await reloadSavedUsers();
      return refreshTokenPersistence;
    },
    [reloadSavedUsers],
  );

  useEffect(() => {
    let isMounted = true;
    async function loadUsers() {
      if (!apiBaseUrl) {
        if (isMounted) {
          setIsLoadingSavedUsers(false);
        }
        return;
      }
      try {
        const users = await listSavedUsers();
        if (isMounted) {
          setSavedUsers(users);
        }
      } catch {
        if (isMounted) {
          setSavedUsers([]);
          setCredentialWarning(READ_WARNING);
        }
      } finally {
        if (isMounted) {
          setIsLoadingSavedUsers(false);
        }
      }
    }

    void loadUsers();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  const authenticateWithPassword = useCallback(
    async (account: string, password: string, autoLogin: boolean) => {
      setCredentialWarning(null);
      const nextSession = await login(apiBaseUrl, { account, password });
      const refreshTokenPersistence = await applyAutoLoginPreference(nextSession, account, autoLogin);

      setSession({ ...nextSession, refreshTokenPersistence });
    },
    [apiBaseUrl, applyAutoLoginPreference],
  );

  const loginSavedUser = useCallback(
    async (userId: number) => {
      setCredentialWarning(null);
      const savedRefreshToken = await loadSavedRefreshToken(userId);
      if (!savedRefreshToken) {
        await deleteSavedUser(userId);
        throw new AuthApiError("invalid_refresh_token");
      }

      try {
        const nextSession = await refresh(apiBaseUrl, savedRefreshToken);
        setSession({ ...nextSession, refreshTokenPersistence: "saved" });
      } catch (error) {
        if (shouldDeleteSavedRefreshToken(error)) {
          await deleteSavedUser(userId);
        }
        throw error;
      }
    },
    [apiBaseUrl, deleteSavedUser],
  );

  const refreshSession = useCallback(async (): Promise<AuthSession | null> => {
    if (!session) {
      return null;
    }
    try {
      const nextSession = await refresh(apiBaseUrl, session.refreshToken);
      const persistedSession = {
        ...nextSession,
        refreshTokenPersistence: session.refreshTokenPersistence,
      };
      setSession(persistedSession);
      return persistedSession;
    } catch (error) {
      if (shouldDeleteSavedRefreshToken(error)) {
        await deleteSavedUser(session.userId);
        setSession(null);
      }
      return null;
    }
  }, [apiBaseUrl, session, deleteSavedUser]);

  const logout = useCallback(async () => {
    if (!session) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await requestLogout(apiBaseUrl, session.refreshToken);
    } catch {
      // Local cleanup still runs when the server cannot be reached.
    } finally {
      await deleteRefreshToken(session.userId).catch(() => undefined);
      await reloadSavedUsers();
      setSession(null);
      setIsLoggingOut(false);
    }
  }, [apiBaseUrl, session, reloadSavedUsers]);

  const cleanupBeforeAppClose = useCallback(async () => {
    if (!session) {
      return;
    }
    if (session.refreshTokenPersistence === "session_only") {
      await requestLogout(apiBaseUrl, session.refreshToken).catch(() => undefined);
      setSession(null);
    }
  }, [apiBaseUrl, session]);

  return {
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
  };
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
