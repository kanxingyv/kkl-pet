import type { ClipId, ClipSpec } from "./skin/schema";

/**
 * 动作优先级。高优先级才能抢占低优先级，且只在帧边界接管。
 * fall / land 不可抢占——保证「不悬空、不半蹲」。
 */
export const CLIP_PRIORITY: Record<ClipId, number> = {
  drag: 100,
  fall: 90,
  land: 85,
  climb: 70,
  walk: 60,
  jump: 50,
  wave: 40,
  peek: 30,
  sit: 20,
  idle: 10,
  sleep: 5,
};

export interface PlayOptions {
  /** 同 clip 强制重播 */
  force?: boolean;
}

export class Animator {
  #clipId: ClipId = "idle";
  #spec: ClipSpec | null = null;
  #frame = 0;
  #elapsed = 0;
  #finished = false;
  #onFrame: ((frame: number, clipId: ClipId) => void) | null = null;

  setFrameHandler(fn: (frame: number, clipId: ClipId) => void): void {
    this.#onFrame = fn;
  }

  get clipId(): ClipId {
    return this.#clipId;
  }

  get frame(): number {
    return this.#frame;
  }

  get finished(): boolean {
    return this.#finished;
  }

  /** 返回是否真的切换了。 */
  play(id: ClipId, spec: ClipSpec, opts: PlayOptions = {}): boolean {
    const same = id === this.#clipId && this.#spec === spec;
    if (same && !opts.force) return false;

    if (!opts.force && !same && !this.#canPreempt(id)) return false;

    this.#clipId = id;
    this.#spec = spec;
    this.#frame = 0;
    this.#elapsed = 0;
    this.#finished = false;
    this.#onFrame?.(0, id);
    return true;
  }

  #canPreempt(next: ClipId): boolean {
    const cur = CLIP_PRIORITY[this.#clipId] ?? 0;
    const nxt = CLIP_PRIORITY[next] ?? 0;
    // 当前是一次性 clip 且还没播完，只有更高优先级能抢
    if (!this.#finished && cur >= 85) return nxt > cur;
    return nxt > cur;
  }

  update(dt: number): void {
    const spec = this.#spec;
    if (!spec || this.#finished) return;

    const frameMs = 1000 / spec.fps;
    this.#elapsed += dt;

    let changed = false;
    while (this.#elapsed >= frameMs) {
      this.#elapsed -= frameMs;
      const next = this.#frame + 1;
      if (next >= spec.frames) {
        if (spec.loop) {
          this.#frame = 0;
        } else {
          this.#frame = spec.frames - 1;
          this.#finished = true;
        }
        changed = true;
        break;
      }
      this.#frame = next;
      changed = true;
    }

    if (changed) this.#onFrame?.(this.#frame, this.#clipId);
  }
}
