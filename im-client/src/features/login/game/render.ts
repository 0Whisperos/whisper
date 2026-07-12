import {
  CACTUS_MODELS,
  DINO_DUCK_FRAMES,
  DINO_DUCK_HEIGHT,
  DINO_HEIGHT,
  DINO_JUMP_LEG_BLOCKS,
  DINO_RUNNING_LEG_FRAMES,
  DINO_STANDING_BLOCKS,
  OBSTACLE_TYPES,
} from "./constants";
import type { GameModel, Obstacle, PixelBlock } from "./types";

interface Palette {
  line: string;
  muted: string;
}

function palette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  return {
    line: styles.getPropertyValue("--canvas-line").trim() || "#050505",
    muted: styles.getPropertyValue("--muted").trim() || "#66717d",
  };
}

function drawPixelBlocks(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  blocks: PixelBlock[],
  fill: string,
): void {
  ctx.fillStyle = fill;
  blocks.forEach(([x, y, width, height]) => {
    ctx.fillRect(Math.round(originX + x), Math.round(originY + y), width, height);
  });
}

function clearPixelBlocks(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  blocks: PixelBlock[],
): void {
  blocks.forEach(([x, y, width, height]) => {
    ctx.clearRect(Math.round(originX + x), Math.round(originY + y), width, height);
  });
}

function drawCloud(ctx: CanvasRenderingContext2D, cloud: GameModel["clouds"][number], colors: Palette): void {
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cloud.x, cloud.y + 13);
  ctx.lineTo(cloud.x + cloud.width, cloud.y + 13);
  ctx.moveTo(cloud.x + 8, cloud.y + 13);
  ctx.quadraticCurveTo(cloud.x + 13, cloud.y + 1, cloud.x + 23, cloud.y + 9);
  ctx.quadraticCurveTo(cloud.x + 32, cloud.y + 2, cloud.x + 40, cloud.y + 13);
  ctx.stroke();
}

function drawDino(ctx: CanvasRenderingContext2D, model: GameModel, colors: Palette): void {
  const dino = model.dino;
  if (dino.ducking && dino.grounded) {
    const frame = dino.frameName === "crashed" ? 0 : dino.runningFrame;
    const y = dino.y + DINO_HEIGHT - DINO_DUCK_HEIGHT;
    drawPixelBlocks(ctx, dino.x, y, DINO_DUCK_FRAMES[frame], colors.line);
    return;
  }

  drawPixelBlocks(ctx, dino.x, dino.y, DINO_STANDING_BLOCKS, colors.line);

  if (dino.frameName === "crashed") {
    drawPixelBlocks(ctx, dino.x, dino.y, [[29, 4, 2, 2], [33, 4, 2, 2]], colors.line);
    clearPixelBlocks(ctx, dino.x, dino.y, [[30, 5, 1, 1], [34, 5, 1, 1]]);
    drawPixelBlocks(ctx, dino.x, dino.y, DINO_JUMP_LEG_BLOCKS, colors.line);
    return;
  }

  if (!dino.grounded) {
    drawPixelBlocks(ctx, dino.x, dino.y, DINO_JUMP_LEG_BLOCKS, colors.line);
    return;
  }

  if (model.state === "running") {
    drawPixelBlocks(ctx, dino.x, dino.y, DINO_RUNNING_LEG_FRAMES[dino.runningFrame], colors.line);
  } else {
    drawPixelBlocks(ctx, dino.x, dino.y, DINO_JUMP_LEG_BLOCKS, colors.line);
  }
}

function drawCactus(ctx: CanvasRenderingContext2D, model: GameModel, obstacle: Obstacle, colors: Palette): void {
  const shape = CACTUS_MODELS[obstacle.type];
  const config = OBSTACLE_TYPES[obstacle.type];
  const y = model.groundLine - config.height;

  for (let index = 0; index < obstacle.count; index += 1) {
    drawPixelBlocks(ctx, obstacle.x + index * config.width, y, shape, colors.line);
  }
}

function drawGround(ctx: CanvasRenderingContext2D, model: GameModel, colors: Palette): void {
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(22, model.groundLine + 0.5);
  ctx.lineTo(model.width - 22, model.groundLine + 0.5);
  ctx.stroke();

  ctx.fillStyle = colors.muted;
  model.groundDots.forEach((dot) => {
    ctx.fillRect(Math.round(dot.x), model.groundLine + 11, Math.round(dot.width), 1);
  });
}

export function drawGame(ctx: CanvasRenderingContext2D, model: GameModel): void {
  const colors = palette();
  ctx.clearRect(0, 0, model.width, model.height);
  model.clouds.forEach((cloud) => drawCloud(ctx, cloud, colors));
  drawGround(ctx, model, colors);
  model.obstacles.forEach((obstacle) => drawCactus(ctx, model, obstacle, colors));
  drawDino(ctx, model, colors);
}
