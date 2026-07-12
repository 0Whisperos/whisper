(() => {
  const root = document.documentElement;
  const canvas = document.querySelector("[data-game-canvas]");
  const gamePanel = document.querySelector("[data-game-panel]");
  const loginPanel = document.querySelector("[data-login-panel]");
  const form = document.querySelector("[data-login-form]");
  const scoreNode = document.querySelector("[data-score]");
  const statusNode = document.querySelector("[data-status]");
  const forgotLink = document.querySelector("[data-forgot-link]");
  const ctx = canvas.getContext("2d");
  const params = new URLSearchParams(window.location.search);
  const isTestMode = params.has("test");

  const FPS = 60;
  const FRAME_MS = 1000 / FPS;
  const RUN_FRAME_DELAYS = [60, 70];
  const DINO_WIDTH = 44;
  const DINO_HEIGHT = 47;
  const DINO_DUCK_WIDTH = 42;
  const DINO_DUCK_HEIGHT = 22;
  const INITIAL_SPEED = 6;
  const MAX_SPEED = 13;
  const ACCELERATION = 0.001;
  const GRAVITY = 0.6;
  const INITIAL_JUMP_VELOCITY = -11;
  const DROP_VELOCITY = -5.5;
  const SPEED_DROP_COEFFICIENT = 3;
  const JUMP_MIN_HEIGHT = 38;

  const obstacleTypes = {
    small: { width: 17, height: 35, minGap: 120, multipleSpeed: 4 },
    large: { width: 25, height: 50, minGap: 120, multipleSpeed: 7 },
  };

  const dinoStandingBlocks = [
    [24, 0, 18, 1],
    [24, 1, 18, 1],
    [22, 2, 22, 1],
    [22, 3, 22, 1],
    [22, 4, 5, 1],
    [29, 4, 15, 1],
    [22, 5, 5, 1],
    [29, 5, 15, 1],
    [22, 6, 5, 1],
    [28, 6, 16, 1],
    [22, 7, 22, 1],
    [22, 8, 22, 1],
    [22, 9, 22, 1],
    [22, 10, 22, 1],
    [22, 11, 22, 1],
    [22, 12, 22, 1],
    [22, 13, 11, 1],
    [22, 14, 11, 1],
    [22, 15, 18, 1],
    [22, 16, 18, 1],
    [0, 17, 2, 1],
    [20, 17, 11, 1],
    [0, 18, 2, 1],
    [20, 18, 11, 1],
    [0, 19, 2, 1],
    [17, 19, 14, 1],
    [0, 20, 2, 1],
    [17, 20, 14, 1],
    [0, 21, 3, 1],
    [16, 21, 16, 1],
    [0, 22, 5, 1],
    [13, 22, 22, 1],
    [0, 23, 5, 1],
    [13, 23, 22, 1],
    [0, 24, 7, 1],
    [11, 24, 20, 1],
    [33, 24, 2, 1],
    [0, 25, 7, 1],
    [11, 25, 20, 1],
    [33, 25, 2, 1],
    [0, 26, 31, 1],
    [0, 27, 31, 1],
    [0, 28, 31, 1],
    [0, 29, 31, 1],
    [2, 30, 27, 1],
    [2, 31, 27, 1],
    [4, 32, 25, 1],
    [5, 33, 24, 1],
    [6, 34, 22, 1],
  ];

  const dinoFootBlocks = [
    [13, 45, 6, 2],
    [22, 45, 5, 2],
  ];

  const dinoRunningLegFrames = [
    [
      [7, 35, 20, 1],
      [7, 36, 19, 1],
      [9, 37, 16, 1],
      [9, 38, 16, 1],
      [13, 39, 4, 3],
      [13, 42, 6, 2],
      [22, 39, 4, 7],
      [22, 45, 5, 2],
    ],
    [
      [7, 35, 20, 1],
      [7, 36, 19, 1],
      [9, 37, 16, 1],
      [9, 38, 16, 1],
      [13, 39, 4, 7],
      [13, 45, 6, 2],
      [22, 39, 4, 3],
      [22, 42, 5, 2],
    ],
  ];

  const dinoJumpLegBlocks = [
    [7, 35, 20, 1],
    [7, 36, 19, 1],
    [9, 37, 16, 1],
    [9, 38, 16, 1],
    [11, 39, 7, 2],
    [20, 39, 5, 2],
    [11, 41, 5, 4],
    [22, 41, 3, 4],
    ...dinoFootBlocks,
  ];

  const dinoDuckFrames = [
    [
      [0, 8, 18, 8],
      [14, 5, 22, 12],
      [32, 2, 10, 6],
      [36, 6, 6, 4],
      [4, 17, 10, 5],
      [24, 17, 10, 5],
    ],
    [
      [0, 8, 18, 8],
      [14, 5, 22, 12],
      [32, 2, 10, 6],
      [36, 6, 6, 4],
      [8, 17, 10, 5],
      [20, 17, 10, 5],
    ],
  ];

  const cactusModels = {
    small: [
      [5, 0, 6, 35],
      [0, 9, 5, 5],
      [0, 14, 3, 9],
      [11, 13, 6, 5],
      [14, 18, 3, 9],
      [4, 3, 8, 2],
    ],
    large: [
      [8, 0, 7, 50],
      [0, 15, 8, 6],
      [0, 21, 4, 17],
      [15, 12, 9, 6],
      [21, 18, 4, 18],
      [7, 4, 9, 2],
    ],
  };

  const dinoCollisionBoxes = {
    running: [
      { x: 22, y: 0, width: 20, height: 17 },
      { x: 13, y: 19, width: 22, height: 18 },
      { x: 1, y: 17, width: 15, height: 13 },
      { x: 8, y: 35, width: 19, height: 5 },
      { x: 13, y: 39, width: 6, height: 8 },
      { x: 20, y: 39, width: 9, height: 8 },
    ],
    ducking: [
      { x: 1, y: 3, width: 39, height: 18 },
    ],
  };

  const cactusCollisionBoxes = {
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
  };

  const game = {
    state: "ready",
    width: 0,
    height: 0,
    ratio: 1,
    lastTime: 0,
    score: 0,
    currentSpeed: INITIAL_SPEED,
    groundLine: 0,
    runTimer: 0,
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

  const palette = () => {
    const styles = getComputedStyle(root);
    return {
      line: styles.getPropertyValue("--canvas-line").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      cutout: styles.getPropertyValue("--canvas-bg").trim() || "transparent",
    };
  };

  const setStatus = (label) => {
    statusNode.textContent = label;
  };

  const updateScore = () => {
    scoreNode.textContent = String(Math.floor(game.score)).padStart(5, "0");
  };

  const randomRange = (min, max) => min + Math.random() * (max - min);

  const createObstacle = (x, type = Math.random() > 0.58 ? "large" : "small", count = 1) => {
    const config = obstacleTypes[type];
    return {
      x,
      type,
      count,
      width: config.width * count,
      height: config.height,
      gap: config.minGap,
    };
  };

  const getObstacleGap = (obstacle) => {
    const config = obstacleTypes[obstacle.type];
    const minGap = Math.round(obstacle.width * game.currentSpeed + config.minGap * 0.6);
    return randomRange(minGap, minGap * 1.5);
  };

  const resetObstacles = () => {
    const firstX = Math.max(
      game.dino.x + 260,
      Math.min(game.width - 110, 430),
    );
    game.obstacles = [
      createObstacle(firstX, "small", 1),
      createObstacle(firstX + 270, "large", 1),
    ];
  };

  const resetGroundDots = () => {
    game.groundDots = [];
    for (let x = 34; x < Math.max(game.width, 640); x += 48 + Math.round(Math.random() * 42)) {
      game.groundDots.push({ x, width: randomRange(7, 18) });
    }
  };

  const resetDino = () => {
    game.dino.y = game.dino.groundY;
    game.dino.velocityY = 0;
    game.dino.grounded = true;
    game.dino.ducking = false;
    game.dino.runningFrame = 0;
    game.dino.frameName = "standing";
    game.dino.reachedMinHeight = false;
    game.dino.speedDrop = false;
    game.runTimer = 0;
  };

  const resetGame = () => {
    game.score = 0;
    game.currentSpeed = INITIAL_SPEED;
    updateScore();
    resetDino();
    resetObstacles();
    resetGroundDots();
  };

  const activeDinoRect = () => {
    if (game.dino.ducking && game.dino.grounded) {
      return {
        x: game.dino.x,
        y: game.dino.y + DINO_HEIGHT - DINO_DUCK_HEIGHT,
        width: DINO_DUCK_WIDTH,
        height: DINO_DUCK_HEIGHT,
      };
    }

    return {
      x: game.dino.x,
      y: game.dino.y,
      width: DINO_WIDTH,
      height: DINO_HEIGHT,
    };
  };

  const obstacleRect = (obstacle) => ({
    x: obstacle.x,
    y: game.groundLine - obstacle.height,
    width: obstacle.width,
    height: obstacle.height,
  });

  const intersects = (a, b) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  const translateBox = (origin, box) => ({
    x: origin.x + box.x,
    y: origin.y + box.y,
    width: box.width,
    height: box.height,
  });

  const activeDinoCollisionBoxes = () => {
    const rect = activeDinoRect();
    const boxes = game.dino.ducking && game.dino.grounded
      ? dinoCollisionBoxes.ducking
      : dinoCollisionBoxes.running;
    return boxes.map((box) => translateBox(rect, box));
  };

  const obstacleCollisionBoxes = (obstacle) => {
    const rect = obstacleRect(obstacle);
    const config = obstacleTypes[obstacle.type];
    const boxes = [];

    for (let index = 0; index < obstacle.count; index += 1) {
      const origin = {
        x: rect.x + index * config.width,
        y: rect.y,
      };
      cactusCollisionBoxes[obstacle.type].forEach((box) => {
        boxes.push(translateBox(origin, box));
      });
    }

    return boxes;
  };

  const checkCollisions = () => {
    const dinoBoxes = activeDinoCollisionBoxes();
    const hit = game.obstacles.some((obstacle) => {
      const cactusBoxes = obstacleCollisionBoxes(obstacle);
      return dinoBoxes.some((dinoBox) =>
        cactusBoxes.some((cactusBox) => intersects(dinoBox, cactusBox)),
      );
    });
    if (hit) {
      game.state = "crashed";
      game.dino.frameName = "crashed";
      setStatus("Crashed");
    }
  };

  const drawPixelBlocks = (originX, originY, blocks, fill) => {
    ctx.fillStyle = fill;
    blocks.forEach(([x, y, width, height]) => {
      ctx.fillRect(Math.round(originX + x), Math.round(originY + y), width, height);
    });
  };

  const clearPixelBlocks = (originX, originY, blocks) => {
    blocks.forEach(([x, y, width, height]) => {
      ctx.clearRect(Math.round(originX + x), Math.round(originY + y), width, height);
    });
  };

  const drawCloud = (cloud, colors) => {
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cloud.x, cloud.y + 13);
    ctx.lineTo(cloud.x + cloud.width, cloud.y + 13);
    ctx.moveTo(cloud.x + 8, cloud.y + 13);
    ctx.quadraticCurveTo(cloud.x + 13, cloud.y + 1, cloud.x + 23, cloud.y + 9);
    ctx.quadraticCurveTo(cloud.x + 32, cloud.y + 2, cloud.x + 40, cloud.y + 13);
    ctx.stroke();
  };

  const drawDino = (colors) => {
    const dino = game.dino;
    if (dino.ducking && dino.grounded) {
      const frame = dino.frameName === "crashed" ? 0 : dino.runningFrame;
      const y = dino.y + DINO_HEIGHT - DINO_DUCK_HEIGHT;
      drawPixelBlocks(dino.x, y, dinoDuckFrames[frame], colors.line);
      return;
    }

    drawPixelBlocks(dino.x, dino.y, dinoStandingBlocks, colors.line);

    if (dino.frameName === "crashed") {
      drawPixelBlocks(dino.x, dino.y, [[29, 4, 2, 2], [33, 4, 2, 2]], colors.line);
      clearPixelBlocks(dino.x, dino.y, [[30, 5, 1, 1], [34, 5, 1, 1]]);
      drawPixelBlocks(dino.x, dino.y, dinoJumpLegBlocks, colors.line);
      return;
    }

    if (!dino.grounded) {
      drawPixelBlocks(dino.x, dino.y, dinoJumpLegBlocks, colors.line);
      return;
    }

    if (game.state === "running") {
      drawPixelBlocks(dino.x, dino.y, dinoRunningLegFrames[dino.runningFrame], colors.line);
    } else {
      drawPixelBlocks(dino.x, dino.y, dinoJumpLegBlocks, colors.line);
    }
  };

  const drawCactus = (obstacle, colors) => {
    const model = cactusModels[obstacle.type];
    const config = obstacleTypes[obstacle.type];
    const y = game.groundLine - config.height;
    for (let index = 0; index < obstacle.count; index += 1) {
      drawPixelBlocks(obstacle.x + index * config.width, y, model, colors.line);
    }
  };

  const drawGround = (colors) => {
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(22, game.groundLine + 0.5);
    ctx.lineTo(game.width - 22, game.groundLine + 0.5);
    ctx.stroke();

    ctx.fillStyle = colors.muted;
    game.groundDots.forEach((dot) => {
      ctx.fillRect(Math.round(dot.x), game.groundLine + 11, Math.round(dot.width), 1);
    });
  };

  const draw = () => {
    const colors = palette();
    ctx.clearRect(0, 0, game.width, game.height);
    game.clouds.forEach((cloud) => drawCloud(cloud, colors));
    drawGround(colors);
    game.obstacles.forEach((obstacle) => drawCactus(obstacle, colors));
    drawDino(colors);
  };

  const advanceRunningFrame = (deltaMs) => {
    if (!game.dino.grounded || game.state !== "running") {
      return;
    }

    game.runTimer += deltaMs;
    while (game.runTimer >= RUN_FRAME_DELAYS[game.dino.runningFrame]) {
      game.runTimer -= RUN_FRAME_DELAYS[game.dino.runningFrame];
      game.dino.runningFrame = game.dino.runningFrame === 0 ? 1 : 0;
    }
  };

  const updateJump = (deltaMs) => {
    const dino = game.dino;
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
      dino.frameName = game.state === "running" ? "running" : "standing";
    }
  };

  const updateObstacles = (deltaMs) => {
    const movement = game.currentSpeed * FPS * (deltaMs / 1000);
    game.obstacles.forEach((obstacle, index) => {
      obstacle.x -= movement;
      if (obstacle.x + obstacle.width < -20) {
        const previous = game.obstacles[(index + game.obstacles.length - 1) % game.obstacles.length];
        const type = Math.random() > 0.58 ? "large" : "small";
        const canGroup = game.currentSpeed >= obstacleTypes[type].multipleSpeed;
        const count = canGroup ? 1 + Math.floor(Math.random() * 3) : 1;
        const replacement = createObstacle(previous.x + previous.width + getObstacleGap(previous), type, count);
        Object.assign(obstacle, replacement);
      }
    });
  };

  const updateBackground = (deltaMs) => {
    const cloudMove = 0.2 * FPS * (deltaMs / 1000);
    game.clouds.forEach((cloud) => {
      cloud.x -= cloudMove;
      if (cloud.x + cloud.width < -20) {
        cloud.x = game.width + randomRange(60, 220);
        cloud.y = randomRange(32, 72);
      }
    });

    const groundMove = game.currentSpeed * FPS * (deltaMs / 1000);
    game.groundDots.forEach((dot) => {
      dot.x -= groundMove;
      if (dot.x + dot.width < -20) {
        dot.x = game.width + randomRange(12, 80);
        dot.width = randomRange(7, 18);
      }
    });
  };

  const step = (deltaMs) => {
    if (game.state !== "running") {
      draw();
      return;
    }

    const safeDelta = Math.min(Math.max(deltaMs, 0), 1000);
    game.score += game.currentSpeed * safeDelta * 0.01;
    game.currentSpeed = Math.min(MAX_SPEED, game.currentSpeed + ACCELERATION * safeDelta);
    updateScore();
    advanceRunningFrame(safeDelta);
    updateJump(safeDelta);
    updateObstacles(safeDelta);
    updateBackground(safeDelta);
    checkCollisions();
    draw();
  };

  const startGame = () => {
    if (game.state === "crashed") {
      restartGame();
      return;
    }

    if (game.state !== "running") {
      game.state = "running";
      game.lastTime = performance.now();
      game.dino.frameName = game.dino.grounded ? "running" : "jumping";
      setStatus("Running");
      draw();
    }
  };

  const pauseGame = () => {
    if (game.state === "running") {
      game.state = "paused";
      game.dino.frameName = game.dino.grounded ? "standing" : "jumping";
      setStatus("Paused");
      draw();
    }
  };

  const restartGame = () => {
    resetGame();
    game.state = "running";
    game.lastTime = performance.now();
    game.dino.frameName = "running";
    setStatus("Running");
    draw();
  };

  const jump = () => {
    if (game.state !== "running" || !game.dino.grounded || game.dino.ducking) {
      return;
    }

    game.dino.velocityY = INITIAL_JUMP_VELOCITY - game.currentSpeed / 10;
    game.dino.grounded = false;
    game.dino.frameName = "jumping";
    game.dino.reachedMinHeight = false;
    game.dino.speedDrop = false;
    draw();
  };

  const setDuck = (isDucking) => {
    if (game.state !== "running") {
      return;
    }

    if (!game.dino.grounded && isDucking) {
      game.dino.speedDrop = true;
      game.dino.velocityY = Math.max(game.dino.velocityY, 1);
      return;
    }

    if (game.dino.grounded) {
      game.dino.ducking = isDucking;
      game.dino.frameName = isDucking ? "ducking" : "running";
      draw();
    }
  };

  const resizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    game.ratio = ratio;
    game.width = rect.width;
    game.height = rect.height;
    game.groundLine = Math.round(rect.height * 0.72);
    game.dino.groundY = game.groundLine - DINO_HEIGHT;
    if (game.dino.grounded) {
      game.dino.y = game.dino.groundY;
    }
    if (game.obstacles.length === 0) {
      resetObstacles();
      resetGroundDots();
    }
    draw();
  };

  const frame = (now) => {
    if (!isTestMode && game.state === "running") {
      step(now - game.lastTime);
      game.lastTime = now;
    }
    requestAnimationFrame(frame);
  };

  const toggleTheme = () => {
    root.dataset.theme = root.dataset.theme === "night" ? "day" : "night";
    draw();
  };

  const snapshot = () => ({
    state: game.state,
    score: game.score,
    speed: game.currentSpeed,
    width: game.width,
    height: game.height,
    dino: {
      x: game.dino.x,
      y: game.dino.y,
      groundY: game.dino.groundY,
      grounded: game.dino.grounded,
      ducking: game.dino.ducking,
      runningFrame: game.dino.runningFrame,
      frameName: game.dino.frameName,
      rect: activeDinoRect(),
      collisionBoxes: activeDinoCollisionBoxes(),
    },
    obstacles: game.obstacles.map((obstacle) => ({
      x: obstacle.x,
      type: obstacle.type,
      count: obstacle.count,
      width: obstacle.width,
      height: obstacle.height,
      rect: obstacleRect(obstacle),
      collisionBoxes: obstacleCollisionBoxes(obstacle),
    })),
  });

  gamePanel.addEventListener("click", () => {
    if (game.state === "running") {
      jump();
      return;
    }
    startGame();
  });

  gamePanel.addEventListener("keydown", (event) => {
    if (event.code === "ArrowDown") {
      event.preventDefault();
      setDuck(true);
      return;
    }

    if (event.code !== "Space" && event.code !== "Enter" && event.code !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    if (game.state === "running") {
      jump();
    } else {
      startGame();
    }
  });

  gamePanel.addEventListener("keyup", (event) => {
    if (event.code === "ArrowDown") {
      event.preventDefault();
      setDuck(false);
    }
  });

  loginPanel.addEventListener("pointerdown", pauseGame);
  loginPanel.addEventListener("focusin", pauseGame);
  loginPanel.addEventListener("input", pauseGame);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    pauseGame();
  });

  forgotLink.addEventListener("click", (event) => {
    event.preventDefault();
    pauseGame();
  });

  window.addEventListener("blur", pauseGame);
  window.addEventListener("resize", resizeCanvas);

  root.dataset.theme = "day";
  resizeCanvas();
  resetGame();
  game.state = "ready";
  setStatus("Ready");
  draw();
  if (!isTestMode) {
    setInterval(toggleTheme, 8000);
  }
  requestAnimationFrame(frame);

  if (isTestMode) {
    window.__whisperLoginPreviewGame = {
      snapshot,
      step,
      start: startGame,
      jump,
      duck: setDuck,
      restart: restartGame,
      toggleTheme,
      setObstacle(index, patch) {
        if (!game.obstacles[index]) {
          return;
        }
        const next = createObstacle(
          patch.x ?? game.obstacles[index].x,
          patch.type ?? game.obstacles[index].type,
          patch.count ?? game.obstacles[index].count,
        );
        Object.assign(game.obstacles[index], next);
        draw();
      },
    };
  }
})();
