import { useRef } from "react";

import { DinoGamePanel } from "../features/login/components/DinoGamePanel";
import { LoginPanel } from "../features/login/components/LoginPanel";

export function LoginPage() {
  const pauseGameRef = useRef<() => void>(() => undefined);

  return (
    <main className="app-shell">
      <DinoGamePanel
        onControllerReady={(controller) => {
          pauseGameRef.current = controller.pause;
        }}
      />
      <LoginPanel onPauseGame={() => pauseGameRef.current()} />
    </main>
  );
}
