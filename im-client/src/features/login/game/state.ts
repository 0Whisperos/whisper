import { DINO_HEIGHT, INITIAL_SPEED } from "./constants";
import {
  activeDinoCollisionBoxes,
  activeDinoRect,
  obstacleCollisionBoxes,
  obstacleRect,
} from "./collision";
import {
  applyObstaclePatch,
  jump,
  pauseGame,
  resetGame,
  resetGroundDots,
  resetObstacles,
  restartGame,
  setDuck,
  startGame,
  stepGame,
} from "./physics";
import { drawGame } from "./render";
import type { GameController, GameModel, GameSnapshot, ObstaclePatch, ThemeName } from "./types";

export function createInitialModel(): GameModel {
  return {
    state: "ready",
    width: 0,
    height: 0,
    ratio: 1,
    lastTime: 0,
    score: 0,
    currentSpeed: INITIAL_SPEED,
    groundLine: 0,
    runTimer: 0,
    statusLabel: "Ready",
    theme: "day",
    dino: {
      x: 74,
      y: 0,
      groundY: 0,
      velocityY: 0,
      grounded: true,
      ducking: false,
      runningFrame: 0,
      frameName: "standing",
      reachedMinHeight: false,
      speedDrop: false,
    },
    obstacles: [],
    clouds: [
      { x: 160, y: 56, width: 46 },
      { x: 430, y: 36, width: 46 },
    ],
    groundDots: [],
  };
}

export function createGameController(): GameController {
  const model = createInitialModel();

  const controller: GameController = {
    model,
    resize(width: number, height: number, ratio = 1) {
      model.ratio = ratio;
      model.width = width;
      model.height = height;
      model.groundLine = Math.round(height * 0.72);
      model.dino.groundY = model.groundLine - DINO_HEIGHT;
      if (model.dino.grounded) {
        model.dino.y = model.dino.groundY;
      }
      if (model.obstacles.length === 0) {
        resetObstacles(model);
        resetGroundDots(model);
      }
    },
    snapshot(): GameSnapshot {
      return {
        state: model.state,
        statusLabel: model.statusLabel,
        score: model.score,
        speed: model.currentSpeed,
        width: model.width,
        height: model.height,
        theme: model.theme,
        dino: {
          ...model.dino,
          rect: activeDinoRect(model),
          collisionBoxes: activeDinoCollisionBoxes(model),
        },
        obstacles: model.obstacles.map((obstacle) => ({
          ...obstacle,
          rect: obstacleRect(model, obstacle),
          collisionBoxes: obstacleCollisionBoxes(model, obstacle),
        })),
      };
    },
    step(deltaMs: number) {
      stepGame(model, deltaMs);
    },
    draw(ctx?: CanvasRenderingContext2D | null) {
      if (ctx && model.width > 0 && model.height > 0) {
        drawGame(ctx, model);
      }
    },
    start() {
      startGame(model);
    },
    pause() {
      pauseGame(model);
    },
    jump() {
      jump(model);
    },
    duck(isDucking: boolean) {
      setDuck(model, isDucking);
    },
    restart() {
      restartGame(model);
    },
    toggleTheme(): ThemeName {
      model.theme = model.theme === "night" ? "day" : "night";
      return model.theme;
    },
    setObstacle(index: number, patch: ObstaclePatch) {
      applyObstaclePatch(model, index, patch);
    },
  };

  resetGame(model);
  model.state = "ready";
  model.statusLabel = "Ready";
  model.theme = "day";
  return controller;
}
