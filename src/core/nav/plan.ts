import type { Leg } from "./types";
import type { PathResult } from "./dijkstra";

/**
 * 把 dijkstra 的边序列翻译成位移段。
 * 相邻同表面、同高度的 walk 合并成一段——否则一次长距离走位会产生几十个碎段，
 * 每段都触发一次动画切换，看起来像在抽搐。
 */
export function planLegs(path: PathResult): Leg[] {
  const legs: Leg[] = [];

  for (const edge of path.edges) {
    const leg = edge.leg;
    const last = legs[legs.length - 1];

    if (
      leg.type === "walk" &&
      last &&
      last.type === "walk" &&
      last.surfaceId === leg.surfaceId &&
      Math.abs(last.y - leg.y) < 0.5
    ) {
      last.toX = leg.toX;
      continue;
    }

    legs.push(cloneLeg(leg));
  }

  return legs;
}

function cloneLeg(leg: Leg): Leg {
  switch (leg.type) {
    case "walk":
      return { ...leg };
    case "climb":
      return { ...leg };
    case "fall":
      return { ...leg };
    case "pause":
      return { ...leg };
  }
}
