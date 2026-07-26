import { useRef } from "react";

import { DinoGamePanel } from "../features/login/components/DinoGamePanel";
import { LoginPanel } from "../features/login/components/LoginPanel";
import type { AuthSession } from "../features/login/types";

interface LoginPageProps {
  apiBaseUrl: string;
  onAuthenticated: (session: AuthSession) => void;
}

export function LoginPage({ apiBaseUrl, onAuthenticated }: LoginPageProps) {
  const pauseGameRef = useRef<() => void>(() => undefined);

  return (
    <main className="app-shell">
      <DinoGamePanel
        onControllerReady={(controller) => {
          pauseGameRef.current = controller.pause;
        }}
      />
      <LoginPanel apiBaseUrl={apiBaseUrl} onAuthenticated={onAuthenticated} onPauseGame={() => pauseGameRef.current()} />
    </main>
  );
}
