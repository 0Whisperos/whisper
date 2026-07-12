import type { ObstacleConfig, PixelBlock } from "./types";

export const FPS = 60;
export const FRAME_MS = 1000 / FPS;
export const RUN_FRAME_DELAYS = [60, 70] as const;
export const DINO_WIDTH = 44;
export const DINO_HEIGHT = 47;
export const DINO_DUCK_WIDTH = 42;
export const DINO_DUCK_HEIGHT = 22;
export const INITIAL_SPEED = 6;
export const MAX_SPEED = 13;
export const ACCELERATION = 0.001;
export const GRAVITY = 0.6;
export const INITIAL_JUMP_VELOCITY = -11;
export const DROP_VELOCITY = -5.5;
export const SPEED_DROP_COEFFICIENT = 3;
export const JUMP_MIN_HEIGHT = 38;

export const OBSTACLE_TYPES: Record<"small" | "large", ObstacleConfig> = {
  small: { width: 17, height: 35, minGap: 120, multipleSpeed: 4 },
  large: { width: 25, height: 50, minGap: 120, multipleSpeed: 7 },
};

export const DINO_STANDING_BLOCKS: PixelBlock[] = [
  [24, 0, 18, 1], [24, 1, 18, 1], [22, 2, 22, 1], [22, 3, 22, 1],
  [22, 4, 5, 1], [29, 4, 15, 1], [22, 5, 5, 1], [29, 5, 15, 1],
  [22, 6, 5, 1], [28, 6, 16, 1], [22, 7, 22, 1], [22, 8, 22, 1],
  [22, 9, 22, 1], [22, 10, 22, 1], [22, 11, 22, 1], [22, 12, 22, 1],
  [22, 13, 11, 1], [22, 14, 11, 1], [22, 15, 18, 1], [22, 16, 18, 1],
  [0, 17, 2, 1], [20, 17, 11, 1], [0, 18, 2, 1], [20, 18, 11, 1],
  [0, 19, 2, 1], [17, 19, 14, 1], [0, 20, 2, 1], [17, 20, 14, 1],
  [0, 21, 3, 1], [16, 21, 16, 1], [0, 22, 5, 1], [13, 22, 22, 1],
  [0, 23, 5, 1], [13, 23, 22, 1], [0, 24, 7, 1], [11, 24, 20, 1],
  [33, 24, 2, 1], [0, 25, 7, 1], [11, 25, 20, 1], [33, 25, 2, 1],
  [0, 26, 31, 1], [0, 27, 31, 1], [0, 28, 31, 1], [0, 29, 31, 1],
  [2, 30, 27, 1], [2, 31, 27, 1], [4, 32, 25, 1], [5, 33, 24, 1],
  [6, 34, 22, 1],
];

export const DINO_FOOT_BLOCKS: PixelBlock[] = [
  [13, 45, 6, 2],
  [22, 45, 5, 2],
];

export const DINO_RUNNING_LEG_FRAMES: PixelBlock[][] = [
  [
    [7, 35, 20, 1], [7, 36, 19, 1], [9, 37, 16, 1], [9, 38, 16, 1],
    [13, 39, 4, 3], [13, 42, 6, 2], [22, 39, 4, 7], [22, 45, 5, 2],
  ],
  [
    [7, 35, 20, 1], [7, 36, 19, 1], [9, 37, 16, 1], [9, 38, 16, 1],
    [13, 39, 4, 7], [13, 45, 6, 2], [22, 39, 4, 3], [22, 42, 5, 2],
  ],
];

export const DINO_JUMP_LEG_BLOCKS: PixelBlock[] = [
  [7, 35, 20, 1], [7, 36, 19, 1], [9, 37, 16, 1], [9, 38, 16, 1],
  [11, 39, 7, 2], [20, 39, 5, 2], [11, 41, 5, 4], [22, 41, 3, 4],
  ...DINO_FOOT_BLOCKS,
];

export const DINO_DUCK_FRAMES: PixelBlock[][] = [
  [
    [0, 8, 18, 8], [14, 5, 22, 12], [32, 2, 10, 6], [36, 6, 6, 4],
    [4, 17, 10, 5], [24, 17, 10, 5],
  ],
  [
    [0, 8, 18, 8], [14, 5, 22, 12], [32, 2, 10, 6], [36, 6, 6, 4],
    [8, 17, 10, 5], [20, 17, 10, 5],
  ],
];

export const CACTUS_MODELS: Record<"small" | "large", PixelBlock[]> = {
  small: [
    [5, 0, 6, 35], [0, 9, 5, 5], [0, 14, 3, 9], [11, 13, 6, 5],
    [14, 18, 3, 9], [4, 3, 8, 2],
  ],
  large: [
    [8, 0, 7, 50], [0, 15, 8, 6], [0, 21, 4, 17], [15, 12, 9, 6],
    [21, 18, 4, 18], [7, 4, 9, 2],
  ],
};

export const DINO_COLLISION_BOXES = {
  running: [
    { x: 22, y: 0, width: 20, height: 17 },
    { x: 13, y: 19, width: 22, height: 18 },
    { x: 1, y: 17, width: 15, height: 13 },
    { x: 8, y: 35, width: 19, height: 5 },
    { x: 13, y: 39, width: 6, height: 8 },
    { x: 20, y: 39, width: 9, height: 8 },
  ],
  ducking: [{ x: 1, y: 3, width: 39, height: 18 }],
} as const;

export const CACTUS_COLLISION_BOXES = {
  small: [
    { x: 0, y: 7, width: 5, height: 27 },
    { x: 4, y: 0, width: 6, height: 34 },
    { x: 10, y: 4, width: 7, height: 14 },
  ],
  large: [
    { x: 0, y: 12, width: 7, height: 38 },
    { x: 8, y: 0, width: 7, height: 49 },
    { x: 13, y: 10, width: 10, height: 38 },
  ],
} as const;
