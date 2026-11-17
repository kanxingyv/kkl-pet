/** 一段连续位移。所有位置变化都必须由这些段组成——不存在「直接设置坐标」。 */
export type Leg =
  | { type: "walk"; surfaceId: string; y: number; fromX: number; toX: number }
  | {
      type: "climb";
      surfaceId: string;
      /** 起爬的横向位置 */
      fromX: number;
      /** 爬到顶的横向位置。两者不同则表现为斜爬，避免到顶瞬间横移 */
      toX: number;
      fromY: number;
      toY: number;
      dir: "up" | "down";
    }
  | { type: "fall"; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "pause"; ms: number };

export interface NavNode {
  id: number;
  surfaceId: string;
  x: number;
  y: number;
}

export interface NavEdge {
  to: number;
  /** 代价，单位毫秒（预计耗时），便于让 Dijkstra 偏向「快」而非「短」 */
  cost: number;
  leg: Leg;
}

export interface NavGraph {
  nodes: NavNode[];
  edges: NavEdge[][];
  /** surfaceId → 该表面上的节点索引（按 x 升序） */
  bySurface: Map<string, number[]>;
}
