import type { ProbeConfig, ProbeStats, Surface } from "./types";

const DEFAULTS: Required<ProbeConfig> = {
  budgetMs: 8,
  budgetNodes: 1500,
  maxSurfaces: 48,
  minWidth: 110,
  minHeight: 8,
};

/** 可交互元素不可站立——宠物挡在按钮正上方会妨碍点击（input 类另有 inputTop 处理）。 */
const NO_STAND_SELECTOR = 'button, a, select, summary, [role="button"], [role="link"], [role="tab"]';
const INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable=""], [contenteditable="true"]';

const HOST_ID = "kkl-pet-host";

let seq = 0;

function makeId(prefix: string): string {
  seq = (seq + 1) % 1e9;
  return `${prefix}${seq}`;
}

/**
 * 家具探测。
 * 不用 querySelectorAll——复杂后台页会命中上万节点且无法剪枝。
 * 用 DFS + 可见性剪枝 + 预算硬上限，最坏情况 8ms 内返回部分结果。
 */
export function probeSurfaces(config: ProbeConfig = {}): {
  surfaces: Surface[];
  stats: ProbeStats;
} {
  const cfg = { ...DEFAULTS, ...config };
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const body = document.body;
  if (!body) {
    return { surfaces: [], stats: { nodes: 0, surfaces: 0, elapsedMs: 0, truncated: false } };
  }

  const stack: Array<{ el: Element; depth: number }> = [];
  for (let i = body.children.length - 1; i >= 0; i--) {
    stack.push({ el: body.children[i], depth: 1 });
  }

  const candidates: Surface[] = [];
  const t0 = performance.now();
  let nodes = 0;
  let truncated = false;

  while (stack.length > 0) {
    if (nodes >= cfg.budgetNodes) {
      truncated = true;
      break;
    }
    // 每 32 个节点查一次时钟，避免 performance.now() 自身成为开销
    if ((nodes & 31) === 0 && performance.now() - t0 > cfg.budgetMs) {
      truncated = true;
      break;
    }

    const item = stack.pop();
    if (!item) break;
    const { el, depth } = item;
    nodes++;

    if (el.id === HOST_ID) continue;

    const r = el.getBoundingClientRect();

    // 0×0 视为不可见，剪掉整棵子树（display:none 的典型特征）
    if (r.width === 0 && r.height === 0) continue;

    const inViewport = r.bottom > 0 && r.top < viewportH && r.right > 0 && r.left < viewportW;

    if (inViewport && r.width >= cfg.minWidth && r.height >= cfg.minHeight) {
      const isInput = el.matches(INPUT_SELECTOR);
      const noStand = !isInput && el.matches(NO_STAND_SELECTOR);

      if (!noStand) {
        candidates.push({
          id: makeId("s"),
          kind: isInput ? "inputTop" : "ledge",
          rect: { x: r.left, y: r.top, w: r.width, h: 1 },
          el,
          area: r.width * r.height,
          depth,
          fieldRect: isInput ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined,
        });
      }
    }

    for (let i = el.children.length - 1; i >= 0; i--) {
      stack.push({ el: el.children[i], depth: depth + 1 });
    }
  }

  const kept = dedupe(candidates);
  kept.sort((a, b) => b.area - a.area);

  const surfaces = kept.slice(0, cfg.maxSurfaces);

  return {
    surfaces,
    stats: {
      nodes,
      surfaces: surfaces.length,
      elapsedMs: performance.now() - t0,
      truncated,
    },
  };
}

/**
 * 同 top 的嵌套去重：保留更精确的内层。
 * 判断标准是「已保留项被当前项包含」——包含者丢弃，因为宠物站在内层卡片边上比站在整页容器边上自然。
 * 并排但互不包含的表面都保留。
 */
function dedupe(cands: Surface[]): Surface[] {
  const sorted = [...cands].sort((a, b) => a.area - b.area);
  const kept: Surface[] = [];

  for (const c of sorted) {
    const contained = kept.some(
      (k) =>
        Math.abs(k.rect.y - c.rect.y) <= 3 &&
        c.rect.x <= k.rect.x + 1 &&
        c.rect.x + c.rect.w >= k.rect.x + k.rect.w - 1
    );
    if (!contained) kept.push(c);
  }

  return kept;
}
