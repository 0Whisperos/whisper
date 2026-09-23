import { useRef, useState } from "react";

import { DinoGamePanel } from "../features/login/components/DinoGamePanel";
import { LoginPanel } from "../features/login/components/LoginPanel";
import { RegisterPanel } from "../features/login/components/RegisterPanel";
import type { SavedUser } from "../features/login/types";

type LoginMode = "login" | "register";

interface LoginPageProps {
  savedUsers: SavedUser[];
  credentialWarning: string | null;
  isLoadingSavedUsers: boolean;
  onPasswordLogin: (account: string, password: string, autoLogin: boolean) => void | Promise<void>;
  onSavedUserLogin: (userId: number) => void | Promise<void>;
  onRegister: (nickname: string, password: string) => Promise<string>;
}

export function LoginPage({
  savedUsers,
  credentialWarning,
  isLoadingSavedUsers,
  onPasswordLogin,
  onSavedUserLogin,
  onRegister,
}: LoginPageProps) {
  const pauseGameRef = useRef<() => void>(() => undefined);
  const [mode, setMode] = useState<LoginMode>("login");
  const [initialAccount, setInitialAccount] = useState("");
  const [registrationSuccessAccount, setRegistrationSuccessAccount] = useState<string | null>(null);

  const handleRegister = async (nickname: string, password: string) => {
    const account = await onRegister(nickname, password);
    setRegistrationSuccessAccount(account);
  };

  const handleReturnToLogin = () => {
    setInitialAccount(registrationSuccessAccount ?? "");
    setRegistrationSuccessAccount(null);
    setMode("login");
  };

  return (
    <main className="app-shell">
      <DinoGamePanel
        onControllerReady={(controller) => {
          pauseGameRef.current = controller.pause;
        }}
      />
      {mode === "login" ? (
        <LoginPanel
          savedUsers={savedUsers}
          credentialWarning={credentialWarning}
          isLoadingSavedUsers={isLoadingSavedUsers}
          onPasswordLogin={onPasswordLogin}
          onSavedUserLogin={onSavedUserLogin}
          onOpenRegister={() => {
            setRegistrationSuccessAccount(null);
            setMode("register");
          }}
          initialAccount={initialAccount}
          onPauseGame={() => pauseGameRef.current()}
        />
      ) : (
        <RegisterPanel
          onRegister={handleRegister}
          onBackToLogin={() => {
            setRegistrationSuccessAccount(null);
            setMode("login");
          }}
          onPauseGame={() => pauseGameRef.current()}
        />
      )}
      {registrationSuccessAccount ? (
        <div className="register-success-dialog-backdrop">
          <section
            className="register-success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-success-title"
          >
            <h2 id="register-success-title">注册成功</h2>
            <p>你的账号是：</p>
            <strong>{registrationSuccessAccount}</strong>
            <p>请记住账号，然后使用它登录。</p>
            <button className="login-button" type="button" onClick={handleReturnToLogin}>
              去登录
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
