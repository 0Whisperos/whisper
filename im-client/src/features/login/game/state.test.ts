import { describe, expect, it } from "vitest";

import { MAX_SPEED } from "./constants";
import { createGameController } from "./state";

describe("dino game controller", () => {
  it("starts from ready and enters running when started", () => {
    // 测试目标：验证游戏遵循参考实现的 ready -> running 主状态切换。
    // 构造方法：创建控制器，设置画布尺寸，再调用 start。
    // 输入数据：画布尺寸 640x360。
    // 预期行为：初始状态为 ready，start 后状态为 running 且显示 Running。
    const game = createGameController();
    game.resize(640, 360);

    expect(game.snapshot().state).toBe("ready");

    game.start();

    expect(game.snapshot().state).toBe("running");
    expect(game.snapshot().statusLabel).toBe("Running");
  });

  it("jumps while running and ducks on the ground", () => {
    // 测试目标：验证 Space/点击跳跃和 ArrowDown 下蹲对应的核心状态变化。
    // 构造方法：创建控制器，设置尺寸，启动游戏，先下蹲再取消，随后跳跃。
    // 输入数据：画布尺寸 640x360，下蹲 true/false，跳跃一次。
    // 预期行为：地面下蹲会切换 ducking，跳跃后恐龙离地且不处于 ducking。
    const game = createGameController();
    game.resize(640, 360);
    game.start();

    game.duck(true);
    expect(game.snapshot().dino.ducking).toBe(true);

    game.duck(false);
    game.jump();

    const snapshot = game.snapshot();
    expect(snapshot.dino.ducking).toBe(false);
    expect(snapshot.dino.grounded).toBe(false);
    expect(snapshot.dino.frameName).toBe("jumping");
  });

  it("uses down input as a speed drop while airborne", () => {
    // 测试目标：验证空中按下 ArrowDown 会进入参考实现的快速下落逻辑。
    // 构造方法：启动游戏后跳跃，再开启 duck 输入并推进一帧。
    // 输入数据：画布尺寸 640x360，deltaMs 为 16。
    // 预期行为：恐龙不进入地面下蹲，但 speedDrop 为 true。
    const game = createGameController();
    game.resize(640, 360);
    game.start();
    game.jump();

    game.duck(true);

    const snapshot = game.snapshot();
    expect(snapshot.dino.ducking).toBe(false);
    expect(snapshot.dino.speedDrop).toBe(true);
  });

  it("crashes when a cactus collision intersects the dino collision boxes", () => {
    // 测试目标：验证障碍物碰撞会进入 crashed 状态并显示 Crashed。
    // 构造方法：启动游戏，将第一个障碍物放到恐龙当前 x 坐标并推进一帧。
    // 输入数据：第一个障碍物 x 等于恐龙 x，类型 small，数量 1。
    // 预期行为：状态为 crashed，状态文案为 Crashed。
    const game = createGameController();
    game.resize(640, 360);
    game.start();
    const dinoX = game.snapshot().dino.x;

    game.setObstacle(0, { x: dinoX, type: "small", count: 1 });
    game.step(16);

    expect(game.snapshot().state).toBe("crashed");
    expect(game.snapshot().statusLabel).toBe("Crashed");
  });

  it("increments score while running and caps speed at the configured maximum", () => {
    // 测试目标：验证 running 状态推进会增长分数，且速度不会超过参考实现最大值。
    // 构造方法：启动游戏后多次推进大步长，避开障碍物以避免碰撞。
    // 输入数据：画布尺寸 640x360，障碍物 x 为 20000，推进 200 次 1000ms。
    // 预期行为：分数大于 0，当前速度小于等于 MAX_SPEED。
    const game = createGameController();
    game.resize(640, 360);
    game.setObstacle(0, { x: 20000, type: "small", count: 1 });
    game.setObstacle(1, { x: 20400, type: "large", count: 1 });
    game.start();

    for (let index = 0; index < 200; index += 1) {
      game.step(1000);
    }

    const snapshot = game.snapshot();
    expect(snapshot.score).toBeGreaterThan(0);
    expect(snapshot.speed).toBeLessThanOrEqual(MAX_SPEED);
  });
});
