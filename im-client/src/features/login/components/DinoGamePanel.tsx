import type { KeyboardEvent } from "react";
import { useEffect } from "react";

import { useDinoGame } from "../game/useDinoGame";

interface DinoGamePanelProps {
  onControllerReady: (controller: { pause: () => void }) => void;
}

export function DinoGamePanel({ onControllerReady }: DinoGamePanelProps) {
  const game = useDinoGame();

  useEffect(() => {
    onControllerReady({ pause: game.pause });
  }, [game.pause, onControllerReady]);

  const handleClick = () => {
    if (game.gameState === "running") {
      game.jump();
      return;
    }
    game.start();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.code === "ArrowDown") {
      event.preventDefault();
      game.duck(true);
      return;
    }

    if (event.code !== "Space" && event.code !== "Enter" && event.code !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    if (game.gameState === "running") {
      game.jump();
    } else {
      game.start();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    if (event.code === "ArrowDown") {
      event.preventDefault();
      game.duck(false);
    }
  };

  return (
    <section
      className="game-panel"
      tabIndex={0}
      aria-label="小恐龙小游戏区域"
      data-game-panel
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div className="game-stage">
        <div className="celestial-layer" aria-hidden="true">
          <div className="sun" />
          <div className="moon" />
          <div className="star-field" />
        </div>
        <div className="game-header">
          <div className="game-meta" aria-live="polite">
            <span className="game-score" data-score>{game.scoreLabel}</span>
            <span data-status>{game.statusLabel}</span>
          </div>
        </div>
        <div className="canvas-wrap">
          <canvas ref={game.canvasRef} data-game-canvas aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
