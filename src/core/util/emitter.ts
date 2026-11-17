export type Handler<T = unknown> = (payload: T) => void;

/** 极简事件发射器。on() 返回 off 句柄，方便调用方不用记函数引用。 */
export class Emitter<E extends string> {
  #map = new Map<E, Set<Handler<never>>>();

  on<T>(evt: E, fn: Handler<T>): () => void {
    let set = this.#map.get(evt);
    if (!set) {
      set = new Set();
      this.#map.set(evt, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(evt, fn);
  }

  off<T>(evt: E, fn: Handler<T>): void {
    this.#map.get(evt)?.delete(fn as Handler<never>);
  }

  emit<T>(evt: E, payload: T): void {
    const set = this.#map.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<T>)(payload);
      } catch (e) {
        console.error("[kkl-pet] listener error", e);
      }
    }
  }

  clear(): void {
    this.#map.clear();
  }
}
