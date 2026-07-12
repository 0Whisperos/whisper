import {
  CACTUS_COLLISION_BOXES,
  DINO_COLLISION_BOXES,
  DINO_DUCK_HEIGHT,
  DINO_DUCK_WIDTH,
  DINO_HEIGHT,
  DINO_WIDTH,
  OBSTACLE_TYPES,
} from "./constants";
import type { GameModel, Obstacle, Rect } from "./types";

export function activeDinoRect(model: GameModel): Rect {
  if (model.dino.ducking && model.dino.grounded) {
    return {
      x: model.dino.x,
      y: model.dino.y + DINO_HEIGHT - DINO_DUCK_HEIGHT,
      width: DINO_DUCK_WIDTH,
      height: DINO_DUCK_HEIGHT,
    };
  }

  return {
    x: model.dino.x,
    y: model.dino.y,
    width: DINO_WIDTH,
    height: DINO_HEIGHT,
  };
}

export function obstacleRect(model: GameModel, obstacle: Obstacle): Rect {
  return {
    x: obstacle.x,
    y: model.groundLine - obstacle.height,
    width: obstacle.width,
    height: obstacle.height,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function translateBox(origin: Pick<Rect, "x" | "y">, box: Rect): Rect {
  return {
    x: origin.x + box.x,
    y: origin.y + box.y,
    width: box.width,
    height: box.height,
  };
}

export function activeDinoCollisionBoxes(model: GameModel): Rect[] {
  const rect = activeDinoRect(model);
  const boxes = model.dino.ducking && model.dino.grounded
    ? DINO_COLLISION_BOXES.ducking
    : DINO_COLLISION_BOXES.running;

  return boxes.map((box) => translateBox(rect, box));
}

export function obstacleCollisionBoxes(model: GameModel, obstacle: Obstacle): Rect[] {
  const rect = obstacleRect(model, obstacle);
  const config = OBSTACLE_TYPES[obstacle.type];
  const boxes: Rect[] = [];

  for (let index = 0; index < obstacle.count; index += 1) {
    const origin = {
      x: rect.x + index * config.width,
      y: rect.y,
    };
    CACTUS_COLLISION_BOXES[obstacle.type].forEach((box) => {
      boxes.push(translateBox(origin, box));
    });
  }

  return boxes;
}

export function checkCollisions(model: GameModel): void {
  const dinoBoxes = activeDinoCollisionBoxes(model);
  const hit = model.obstacles.some((obstacle) => {
    const cactusBoxes = obstacleCollisionBoxes(model, obstacle);
    return dinoBoxes.some((dinoBox) =>
      cactusBoxes.some((cactusBox) => intersects(dinoBox, cactusBox)),
    );
  });

  if (hit) {
    model.state = "crashed";
    model.dino.frameName = "crashed";
    model.statusLabel = "Crashed";
  }
}
