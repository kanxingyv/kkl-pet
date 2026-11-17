import type { Surface } from "../world/types";
import { clamp, overlapX, rectRight } from "../world/types";
import type { World } from "../world/world";
import type { Leg, NavEdge, NavGraph, NavNode } from "./types";

const MIN_DY = 8;
const MAX_CLIMB_DY = 700;
const STEP = 88;
const MAX_X_GAP = 46;

export interface BuildOptions {
  bodyW: number;
  walkSpeed: number;
  climbSpeed: number;
}

interface SurfaceGroup {
  surface: Surface;
  idx: number[];
  xs: number[];
}

/**
 * 从世界模型建导航图。
 *
 * 节点是「表面上的采样点」，不是表面本身——这是正确性的关键：
 * 只有落在同一 x 上的两点才能靠 walk/climb 连起来，否则宠物会横飞。
 */
export function buildGraph(world: World, opts: BuildOptions): NavGraph {
  const nodes: NavNode[] = [];
  const edges: NavEdge[][] = [];
  const bySurface = new Map<string, number[]>();

  const addNode = (surfaceId: string, x: number, y: number): number => {
    const id = nodes.length;
    nodes.push({ id, surfaceId, x, y });
    edges.push([]);
    return id;
  };

  const link = (from: number, to: number, cost: number, leg: Leg): void => {
    edges[from].push({ to, cost, leg });
  };

  const walkMs = (dx: number) => (Math.abs(dx) / Math.max(1, opts.walkSpeed)) * 1000;
  const climbMs = (dy: number) => (Math.abs(dy) / Math.max(1, opts.climbSpeed)) * 1000;

  // ── 1. 每个表面按固定间距采样，得到一组可落脚点 ──
  const groups: SurfaceGroup[] = [];
  for (const s of world.surfaces) {
    if (s.kind === "wall") continue;
    const xs = sampleXs(s, opts.bodyW);
    const idx = xs.map((x) => addNode(s.id, x, s.rect.y));
    groups.push({ surface: s, idx, xs });
    bySurface.set(s.id, idx);
  }

  // ── 2. 同表面内部用线性链连接（相邻点相连，累计代价等价于直线） ──
  for (const g of groups) {
    for (let i = 0; i < g.idx.length - 1; i++) {
      const a = nodes[g.idx[i]];
      const b = nodes[g.idx[i + 1]];
      const cost = walkMs(b.x - a.x);
      link(a.id, b.id, cost, {
        type: "walk",
        surfaceId: g.surface.id,
        y: a.y,
        fromX: a.x,
        toX: b.x,
      });
      link(b.id, a.id, cost, {
        type: "walk",
        surfaceId: g.surface.id,
        y: b.y,
        fromX: b.x,
        toX: a.x,
      });
    }
  }

  // ── 3. 跨表面：上方 → 下方为 fall，下方 → 上方为 climb ──
  for (const from of groups) {
    for (const to of groups) {
      if (from === to) continue;
      if (overlapX(from.surface.rect, to.surface.rect) < opts.bodyW * 0.8) continue;

      const dy = to.surface.rect.y - from.surface.rect.y;
      if (Math.abs(dy) < MIN_DY) continue;

      const goingDown = dy > 0;
      if (!goingDown && dy < -MAX_CLIMB_DY) continue;

      for (const si of from.idx) {
        const sx = nodes[si].x;

        if (goingDown) {
          const ti = nearestIndex(to, sx);
          if (ti < 0) continue;
          const tx = nodes[ti].x;
          if (Math.abs(tx - sx) > MAX_X_GAP) continue;

          link(si, ti, 6 * dy + 350, {
            type: "fall",
            fromX: sx,
            fromY: from.surface.rect.y,
            toX: tx,
            toY: to.surface.rect.y,
          });
          continue;
        }

        // 向上爬：对齐目标表面的左右边缘。
        // 爬到卡片正中间会像从卡片内部钻出来，贴边爬才像「扒着边上去」。
        const r = opts.bodyW / 2;
        const edgeX = pickNearestEdge(to.surface, sx, r);
        const targetX = clamp(
          edgeX,
          from.surface.rect.x + r,
          rectRight(from.surface.rect) - r
        );

        const ti = nearestIndex(to, targetX);
        if (ti < 0) continue;
        const tx = nodes[ti].x;
        if (Math.abs(tx - targetX) > MAX_X_GAP) continue;

        link(si, ti, 20 * -dy + 180, {
          type: "climb",
          surfaceId: to.surface.id,
          fromX: sx,
          toX: tx,
          fromY: from.surface.rect.y,
          toY: to.surface.rect.y,
          dir: "up",
        });
      }
    }
  }

  // ── 4. 左右墙：竖直条带，为每个「有用的高度」建一个节点 ──
  for (const wall of [world.wallLeft, world.wallRight]) {
    const isLeft = wall === world.wallLeft;
    const wallX = wall.rect.x + wall.rect.w / 2;

    const ys = new Set<number>();
    ys.add(world.floor.rect.y);
    for (const g of groups) {
      const adjacent = isLeft
        ? g.surface.rect.x <= wall.rect.x + wall.rect.w
        : rectRight(g.surface.rect) >= wall.rect.x;
      if (adjacent) ys.add(Math.round(g.surface.rect.y));
    }

    const sorted = [...ys].sort((a, b) => a - b);
    const wallIdx = sorted.map((y) => addNode(wall.id, wallX, y));
    bySurface.set(wall.id, wallIdx);

    for (let i = 0; i < wallIdx.length - 1; i++) {
      const a = nodes[wallIdx[i]];
      const b = nodes[wallIdx[i + 1]];
      const cost = climbMs(b.y - a.y);
      link(a.id, b.id, cost, {
        type: "climb",
        surfaceId: wall.id,
        fromX: wallX,
        toX: wallX,
        fromY: a.y,
        toY: b.y,
        dir: "up",
      });
      link(b.id, a.id, cost, {
        type: "climb",
        surfaceId: wall.id,
        fromX: wallX,
        toX: wallX,
        fromY: b.y,
        toY: a.y,
        dir: "down",
      });
    }

    // 墙面与贴边表面之间用短 walk 连接
    for (const g of groups) {
      const adjacent = isLeft
        ? g.surface.rect.x <= wall.rect.x + wall.rect.w
        : rectRight(g.surface.rect) >= wall.rect.x;
      if (!adjacent) continue;

      const edgeNode = isLeft ? g.idx[0] : g.idx[g.idx.length - 1];
      const node = nodes[edgeNode];
      const wi = wallIdx[sorted.indexOf(Math.round(g.surface.rect.y))];
      if (wi === undefined) continue;

      const cost = walkMs(node.x - wallX);
      link(wi, edgeNode, cost, {
        type: "walk",
        surfaceId: g.surface.id,
        y: node.y,
        fromX: wallX,
        toX: node.x,
      });
      link(edgeNode, wi, cost, {
        type: "walk",
        surfaceId: wall.id,
        y: node.y,
        fromX: node.x,
        toX: wallX,
      });
    }
  }

  return { nodes, edges, bySurface };
}

/** 表面上的采样点。太窄的表面退化为中点一个点。 */
function sampleXs(s: Surface, bodyW: number): number[] {
  const r = bodyW / 2;
  const left = s.rect.x + r;
  const right = rectRight(s.rect) - r;

  if (right <= left) return [(s.rect.x + rectRight(s.rect)) / 2];

  const xs = [left];
  for (let x = left + STEP; x < right - 1; x += STEP) xs.push(x);
  if (right - xs[xs.length - 1] > 1) xs.push(right);
  return xs;
}

/** 目标表面两条可用边缘里离 x 更近的那条。 */
function pickNearestEdge(s: Surface, x: number, r: number): number {
  const left = s.rect.x + r;
  const right = rectRight(s.rect) - r;
  return Math.abs(left - x) <= Math.abs(right - x) ? left : right;
}

/** 二分找 x 最近的节点。表面节点的 xs 递增。 */
function nearestIndex(group: SurfaceGroup, x: number): number {
  const { xs, idx } = group;
  if (xs.length === 0) return -1;
  if (xs.length === 1) return idx[0];

  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const best = Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
  return idx[best];
}
