export interface DragHandlers {
  onStart(x: number, y: number): void;
  onMove(x: number, y: number): void;
  /** vx/vy 单位 px/ms，用于松手后的抛掷 */
  onEnd(x: number, y: number, vx: number, vy: number): void;
}

/**
 * 拖拽。只绑在角色本体上（sprite 层 pointer-events: auto），
 * 页面其余区域的点击原样透传。
 */
export class DragController {
  #handlers: DragHandlers;
  #getPos: () => { x: number; y: number };
  #el: HTMLElement | null = null;
  #dragging = false;
  #grab = { x: 0, y: 0 };
  #last = { x: 0, y: 0, t: 0 };
  #vel = { x: 0, y: 0 };

  constructor(handlers: DragHandlers, getPos: () => { x: number; y: number }) {
    this.#handlers = handlers;
    this.#getPos = getPos;
  }

  get dragging(): boolean {
    return this.#dragging;
  }

  attach(el: HTMLElement): void {
    this.#el = el;
    el.addEventListener("pointerdown", this.#onDown);
  }

  detach(): void {
    if (!this.#el) return;
    this.#el.removeEventListener("pointerdown", this.#onDown);
    this.#el = null;
    this.#stop();
  }

  #onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();

    const pos = this.#getPos();
    this.#dragging = true;
    this.#grab = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    this.#last = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.#vel = { x: 0, y: 0 };

    this.#el?.setPointerCapture(e.pointerId);
    addEventListener("pointermove", this.#onMove, { passive: false });
    addEventListener("pointerup", this.#onUp);
    addEventListener("pointercancel", this.#onUp);

    this.#handlers.onStart(pos.x, pos.y);
  };

  #onMove = (e: PointerEvent): void => {
    if (!this.#dragging) return;
    e.preventDefault();

    const x = e.clientX - this.#grab.x;
    const y = e.clientY - this.#grab.y;

    const now = performance.now();
    const dt = Math.max(1, now - this.#last.t);
    // 指数平滑，避免最后一帧抖动决定抛掷方向
    this.#vel.x = this.#vel.x * 0.65 + ((x - this.#last.x) / dt) * 0.35;
    this.#vel.y = this.#vel.y * 0.65 + ((y - this.#last.y) / dt) * 0.35;
    this.#last = { x, y, t: now };

    this.#handlers.onMove(x, y);
  };

  #onUp = (e: PointerEvent): void => {
    if (!this.#dragging) return;
    this.#stop();

    const x = e.clientX - this.#grab.x;
    const y = e.clientY - this.#grab.y;
    this.#handlers.onEnd(x, y, this.#vel.x, this.#vel.y);
  };

  #stop(): void {
    this.#dragging = false;
    removeEventListener("pointermove", this.#onMove);
    removeEventListener("pointerup", this.#onUp);
    removeEventListener("pointercancel", this.#onUp);
  }
}
