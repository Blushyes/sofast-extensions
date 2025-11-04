import { GameLoop, init } from 'kontra';

interface Vec2 {
  x: number;
  y: number;
}
const STEP_MS = 140; // step every 140ms
const FAST_MULT = 2; // hold Space to double the speed

let cols = 20;
let rows = 20;

function clampGrid(p: Vec2): boolean {
  return p.x >= 0 && p.x < cols && p.y >= 0 && p.y < rows;
}

function eq(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function main() {
  const root = document.getElementById('app') as HTMLDivElement | null;
  if (!root) return;
  root.innerHTML = '';

  // Container
  const wrap = document.createElement('div');
  wrap.style.width = '100%';
  wrap.style.height = '100%';
  wrap.style.position = 'absolute';
  wrap.style.left = '0';
  wrap.style.top = '0';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '12px';
  wrap.style.padding = '16px';
  wrap.style.boxSizing = 'border-box';
  root.appendChild(wrap);

  // Overlay UI
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '12px';
  header.style.color = 'var(--color-content-primary, #111)';
  header.style.fontSize = '14px';
  header.style.userSelect = 'none';
  header.innerHTML = '分数: <b id="score">0</b>（方向键/WASD 控制，空格加速）';
  wrap.appendChild(header);
  const scoreEl = header.querySelector('#score') as HTMLSpanElement;

  // Stage area with border box
  const stage = document.createElement('div');
  stage.style.position = 'relative';
  stage.style.flex = '1 1 auto';
  stage.style.width = '100%';
  stage.style.border = '2px solid var(--color-content-primary, #111)';
  stage.style.borderRadius = '4px';
  stage.style.overflow = 'hidden';
  wrap.appendChild(stage);

  // Kontra setup (2D canvas)
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  stage.appendChild(canvas);

  const { context: ctx } = init(canvas);
  let cssW = 0;
  let cssH = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cellPx = 20; // canvas pixel size per cell (after DPR)

  // Snake and food (logical state)

  let snake: Vec2[] = [];
  let dirVec: Vec2 = { x: 1, y: 0 };
  let pendingDir: Vec2 | null = null;
  let food: Vec2 = { x: 0, y: 0 };
  let score = 0;
  let fast = false; // space to accelerate

  function gcd(a: number, b: number): number {
    a = Math.abs(a) | 0;
    b = Math.abs(b) | 0;
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a || 1;
  }

  function pickCellSizePx(w: number, h: number): number {
    // Prefer a size near target that divides both w and h, but
    // if no reasonable divisor exists, fall back to the target.
    const g = gcd(w, h);
    const target = 18; // desired cell px (higher density)
    const minC = 8;
    const maxC = 36;

    // enumerate divisors of g
    const divs: number[] = [];
    for (let i = 1; i * i <= g; i++) {
      if (g % i === 0) {
        divs.push(i);
        if (i * i !== g) divs.push(g / i);
      }
    }
    divs.sort((a, b) => a - b);

    // keep only reasonable candidates within [minC, maxC]
    const candidates = divs.filter((d) => d >= minC && d <= maxC);
    if (candidates.length === 0) {
      // fall back to clamped target so we never return 1px
      return Math.max(minC, Math.min(maxC, target));
    }

    // choose the closest to the target
    let best = candidates[0];
    let bestDiff = Math.abs(best - target);
    for (let i = 1; i < candidates.length; i++) {
      const d = candidates[i];
      const diff = Math.abs(d - target);
      if (diff < bestDiff) {
        best = d;
        bestDiff = diff;
      }
    }
    return best;
  }

  function resetGame() {
    snake = [
      { x: Math.floor(cols / 2), y: Math.floor(rows / 2) },
      { x: Math.floor(cols / 2) - 1, y: Math.floor(rows / 2) },
    ];
    dirVec = { x: 1, y: 0 };
    pendingDir = null;
    score = 0;
    scoreEl.textContent = String(score);
    food = spawnFood();
  }

  function spawnFood(): Vec2 {
    while (true) {
      const p = {
        x: Math.floor(Math.random() * cols),
        y: Math.floor(Math.random() * rows),
      };
      if (!snake.some((s) => eq(s, p))) return p;
    }
  }

  function draw() {
    // clear
    ctx.clearRect(0, 0, cssW, cssH);

    // layout: board fills entire stage with square cells
    const cellW = cssW / cols;
    const cellH = cssH / rows;

    // board background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);

    // helper to map logical (x,y) to canvas (with y-up logic)
    const toXY = (p: Vec2) => {
      // invert y so that y+ is up
      const yy = rows - 1 - p.y;
      return { x: p.x * cellW, y: yy * cellH };
    };

    const base = Math.min(cellW, cellH);
    const pad = Math.max(0.5, base * 0.1);
    const sizeW = Math.max(1, cellW - pad * 2);
    const sizeH = Math.max(1, cellH - pad * 2);

    // food
    const fxy = toXY(food);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(fxy.x + pad, fxy.y + pad, sizeW, sizeH);

    // snake as continuous tube (no visible segments)
    const headColor = '#22c55e';
    const bodyColor = '#16a34a';
    const tube = Math.min(sizeW, sizeH);
    const toCenter = (p: Vec2) => {
      const c = toXY(p);
      return { x: c.x + cellW / 2, y: c.y + cellH / 2 };
    };
    const isDirectNeighbor = (a: Vec2, b: Vec2) =>
      (a.x === b.x && Math.abs(a.y - b.y) === 1) ||
      (a.y === b.y && Math.abs(a.x - b.x) === 1);

    if (snake.length > 0) {
      // draw body in chunks to avoid wrapping across the entire board
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = tube;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let start = 0;
      for (let i = 1; i < snake.length; i++) {
        if (!isDirectNeighbor(snake[i - 1], snake[i])) {
          // draw previous chunk [start, i-1]
          ctx.beginPath();
          const c0 = toCenter(snake[start]);
          ctx.moveTo(c0.x, c0.y);
          for (let j = start + 1; j <= i - 1; j++) {
            const c = toCenter(snake[j]);
            ctx.lineTo(c.x, c.y);
          }
          ctx.stroke();
          start = i;
        }
      }
      // draw last chunk
      ctx.beginPath();
      const c0 = toCenter(snake[start]);
      ctx.moveTo(c0.x, c0.y);
      for (let j = start + 1; j < snake.length; j++) {
        const c = toCenter(snake[j]);
        ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();

      // draw head on top
      const hc = toCenter(snake[0]);
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(hc.x, hc.y, tube / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function step() {
    if (pendingDir) {
      // avoid reversing directly
      if (!(pendingDir.x === -dirVec.x && pendingDir.y === -dirVec.y))
        dirVec = pendingDir;
      pendingDir = null;
    }
    const head = snake[0];
    let next = { x: head.x + dirVec.x, y: head.y + dirVec.y };
    // wrap on walls
    if (!clampGrid(next)) {
      next = {
        x: (next.x + cols) % cols,
        y: (next.y + rows) % rows,
      };
    }
    // self-collision resets
    if (snake.some((s) => eq(s, next))) {
      // reset
      resetGame();
      // redraw after reset
      draw();
      return;
    }
    // move
    snake.unshift(next);
    if (eq(next, food)) {
      score++;
      scoreEl.textContent = String(score);
      food = spawnFood();
    } else {
      snake.pop();
    }
    // redraw after move
    draw();
  }

  // keyboard
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.code === 'Space' || k === ' ') {
      fast = true;
      e.preventDefault();
      return;
    }
    if (k === 'arrowup' || k === 'w') pendingDir = { x: 0, y: 1 };
    else if (k === 'arrowdown' || k === 's') pendingDir = { x: 0, y: -1 };
    else if (k === 'arrowleft' || k === 'a') pendingDir = { x: -1, y: 0 };
    else if (k === 'arrowright' || k === 'd') pendingDir = { x: 1, y: 0 };
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      fast = false;
      e.preventDefault();
    }
  });

  // layout
  function resize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    // draw using CSS pixel coords
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // recompute grid so cells are square and fill stage exactly
    const chosenPx = pickCellSizePx(canvas.width, canvas.height);
    cellPx = chosenPx / dpr; // store CSS pixel cell size (for reference)
    cols = Math.max(2, Math.floor(canvas.width / chosenPx));
    rows = Math.max(2, Math.floor(canvas.height / chosenPx));
    // keep snake/food within new bounds without resetting if already running
    if (snake.length) {
      snake = snake.map((s) => ({
        x: ((s.x % cols) + cols) % cols,
        y: ((s.y % rows) + rows) % rows,
      }));
      if (!clampGrid(food) || snake.some((s) => eq(s, food))) {
        food = spawnFood();
      }
    }
    draw();
  }
  window.addEventListener('resize', resize);
  resize();

  // loop via Kontra GameLoop
  let acc = 0;
  const loop = GameLoop({
    update(dt) {
      acc += dt * 1000; // dt is in seconds
      const stepMs = FAST_MULT > 0 && fast ? STEP_MS / FAST_MULT : STEP_MS;
      while (acc >= stepMs) {
        step();
        acc -= stepMs;
      }
    },
    render() {
      draw();
    },
  });
  if (snake.length === 0) {
    resetGame();
    draw();
  }
  loop.start();
}

try {
  main();
} catch (e) {
  console.error('Snake init failed', e);
}
