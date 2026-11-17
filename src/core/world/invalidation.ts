const HOST_ID = "kkl-pet-host";

export interface InvalidationHandlers {
  /** DOM 结构变化 → 需要全量重探 */
  onStructural(): void;
  /** 滚动 / resize → 只需重算几何 */
  onGeometry(): void;
}

/**
 * 世界失效监听。
 * 三类事件分开处理：结构变化重探、几何变化只重算 rect、页面隐藏时整体停掉。
 */
export class Invalidation {
  #handlers: InvalidationHandlers;
  #root: Element;
  #mo: MutationObserver | null = null;
  #structTimer = 0;
  #geoQueued = false;
  #geoLast = 0;
  #active = false;

  constructor(handlers: InvalidationHandlers, root: Element = document.documentElement) {
    this.#handlers = handlers;
    this.#root = root;
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;

    this.#mo = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target as Element | null;
        if (!t) continue;
        if (t.id === HOST_ID || (t.closest && t.closest(`#${HOST_ID}`))) continue;
        this.#scheduleStructural();
        return;
      }
    });

    this.#mo.observe(this.#root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "aria-hidden"],
    });

    addEventListener("scroll", this.#onScroll, { passive: true, capture: true });
    addEventListener("resize", this.#onScroll, { passive: true });
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#mo?.disconnect();
    this.#mo = null;
    removeEventListener("scroll", this.#onScroll, { capture: true });
    removeEventListener("resize", this.#onScroll);
    clearTimeout(this.#structTimer);
    this.#structTimer = 0;
    this.#geoQueued = false;
  }

  #scheduleStructural(): void {
    clearTimeout(this.#structTimer);
    this.#structTimer = setTimeout(() => {
      this.#structTimer = 0;
      if (this.#active) this.#handlers.onStructural();
    }, 300) as unknown as number;
  }

  #onScroll = (): void => {
    if (!this.#active || this.#geoQueued) return;
    this.#geoQueued = true;

    // 100ms 节流：48 次 getBoundingClientRect 约 0.3ms，比重新 DFS 便宜一个数量级
    const wait = Math.max(0, 100 - (performance.now() - this.#geoLast));
    setTimeout(() => {
      this.#geoQueued = false;
      this.#geoLast = performance.now();
      if (this.#active) this.#handlers.onGeometry();
    }, wait);
  };
}
