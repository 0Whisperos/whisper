import {
  ACCELERATION,
  DROP_VELOCITY,
  FPS,
  FRAME_MS,
  GRAVITY,
  INITIAL_JUMP_VELOCITY,
  INITIAL_SPEED,
  JUMP_MIN_HEIGHT,
  MAX_SPEED,
  OBSTACLE_TYPES,
  RUN_FRAME_DELAYS,
  SPEED_DROP_COEFFICIENT,
} from "./constants";
import { checkCollisions } from "./collision";
import type { GameModel, Obstacle, ObstaclePatch, ObstacleType } from "./types";

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createObstacle(x: number, type: ObstacleType = Math.random() > 0.58 ? "large" : "small", count = 1): Obstacle {
  const config = OBSTACLE_TYPES[type];
  return {
    x,
    type,
    count,
    width: config.width * count,
    height: config.height,
    gap: config.minGap,
  };
}

export function resetObstacles(model: GameModel): void {
  const firstX = Math.max(
    model.dino.x + 260,
    Math.min(model.width - 110, 430),
  );
  model.obstacles = [
    createObstacle(firstX, "small", 1),
    createObstacle(firstX + 270, "large", 1),
  ];
}

export function resetGroundDots(model: GameModel): void {
  model.groundDots = [];
  for (let x = 34; x < Math.max(model.width, 640); x += 48 + Math.round(Math.random() * 42)) {
    model.groundDots.push({ x, width: randomRange(7, 18) });
  }
}

export function resetDino(model: GameModel): void {
  model.dino.y = model.dino.groundY;
  model.dino.velocityY = 0;
  model.dino.grounded = true;
  model.dino.ducking = false;
  model.dino.runningFrame = 0;
  model.dino.frameName = "standing";
  model.dino.reachedMinHeight = false;
  model.dino.speedDrop = false;
  model.runTimer = 0;
}

export function resetGame(model: GameModel): void {
  model.score = 0;
  model.currentSpeed = INITIAL_SPEED;
  resetDino(model);
  resetObstacles(model);
  resetGroundDots(model);
}

function getObstacleGap(model: GameModel, obstacle: Obstacle): number {
  const config = OBSTACLE_TYPES[obstacle.type];
  const minGap = Math.round(obstacle.width * model.currentSpeed + config.minGap * 0.6);
  return randomRange(minGap, minGap * 1.5);
}

function advanceRunningFrame(model: GameModel, deltaMs: number): void {
  if (!model.dino.grounded || model.state !== "running") {
    return;
  }

  model.runTimer += deltaMs;
  while (model.runTimer >= RUN_FRAME_DELAYS[model.dino.runningFrame]) {
    model.runTimer -= RUN_FRAME_DELAYS[model.dino.runningFrame];
    model.dino.runningFrame = model.dino.runningFrame === 0 ? 1 : 0;
  }
}

function updateJump(model: GameModel, deltaMs: number): void {
  const dino = model.dino;
  if (dino.grounded) {
    return;
  }

  const framesElapsed = deltaMs / FRAME_MS;
  const velocityScale = dino.speedDrop ? SPEED_DROP_COEFFICIENT : 1;
  dino.y += Math.round(dino.velocityY * velocityScale * framesElapsed);
  dino.velocityY += GRAVITY * framesElapsed;
  dino.frameName = "jumping";

  if (dino.y < dino.groundY - JUMP_MIN_HEIGHT || dino.speedDrop) {
    dino.reachedMinHeight = true;
  }

  if ((dino.y < dino.groundY - JUMP_MIN_HEIGHT || dino.speedDrop) && dino.velocityY < DROP_VELOCITY) {
    dino.velocityY = DROP_VELOCITY;
  }

  if (dino.y >= dino.groundY) {
    dino.y = dino.groundY;
    dino.velocityY = 0;
    dino.grounded = true;
    dino.speedDrop = false;
    dino.frameName = model.state === "running" ? "running" : "standing";
  }
}

function updateObstacles(model: GameModel, deltaMs: number): void {
  const movement = model.currentSpeed * FPS * (deltaMs / 1000);
  model.obstacles.forEach((obstacle, index) => {
    obstacle.x -= movement;
    if (obstacle.x + obstacle.width < -20) {
      const previous = model.obstacles[(index + model.obstacles.length - 1) % model.obstacles.length];
      const type: ObstacleType = Math.random() > 0.58 ? "large" : "small";
      const canGroup = model.currentSpeed >= OBSTACLE_TYPES[type].multipleSpeed;
      const count = canGroup ? 1 + Math.floor(Math.random() * 3) : 1;
      Object.assign(obstacle, createObstacle(previous.x + previous.width + getObstacleGap(model, previous), type, count));
    }
  });
}

function updateBackground(model: GameModel, deltaMs: number): void {
  const cloudMove = 0.2 * FPS * (deltaMs / 1000);
  model.clouds.forEach((cloud) => {
    cloud.x -= cloudMove;
    if (cloud.x + cloud.width < -20) {
      cloud.x = model.width + randomRange(60, 220);
      cloud.y = randomRange(32, 72);
    }
  });

  const groundMove = model.currentSpeed * FPS * (deltaMs / 1000);
  model.groundDots.forEach((dot) => {
    dot.x -= groundMove;
    if (dot.x + dot.width < -20) {
      dot.x = model.width + randomRange(12, 80);
      dot.width = randomRange(7, 18);
    }
  });
}

export function stepGame(model: GameModel, deltaMs: number): void {
  if (model.state !== "running") {
    return;
  }

  const safeDelta = Math.min(Math.max(deltaMs, 0), 1000);
  model.score += model.currentSpeed * safeDelta * 0.01;
  model.currentSpeed = Math.min(MAX_SPEED, model.currentSpeed + ACCELERATION * safeDelta);
  advanceRunningFrame(model, safeDelta);
  updateJump(model, safeDelta);
  updateObstacles(model, safeDelta);
  updateBackground(model, safeDelta);
  checkCollisions(model);
}

export function applyObstaclePatch(model: GameModel, index: number, patch: ObstaclePatch): void {
  if (!model.obstacles[index]) {
    return;
  }

  const current = model.obstacles[index];
  Object.assign(
    current,
    createObstacle(
      patch.x ?? current.x,
      patch.type ?? current.type,
      patch.count ?? current.count,
    ),
  );
}

export function startGame(model: GameModel, now = performance.now()): void {
  if (model.state === "crashed") {
    restartGame(model, now);
    return;
  }

  if (model.state !== "running") {
    model.state = "running";
    model.lastTime = now;
    model.dino.frameName = model.dino.grounded ? "running" : "jumping";
    model.statusLabel = "Running";
  }
}

export function pauseGame(model: GameModel): void {
  if (model.state === "running") {
    model.state = "paused";
    model.dino.frameName = model.dino.grounded ? "standing" : "jumping";
    model.statusLabel = "Paused";
  }
}

export function restartGame(model: GameModel, now = performance.now()): void {
  resetGame(model);
  model.state = "running";
  model.lastTime = now;
  model.dino.frameName = "running";
  model.statusLabel = "Running";
}

export function jump(model: GameModel): void {
  if (model.state !== "running" || !model.dino.grounded || model.dino.ducking) {
    return;
  }

  model.dino.velocityY = INITIAL_JUMP_VELOCITY - model.currentSpeed / 10;
  model.dino.grounded = false;
  model.dino.frameName = "jumping";
  model.dino.reachedMinHeight = false;
  model.dino.speedDrop = false;
}

export function setDuck(model: GameModel, isDucking: boolean): void {
  if (model.state !== "running") {
    return;
  }

  if (!model.dino.grounded && isDucking) {
    model.dino.speedDrop = true;
    model.dino.velocityY = Math.max(model.dino.velocityY, 1);
    return;
  }

  if (model.dino.grounded) {
    model.dino.ducking = isDucking;
    model.dino.frameName = isDucking ? "ducking" : "running";
  }
}
