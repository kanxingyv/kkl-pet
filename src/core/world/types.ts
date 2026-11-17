/** 视口坐标系下的矩形。原点左上，y 向下，单位 CSS px。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 可站立/可攀爬的表面。
 * - floor：视口底部，永远存在
 * - wall：左右视口边缘，全高可攀爬
 * - ledge：任意元素的顶面
 * - inputTop：输入类元素的顶边，额外开放 peek 行为
 */
export type SurfaceKind = "floor" | "wall" | "ledge" | "inputTop";

export interface Surface {
  id: string;
  kind: SurfaceKind;
  /** 顶面矩形（ledge/inputTop 的高度取 1，只关心 y 与 x 范围） */
  rect: Rect;
  /** DOM 引用；floor/wall 为 null */
  el: Element | null;
  /** 面积，用于降序截断与「不愿去窄台面」的惩罚 */
  area: number;
  /** DOM 深度，用于同 top 去重时偏向更精确的内层 */
  depth: number;
  /** 仅 inputTop：输入框本体，peek 用它算探头位置 */
  fieldRect?: Rect;
}

export interface ProbeStats {
  nodes: number;
  surfaces: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface ProbeConfig {
  budgetMs?: number;
  budgetNodes?: number;
  maxSurfaces?: number;
  minWidth?: number;
  minHeight?: number;
}

export function rectRight(r: Rect): number {
  return r.x + r.w;
}

export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

/** 水平区间的重叠长度（负值表示有间隙）。 */
export function overlapX(a: Rect, b: Rect): number {
  return Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
