import type { ClipId } from "../skin/schema";
import type { Leg } from "./types";

const CLIMB_ENTER_MS = 100;
const MIN_DURATION_MS = 80;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

export interface RunnerSnapshot {
  x: number;
  y: number;
  clip: ClipId;
  surfaceId: string;
  legIndex: number;
  legCount: number;
  done: boolean;
  /** 当前段的方向，供渲染层做翻转 */
  dx: number;
}

/**
 * 位移段执行器。
 *
 * 严格保证：位置只能随 walk/climb/fall 连续变化。
 * 每段结束时坐标精确等于段的终点（插值 p=1 时赋值，不做「吸附」）。
 */
export class LegRunner {
  #legs: Leg[] = [];
  #i = 0;
  #x = 0;
  #y = 0;
  #surfaceId = "floor";
  #t = 0;
  #vy = 0;
  #vx = 0;
  #done = true;
  #finishedHandler: (() => void) | null = null;

  get done(): boolean {
    return this.#done;
  }

  get snapshot(): RunnerSnapshot {
    const leg = this.#legs[this.#i];
    return {
      x: this.#x,
      y: this.#y,
      clip: this.#clipFor(leg),
      surfaceId: this.#surfaceId,
      legIndex: this.#i,
      legCount: this.#legs.length,
      done: this.#done,
      dx: leg && (leg.type === "walk" || leg.type === "climb") ? leg.toX - leg.fromX : 0,
    };
  }

  get remaining(): number {
    return Math.max(0, this.#legs.length - this.#i);
  }

  /** 当前段类型，仅用于诊断日志。 */
  get currentLegType(): string {
    return this.#legs[this.#i]?.type ?? "none";
  }

  onFinished(fn: () => void): void {
    this.#finishedHandler = fn;
  }

  start(legs: Leg[], x: number, y: number, surfaceId: string): void {
    this.#legs = legs;
    this.#i = 0;
    this.#x = x;
    this.#y = y;
    this.#surfaceId = surfaceId;
    this.#done = legs.length === 0;
    this.#enterLeg();
    if (this.#done) this.#finishedHandler?.();
  }

  stop(): void {
    this.#legs = [];
    this.#done = true;
  }

  /** 外部强制同步当前位置（拖拽结束时用）。 */
  teleportTo(x: number, y: number, surfaceId: string): void {
    this.#legs = [];
    this.#i = 0;
    this.#x = x;
    this.#y = y;
    this.#surfaceId = surfaceId;
    this.#done = true;
  }

  step(dt: number, walkSpeed: number, climbSpeed: number, gravity: number, terminal: number): void {
    if (this.#done) return;
    const leg = this.#legs[this.#i];
    if (!leg) {
      this.#finish();
      return;
    }

    this.#t += dt;

    switch (leg.type) {
      case "pause": {
        if (this.#t >= leg.ms) this.#next();
        break;
      }

      case "walk": {
        const dur = Math.max(
          MIN_DURATION_MS,
          (Math.abs(leg.toX - leg.fromX) / Math.max(1, walkSpeed)) * 1000
        );
        const p = Math.min(1, this.#t / dur);
        this.#x = leg.fromX + (leg.toX - leg.fromX) * easeInOut(p);
        this.#y = leg.y;
        if (p >= 1) {
          this.#x = leg.toX;
          this.#next();
        }
        break;
      }

      case "climb": {
        if (this.#t < CLIMB_ENTER_MS) {
          this.#x = leg.fromX;
          this.#y = leg.fromY;
          break;
        }
        const dur = Math.max(
          MIN_DURATION_MS,
          (Math.abs(leg.toY - leg.fromY) / Math.max(1, climbSpeed)) * 1000
        );
        const p = Math.min(1, (this.#t - CLIMB_ENTER_MS) / dur);
        // 横移摊进攀爬时长里：视觉上是斜着爬，而不是到顶后突然平移
        this.#x = leg.fromX + (leg.toX - leg.fromX) * p;
        this.#y = leg.fromY + (leg.toY - leg.fromY) * p;
        if (p >= 1) {
          this.#x = leg.toX;
          this.#y = leg.toY;
          this.#next();
        }
        break;
      }

      case "fall": {
        const dy = Math.max(1, leg.toY - leg.fromY);
        // 水平速度按「自由落体所需时间」分配，避免横飞
        if (this.#vx === 0) {
          const estSec = Math.sqrt((2 * dy) / Math.max(1, gravity));
          this.#vx = (leg.toX - leg.fromX) / Math.max(0.05, estSec);
        }
        this.#vy = Math.min(terminal, this.#vy + (gravity * dt) / 1000);
        this.#y += (this.#vy * dt) / 1000;
        this.#x += (this.#vx * dt) / 1000;

        if (this.#y >= leg.toY) {
          this.#y = leg.toY;
          this.#x = leg.toX;
          this.#next();
        }
        break;
      }
    }
  }

  #clipFor(leg: Leg | undefined): ClipId {
    if (this.#done || !leg) return "idle";
    switch (leg.type) {
      case "walk":
        return "walk";
      case "climb":
        return "climb";
      case "fall":
        return "fall";
      case "pause":
        return "idle";
    }
  }

  #enterLeg(): void {
    this.#t = 0;
    this.#vy = 0;
    this.#vx = 0;
    const leg = this.#legs[this.#i];
    if (!leg) {
      this.#finish();
      return;
    }
    if (leg.type === "walk") this.#surfaceId = leg.surfaceId;
    else if (leg.type === "climb") this.#surfaceId = leg.surfaceId;
  }

  #next(): void {
    this.#i += 1;
    if (this.#i >= this.#legs.length) {
      this.#finish();
      return;
    }
    this.#enterLeg();
  }

  #finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#finishedHandler?.();
  }
}
