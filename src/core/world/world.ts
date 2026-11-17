import { probeSurfaces } from "./probe";
import type { ProbeStats, Rect, Surface } from "./types";

const WALL_WIDTH = 8;
const WALL_INSET = 4;

/**
 * 世界模型：视口即世界。
 *
 * 滚动时宠物不跟随内容——它是屏幕上的陪伴者。
 * 但站在某个表面上时，每帧把 y 对齐该表面（骑乘 carry），
 * 表面滚走则立刻 fall，这样既不掉进虚空也不「粘」在半空。
 */
export class World {
  #ledges: Surface[] = [];
  #all: Surface[] = [];
  #floor: Surface;
  #wallLeft: Surface;
  #wallRight: Surface;
  #viewW = 0;
  #viewH = 0;
  #version = 0;
  #stats: ProbeStats = { nodes: 0, surfaces: 0, elapsedMs: 0, truncated: false };

  constructor() {
    this.#viewW = window.innerWidth;
    this.#viewH = window.innerHeight;
    this.#floor = this.#makeFloor();
    this.#wallLeft = this.#makeWall("left");
    this.#wallRight = this.#makeWall("right");
    this.#rebuild();
  }

  get version(): number {
    return this.#version;
  }

  /** 含 floor / wall 的全部表面。 */
  get surfaces(): readonly Surface[] {
    return this.#all;
  }

  /** 只有真实元素顶面，供行为决策挑选目标。 */
  get ledges(): readonly Surface[] {
    return this.#ledges;
  }

  get floor(): Surface {
    return this.#floor;
  }

  get wallLeft(): Surface {
    return this.#wallLeft;
  }

  get wallRight(): Surface {
    return this.#wallRight;
  }

  get viewport(): { w: number; h: number } {
    return { w: this.#viewW, h: this.#viewH };
  }

  get stats(): ProbeStats {
    return this.#stats;
  }

  #makeFloor(): Surface {
    return {
      id: "floor",
      kind: "floor",
      rect: { x: 0, y: this.#viewH, w: this.#viewW, h: 1 },
      el: null,
      area: this.#viewW,
      depth: 0,
    };
  }

  #makeWall(side: "left" | "right"): Surface {
    return {
      id: `wall-${side}`,
      kind: "wall",
      rect: {
        x: side === "left" ? WALL_INSET : this.#viewW - WALL_INSET - WALL_WIDTH,
        y: 0,
        w: WALL_WIDTH,
        h: this.#viewH,
      },
      el: null,
      area: WALL_WIDTH * this.#viewH,
      depth: 0,
    };
  }

  #rebuild(): void {
    this.#viewW = window.innerWidth;
    this.#viewH = window.innerHeight;
    this.#floor = this.#makeFloor();
    this.#wallLeft = this.#makeWall("left");
    this.#wallRight = this.#makeWall("right");
    this.#all = [this.#floor, this.#wallLeft, this.#wallRight, ...this.#ledges];
  }

  /** 全量重探（初次 / SPA 路由 / 结构剧变）。 */
  refresh(): ProbeStats {
    const { surfaces, stats } = probeSurfaces();
    this.#ledges = surfaces;
    this.#rebuild();
    this.#stats = stats;
    this.#version++;
    return stats;
  }

  /**
   * 只更新几何，不重新 DFS。滚动与 resize 走这里。
   * 返回 true 表示表面上剩得太少，调用方应安排一次全量重探。
   */
  syncRects(): boolean {
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const changedViewport = viewH !== this.#viewH || viewW !== this.#viewW;

    const kept: Surface[] = [];
    for (const s of this.#ledges) {
      const el = s.el;
      if (!el || !el.isConnected) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= viewH) continue;

      s.rect = { x: r.left, y: r.top, w: r.width, h: 1 };
      s.area = r.width * r.height;
      if (s.fieldRect) s.fieldRect = { x: r.left, y: r.top, w: r.width, h: r.height };
      kept.push(s);
    }

    this.#ledges = kept;
    if (changedViewport) this.#rebuild();
    else this.#all = [this.#floor, this.#wallLeft, this.#wallRight, ...this.#ledges];

    this.#version++;
    return this.#ledges.length < 10;
  }

  /** 把表面集合按 x 坐标找出来（用于「我现在站在哪」）。 */
  surfaceById(id: string): Surface | undefined {
    return this.#all.find((s) => s.id === id);
  }

  /** x 处、y 下方最近的落点。用于 fall 的着陆计算。 */
  findLanding(x: number, fromY: number): { y: number; surface: Surface } {
    let bestY = this.#viewH;
    let best = this.#floor;

    for (const s of this.#all) {
      if (s.kind === "wall") continue;
      if (x < s.rect.x || x > s.rect.x + s.rect.w) continue;
      if (s.rect.y <= fromY + 1) continue;
      if (s.rect.y < bestY) {
        bestY = s.rect.y;
        best = s;
      }
    }

    return { y: bestY, surface: best };
  }

  /** 某个点正下方最近的表面（含 floor），用于判断「脚下是什么」。 */
  supportAt(x: number, y: number, tolerance = 3): Surface {
    let best = this.#floor;
    let bestY = Infinity;

    for (const s of this.#all) {
      if (s.kind === "wall") continue;
      if (x < s.rect.x - 2 || x > s.rect.x + s.rect.w + 2) continue;
      const dy = Math.abs(s.rect.y - y);
      if (dy <= tolerance && dy < bestY) {
        bestY = dy;
        best = s;
      }
    }

    if (bestY === Infinity) return this.#floor;
    return best;
  }

  /** 输入类表面，peek 的目标。 */
  inputSurfaces(): Surface[] {
    return this.#ledges.filter((s) => s.kind === "inputTop");
  }

  /** 调试：当前所有表面的快照。 */
  debugSurfaces(): Array<{ id: string; kind: string; rect: Rect }> {
    return this.#all.map((s) => ({ id: s.id, kind: s.kind, rect: s.rect }));
  }
}
