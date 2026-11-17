import type { NavEdge, NavGraph } from "./types";

/** 二叉小根堆。图规模 ≤ 600 节点，手写一个够用，省一个依赖。 */
class MinHeap {
  #keys: number[] = [];
  #vals: number[] = [];

  get size(): number {
    return this.#keys.length;
  }

  push(key: number, val: number): void {
    this.#keys.push(key);
    this.#vals.push(val);
    let i = this.#keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#keys[p] <= this.#keys[i]) break;
      this.#swap(i, p);
      i = p;
    }
  }

  pop(): { key: number; val: number } | null {
    if (this.#keys.length === 0) return null;
    const key = this.#keys[0];
    const val = this.#vals[0];

    const lastKey = this.#keys.pop() as number;
    const lastVal = this.#vals.pop() as number;

    if (this.#keys.length > 0) {
      this.#keys[0] = lastKey;
      this.#vals[0] = lastVal;
      let i = 0;
      const n = this.#keys.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.#keys[l] < this.#keys[m]) m = l;
        if (r < n && this.#keys[r] < this.#keys[m]) m = r;
        if (m === i) break;
        this.#swap(i, m);
        i = m;
      }
    }

    return { key, val };
  }

  #swap(a: number, b: number): void {
    const k = this.#keys[a];
    this.#keys[a] = this.#keys[b];
    this.#keys[b] = k;
    const v = this.#vals[a];
    this.#vals[a] = this.#vals[b];
    this.#vals[b] = v;
  }
}

export interface PathResult {
  cost: number;
  /** 依次经过的边 */
  edges: NavEdge[];
  /** 依次经过的节点索引（含起点与终点） */
  nodeIds: number[];
}

/**
 * Dijkstra。
 * 不用 BFS：走与爬的边权差 2 倍以上，BFS 会规划出「先爬墙绕一圈再横穿」的荒谬路线。
 * 不用 A*：图规模下单次 < 1ms，启发函数在垂直优先图上难保可采纳性，不值得。
 */
export function dijkstra(graph: NavGraph, startId: number, goalId: number): PathResult | null {
  const n = graph.nodes.length;
  if (startId < 0 || goalId < 0 || startId >= n || goalId >= n) return null;
  if (startId === goalId) return { cost: 0, edges: [], nodeIds: [startId] };

  const dist = new Float64Array(n).fill(Infinity);
  const prevNode = new Int32Array(n).fill(-1);
  const prevEdge = new Array<NavEdge | null>(n).fill(null);
  const done = new Uint8Array(n);

  const heap = new MinHeap();
  dist[startId] = 0;
  heap.push(0, startId);

  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    const cur = top.val;
    if (done[cur]) continue;
    done[cur] = 1;

    if (cur === goalId) break;

    const edges = graph.edges[cur];
    if (!edges) continue;

    for (const e of edges) {
      if (done[e.to]) continue;
      const nd = dist[cur] + e.cost;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prevNode[e.to] = cur;
        prevEdge[e.to] = e;
        heap.push(nd, e.to);
      }
    }
  }

  if (!Number.isFinite(dist[goalId])) return null;

  const nodeIds: number[] = [];
  const edges: NavEdge[] = [];
  let cur = goalId;
  while (cur !== startId && cur !== -1) {
    nodeIds.push(cur);
    const e = prevEdge[cur];
    if (!e) return null;
    edges.push(e);
    cur = prevNode[cur];
  }
  nodeIds.push(startId);

  nodeIds.reverse();
  edges.reverse();

  return { cost: dist[goalId], edges, nodeIds };
}
