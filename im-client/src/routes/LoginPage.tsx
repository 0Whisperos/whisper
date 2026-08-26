import { useRef } from "react";

import { DinoGamePanel } from "../features/login/components/DinoGamePanel";
import { LoginPanel } from "../features/login/components/LoginPanel";
import type { SavedUser } from "../features/login/types";

interface LoginPageProps {
  savedUsers: SavedUser[];
  credentialWarning: string | null;
  isLoadingSavedUsers: boolean;
  onPasswordLogin: (account: string, password: string, autoLogin: boolean) => void | Promise<void>;
  onSavedUserLogin: (userId: number) => void | Promise<void>;
}

export function LoginPage({
  savedUsers,
  credentialWarning,
  isLoadingSavedUsers,
  onPasswordLogin,
  onSavedUserLogin,
}: LoginPageProps) {
  const pauseGameRef = useRef<() => void>(() => undefined);

  return (
    <main className="app-shell">
      <DinoGamePanel
        onControllerReady={(controller) => {
          pauseGameRef.current = controller.pause;
        }}
      />
      <LoginPanel
        savedUsers={savedUsers}
        credentialWarning={credentialWarning}
        isLoadingSavedUsers={isLoadingSavedUsers}
        onPasswordLogin={onPasswordLogin}
        onSavedUserLogin={onSavedUserLogin}
        onPauseGame={() => pauseGameRef.current()}
      />
    </main>
  );
}
