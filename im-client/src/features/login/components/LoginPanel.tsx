import type { FormEvent, MouseEvent } from "react";

import { useLoginForm } from "../hooks/useLoginForm";
import type { AuthSession } from "../types";

interface LoginPanelProps {
  apiBaseUrl: string;
  onAuthenticated: (session: AuthSession) => void;
  onPauseGame: () => void;
}

export function LoginPanel({ apiBaseUrl, onAuthenticated, onPauseGame }: LoginPanelProps) {
  const { account, password, errorMessage, isSubmitting, setAccount, setPassword, submit } = useLoginForm(apiBaseUrl, onAuthenticated);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPauseGame();
    await submit();
  };

  const handleForgotPassword = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onPauseGame();
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

          <div className="form-actions">
            <a className="forgot-link" href="#" data-forgot-link onClick={handleForgotPassword}>
              忘记密码
            </a>
            <button className="login-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "登录中" : "登录"}
            </button>
          </div>
          {errorMessage ? <p className="login-error" role="alert">{errorMessage}</p> : null}
        </form>
      </div>
    </section>
  );
}
