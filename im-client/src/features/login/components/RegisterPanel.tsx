import type { FormEvent } from "react";

import { useRegisterForm } from "../hooks/useRegisterForm";

interface RegisterPanelProps {
  onRegister: (nickname: string, password: string) => void | Promise<void>;
  onBackToLogin: () => void;
  onPauseGame: () => void;
}

export function RegisterPanel({ onRegister, onBackToLogin, onPauseGame }: RegisterPanelProps) {
  const {
    nickname,
    password,
    confirmPassword,
    errorMessage,
    isSubmitting,
    setNickname,
    setPassword,
    setConfirmPassword,
    submit,
  } = useRegisterForm(onRegister);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPauseGame();
    await submit();
  };

  const handleBackToLogin = () => {
    onPauseGame();
    onBackToLogin();
  };

  return (
    <section
      className="login-panel"
      aria-label="注册区域"
      data-register-panel
      onPointerDown={onPauseGame}
      onFocus={onPauseGame}
      onInput={onPauseGame}
    >
      <div className="login-card">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">W</div>
          <div className="brand-name">Whisper</div>
        </div>

        <h1 className="login-title">注册</h1>
        <p className="login-subtitle">创建账号，开始使用 Whisper。</p>

        <form className="login-form" data-register-form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nickname">昵称</label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              autoComplete="nickname"
              placeholder="请输入昵称"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="register-password">密码</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="register-password-confirm">确认密码</label>
            <input
              id="register-password-confirm"
              name="password-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="请再次输入密码"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          <div className="form-actions register-actions">
            <button className="register-link" type="button" onClick={handleBackToLogin}>
              返回登录
            </button>
            <button className="login-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "注册中..." : "注册"}
            </button>
          </div>
          {errorMessage ? <p className="login-error" role="alert">{errorMessage}</p> : null}
        </form>
      </div>
    </section>
  );
}
