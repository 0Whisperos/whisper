export type GameState = "ready" | "running" | "paused" | "crashed";
export type FrameName = "standing" | "running" | "jumping" | "ducking" | "crashed";
export type ObstacleType = "small" | "large";
export type ThemeName = "day" | "night";

export type PixelBlock = readonly [x: number, y: number, width: number, height: number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObstacleConfig {
  width: number;
  height: number;
  minGap: number;
  multipleSpeed: number;
}

export interface DinoState {
  x: number;
  y: number;
  groundY: number;
  velocityY: number;
  grounded: boolean;
  ducking: boolean;
  runningFrame: number;
  frameName: FrameName;
  reachedMinHeight: boolean;
  speedDrop: boolean;
}

export interface Obstacle {
  x: number;
  type: ObstacleType;
  count: number;
  width: number;
  height: number;
  gap: number;
}

export interface Cloud {
  x: number;
  y: number;
  width: number;
}

export interface GroundDot {
  x: number;
  width: number;
}

export interface GameModel {
  state: GameState;
  width: number;
  height: number;
  ratio: number;
  lastTime: number;
  score: number;
  currentSpeed: number;
  groundLine: number;
  runTimer: number;
  statusLabel: string;
  theme: ThemeName;
  dino: DinoState;
  obstacles: Obstacle[];
  clouds: Cloud[];
  groundDots: GroundDot[];
}

export interface ObstacleSnapshot extends Obstacle {
  rect: Rect;
  collisionBoxes: Rect[];
}

export interface DinoSnapshot extends DinoState {
  rect: Rect;
  collisionBoxes: Rect[];
}

export interface GameSnapshot {
  state: GameState;
  statusLabel: string;
  score: number;
  speed: number;
  width: number;
  height: number;
  theme: ThemeName;
  dino: DinoSnapshot;
  obstacles: ObstacleSnapshot[];
}

export interface ObstaclePatch {
  x?: number;
  type?: ObstacleType;
  count?: number;
}

export interface GameController {
  model: GameModel;
  resize(width: number, height: number, ratio?: number): void;
  snapshot(): GameSnapshot;
  step(deltaMs: number): void;
  draw(ctx?: CanvasRenderingContext2D | null): void;
  start(): void;
  pause(): void;
  jump(): void;
  duck(isDucking: boolean): void;
  restart(): void;
  toggleTheme(): ThemeName;
  setObstacle(index: number, patch: ObstaclePatch): void;
}
