import type { FormEvent, MouseEvent } from "react";
import { useState } from "react";

import { AuthApiError } from "../api";
import { useLoginForm } from "../hooks/useLoginForm";
import type { SavedUser } from "../types";

interface LoginPanelProps {
  savedUsers: SavedUser[];
  credentialWarning: string | null;
  isLoadingSavedUsers: boolean;
  onPasswordLogin: (account: string, password: string, autoLogin: boolean) => void | Promise<void>;
  onSavedUserLogin: (userId: number) => void | Promise<void>;
  onPauseGame: () => void;
}

export function LoginPanel({
  savedUsers,
  credentialWarning,
  isLoadingSavedUsers,
  onPasswordLogin,
  onSavedUserLogin,
  onPauseGame,
}: LoginPanelProps) {
  const {
    account,
    password,
    autoLogin,
    errorMessage,
    isSubmitting,
    setAccount,
    setPassword,
    setAutoLogin,
    submit,
  } = useLoginForm(onPasswordLogin);
  const [savedUserError, setSavedUserError] = useState<string | null>(null);
  const [activeSavedUserId, setActiveSavedUserId] = useState<number | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPauseGame();
    await submit();
  };

  const handleForgotPassword = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onPauseGame();
  };

  const handleSavedUserLogin = async (user: SavedUser) => {
    onPauseGame();
    setSavedUserError(null);
    setActiveSavedUserId(user.userId);
    try {
      await onSavedUserLogin(user.userId);
    } catch (error) {
      setSavedUserError(toSavedUserErrorMessage(error));
    } finally {
      setActiveSavedUserId(null);
    }
  };

  return (
    <section
      className="login-panel"
      aria-label="登录区域"
      data-login-panel
      onPointerDown={onPauseGame}
      onFocus={onPauseGame}
      onInput={onPauseGame}
    >
      <div className="login-card">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">W</div>
          <div className="brand-name">Whisper</div>
        </div>

        <h1 className="login-title">登录</h1>
        <p className="login-subtitle">使用你的账号继续。</p>

        <form className="login-form" data-login-form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="account">账号</label>
            <input
              id="account"
              name="account"
              type="text"
              autoComplete="username"
              placeholder="请输入账号"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <label className="auto-login-toggle">
            <input
              type="checkbox"
              checked={autoLogin}
              onChange={(event) => setAutoLogin(event.target.checked)}
            />
            <span>自动登录</span>
          </label>

          <div className="form-actions">
            <a className="forgot-link" href="#" data-forgot-link onClick={handleForgotPassword}>
              忘记密码
            </a>
            <button className="login-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "登录中..." : "登录"}
            </button>
          </div>
          {credentialWarning ? <p className="login-warning" role="status">{credentialWarning}</p> : null}
          {errorMessage ? <p className="login-error" role="alert">{errorMessage}</p> : null}
        </form>

        <div className="saved-users" aria-label="已保存用户">
          <div className="saved-users-title">已保存用户</div>
          {isLoadingSavedUsers ? <p className="saved-users-empty">正在读取...</p> : null}
          {!isLoadingSavedUsers && savedUsers.length === 0 ? <p className="saved-users-empty">暂无已保存用户</p> : null}
          {!isLoadingSavedUsers && savedUsers.length > 0 ? (
            <div className="saved-user-list">
              {savedUsers.map((user) => (
                <button
                  className="saved-user-button"
                  type="button"
                  key={user.userId}
                  disabled={activeSavedUserId !== null}
                  onClick={() => void handleSavedUserLogin(user)}
                >
                  {activeSavedUserId === user.userId ? "登录中..." : user.account}
                </button>
              ))}
            </div>
          ) : null}
          {savedUserError ? <p className="login-error" role="alert">{savedUserError}</p> : null}
        </div>
      </div>
    </section>
  );
}

function toSavedUserErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "invalid_refresh_token":
      case "refresh_token_expired":
        return "保存的登录已失效，请重新输入账号密码。";
      case "network_error":
        return "网络连接失败，请检查服务是否启动。";
      case "no_available_chat_node":
        return "当前没有可用的聊天服务，请稍后重试。";
      default:
        return "保存用户登录失败，请重新输入账号密码。";
    }
  }
  return "保存用户登录失败，请重新输入账号密码。";
}
