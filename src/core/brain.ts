import type { Behaviors } from "./skin/schema";
import type { SurfaceKind } from "./world/types";
import type { World } from "./world/world";
import type { StateName } from "./machine";

export interface BrainContext {
  now: number;
  state: StateName;
  x: number;
  y: number;
  surfaceId: string;
  surfaceKind: SurfaceKind;
  world: World;
  behaviors: Behaviors;
}

export type Intent =
  | { kind: "wander"; surfaceId: string; x: number }
  | { kind: "idle" }
  | { kind: "sit" }
  | { kind: "sleep" }
  | { kind: "peek" }
  | { kind: "wave" }
  | { kind: "jump" };

type ActionKey = "wander" | "idle" | "sit" | "peek" | "wave" | "jump" | "sleep";

/**
 * 行为决策器。只产出 Intent，不移动宠物、不碰 DOM。
 *
 * 防抽搐的三条硬规则：
 * 1. 决策有随机间隔（brainTickMs）
 * 2. 同一动作有冷却（sameActionCooldownMs）
 * 3. 用户刚滚动/动鼠标后有静默期（interruptByUserMs）
 */
export class Brain {
  #nextTick = 0;
  #lastAction: ActionKey | null = null;
  #lastActionAt = 0;
  #lastInteractAt = 0;
  #lastMoveEndAt = 0;
  #idleSince = 0;
  #blacklist = new Map<string, number>();

  noteUserInput(): void {
    this.#lastInteractAt = performance.now();
    this.#idleSince = 0;
  }

  noteMoveEnd(): void {
    this.#lastMoveEndAt = performance.now();
  }

  noteIdleSince(now: number): void {
    if (!this.#idleSince) this.#idleSince = now;
  }

  resetIdle(): void {
    this.#idleSince = 0;
  }

  blacklistTarget(surfaceId: string, now: number): void {
    this.#blacklist.set(surfaceId, now + 30_000);
  }

  decide(ctx: BrainContext): Intent | null {
    if (ctx.now < this.#nextTick) return null;

    const b = ctx.behaviors;
    const [lo, hi] = b.brainTickMs;
    this.#nextTick = ctx.now + lo + Math.random() * Math.max(1, hi - lo);

    // 用户刚操作过：安静待着，别抢注意力
    if (ctx.now - this.#lastInteractAt < b.interruptByUserMs) return { kind: "idle" };

    // 刚走完一段，观察期
    if (ctx.now - this.#lastMoveEndAt < b.moveCooldownMs) return null;

    if (
      this.#idleSince &&
      ctx.now - this.#idleSince > b.idleToSleepMs &&
      (ctx.state === "idle" || ctx.state === "sit")
    ) {
      return this.#record("sleep", ctx.now, { kind: "sleep" });
    }

    const options: Array<[ActionKey, number, () => Intent]> = [];

    const target = this.#pickTarget(ctx);
    if (target) {
      options.push(["wander", b.weights.wander ?? 0, () => ({ kind: "wander", ...target })]);
    }
    options.push(["idle", b.weights.idle ?? 0, () => ({ kind: "idle" })]);
    if (ctx.surfaceKind !== "floor") {
      options.push(["sit", b.weights.sit ?? 0, () => ({ kind: "sit" })]);
      options.push(["jump", b.weights.jump ?? 0, () => ({ kind: "jump" })]);
    }
    if (ctx.world.inputSurfaces().length > 0) {
      options.push(["peek", b.weights.peek ?? 0, () => ({ kind: "peek" })]);
    }
    options.push(["wave", b.weights.wave ?? 0, () => ({ kind: "wave" })]);

    const usable = options.filter(([key, weight]) => {
      if (weight <= 0) return false;
      if (key === this.#lastAction && ctx.now - this.#lastActionAt < b.sameActionCooldownMs) {
        return false;
      }
      return true;
    });

    if (usable.length === 0) return null;

    const total = usable.reduce((n, [, w]) => n + w, 0);
    let roll = Math.random() * total;
    for (const [key, weight, make] of usable) {
      roll -= weight;
      if (roll <= 0) return this.#record(key, ctx.now, make());
    }

    const last = usable[usable.length - 1];
    return this.#record(last[0], ctx.now, last[2]());
  }

  #record(key: ActionKey, now: number, intent: Intent): Intent {
    this.#lastAction = key;
    this.#lastActionAt = now;
    if (key !== "idle" && key !== "sleep") this.#idleSince = 0;
    return intent;
  }

  #pickTarget(ctx: BrainContext): { surfaceId: string; x: number } | null {
    const minTravel = ctx.behaviors.minTravelPx;
    const candidates: Array<{ surfaceId: string; x: number; d: number }> = [];

    for (const s of ctx.world.ledges) {
      const until = this.#blacklist.get(s.id) ?? 0;
      if (until > ctx.now) continue;
      if (s.id === ctx.surfaceId) continue;

      const cx = s.rect.x + s.rect.w / 2;
      const d = Math.abs(cx - ctx.x) + Math.abs(s.rect.y - ctx.y);
      if (d < minTravel) continue;
      // 太远的目标会变成十几秒的爬墙，自己玩的时候不该这么选
      if (d > 700) continue;
      candidates.push({ surfaceId: s.id, x: cx, d });
    }

    // 地面永远是一个可以回去的目标
    if (ctx.surfaceKind !== "floor") {
      const f = ctx.world.floor;
      candidates.push({ surfaceId: f.id, x: Math.min(Math.max(ctx.x, 60), ctx.world.viewport.w - 60), d: 200 });
    }

    if (candidates.length === 0) return null;

    // 偏向近处：取最近 5 个里随机一个，避免总是走最远的
    candidates.sort((a, b) => a.d - b.d);
    const pool = candidates.slice(0, Math.min(5, candidates.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { surfaceId: pick.surfaceId, x: pick.x };
  }
}
