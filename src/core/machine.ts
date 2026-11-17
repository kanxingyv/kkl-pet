import type { ClipId } from "./skin/schema";

export type StateName =
  | "boot"
  | "off"
  | "idle"
  | "walk"
  | "climb"
  | "fall"
  | "land"
  | "sit"
  | "sleep"
  | "peek"
  | "wave"
  | "jump"
  | "drag";

/** 每个状态播放的 clip。fall 与 land 分开，落地后有一段 260ms 的压扁。 */
export const STATE_CLIP: Record<StateName, ClipId | null> = {
  boot: null,
  off: null,
  idle: "idle",
  walk: "walk",
  climb: "climb",
  fall: "fall",
  land: "land",
  sit: "sit",
  sleep: "sleep",
  peek: "peek",
  wave: "wave",
  jump: "jump",
  drag: "drag",
};

/**
 * 允许的状态转移。
 * 刻意写窄：非法转移直接拒绝并告警，避免以后加功能时出现「从 off 直接跳 walk」这类脏状态。
 */
const TRANSITIONS: Record<StateName, readonly StateName[]> = {
  boot: ["idle", "off"],
  off: ["boot", "idle"],
  idle: ["walk", "climb", "fall", "land", "sit", "sleep", "peek", "wave", "jump", "drag", "off"],
  walk: ["idle", "climb", "fall", "drag", "off"],
  climb: ["idle", "fall", "drag", "off"],
  fall: ["land", "drag", "off"],
  land: ["idle", "sit", "drag", "off"],
  sit: ["idle", "peek", "sleep", "wave", "drag", "off"],
  sleep: ["idle", "drag", "off"],
  peek: ["idle", "drag", "off"],
  wave: ["idle", "drag", "off"],
  jump: ["idle", "fall", "drag", "off"],
  drag: ["fall", "idle", "off"],
};

export class StateMachine {
  #state: StateName = "boot";
  #enteredAt = 0;
  #onChange: ((next: StateName, prev: StateName) => void) | null = null;

  get state(): StateName {
    return this.#state;
  }

  get dwellMs(): number {
    return performance.now() - this.#enteredAt;
  }

  onChange(fn: (next: StateName, prev: StateName) => void): void {
    this.#onChange = fn;
  }

  can(next: StateName): boolean {
    if (next === this.#state) return false;
    return TRANSITIONS[this.#state].includes(next);
  }

  /** 强制切到某状态，忽略转移表。只给 mount / unmount 这类生命周期用。 */
  force(next: StateName): void {
    const prev = this.#state;
    this.#state = next;
    this.#enteredAt = performance.now();
    if (prev !== next) this.#onChange?.(next, prev);
  }

  set(next: StateName): boolean {
    if (!this.can(next)) {
      if (typeof console !== "undefined") {
        console.warn(`[kkl-pet] illegal transition ${this.#state} → ${next}`);
      }
      return false;
    }
    const prev = this.#state;
    this.#state = next;
    this.#enteredAt = performance.now();
    this.#onChange?.(next, prev);
    return true;
  }
}
