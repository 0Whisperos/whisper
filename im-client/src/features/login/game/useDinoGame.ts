import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createGameController } from "./state";
import type { GameController } from "./types";

declare global {
  interface Window {
    __whisperLoginPreviewGame?: Pick<
      GameController,
      "snapshot" | "step" | "start" | "jump" | "restart" | "toggleTheme" | "setObstacle"
    > & {
      duck: GameController["duck"];
    };
  }
}

function isTestMode(): boolean {
  return new URLSearchParams(window.location.search).has("test");
}

function updateRootTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
}

export function useDinoGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controller = useMemo(() => createGameController(), []);
  const [, forceRender] = useState(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    controller.draw(ctx);
    forceRender((value) => value + 1);
  }, [controller]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    controller.resize(rect.width, rect.height, ratio);
    render();
  }, [controller, render]);

  const start = useCallback(() => {
    controller.start();
    render();
  }, [controller, render]);

  const pause = useCallback(() => {
    controller.pause();
    render();
  }, [controller, render]);

  const jump = useCallback(() => {
    controller.jump();
    render();
  }, [controller, render]);

  const duck = useCallback((isDucking: boolean) => {
    controller.duck(isDucking);
    render();
  }, [controller, render]);

  const toggleTheme = useCallback(() => {
    const theme = controller.toggleTheme();
    updateRootTheme(theme);
    render();
    return theme;
  }, [controller, render]);

  useEffect(() => {
    updateRootTheme("day");
    resizeCanvas();

    const testMode = isTestMode();
    let animationFrame = 0;
    const frame = (now: number) => {
      if (!testMode && controller.model.state === "running") {
        controller.step(now - controller.model.lastTime);
        controller.model.lastTime = now;
        render();
      } else {
        controller.draw(canvasRef.current?.getContext("2d"));
      }
      animationFrame = requestAnimationFrame(frame);
    };

    animationFrame = requestAnimationFrame(frame);
    const themeTimer = testMode ? 0 : window.setInterval(toggleTheme, 8000);
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("blur", pause);

    if (testMode) {
      window.__whisperLoginPreviewGame = {
        snapshot: controller.snapshot,
        step: (deltaMs: number) => {
          controller.step(deltaMs);
          render();
        },
        start,
        jump,
        duck,
        restart: () => {
          controller.restart();
          render();
        },
        toggleTheme,
        setObstacle: (index, patch) => {
          controller.setObstacle(index, patch);
          render();
        },
      };
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      if (themeTimer) {
        window.clearInterval(themeTimer);
      }
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("blur", pause);
      delete window.__whisperLoginPreviewGame;
    };
  }, [controller, duck, jump, pause, render, resizeCanvas, start, toggleTheme]);

  return {
    canvasRef,
    scoreLabel: String(Math.floor(controller.model.score)).padStart(5, "0"),
    statusLabel: controller.model.statusLabel,
    gameState: controller.model.state,
    start,
    pause,
    jump,
    duck,
  };
}
