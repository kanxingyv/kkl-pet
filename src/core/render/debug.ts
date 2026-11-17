import type { NavNode } from "../nav/types";
import type { Surface } from "../world/types";
import { rectRight } from "../world/types";

const NS = "http://www.w3.org/2000/svg";

/**
 * 调试叠层：把世界模型画出来。
 * 这是 M1 的验收工具——「路径与真实位移逐帧一致」靠它肉眼核对。
 */
export class DebugOverlay {
  #root: HTMLElement;
  #surfaceLayer: HTMLElement;
  #pathLayer: SVGSVGElement;
  #enabled: boolean;

  constructor(container: HTMLElement, enabled: boolean) {
    this.#root = container;
    this.#enabled = enabled;
    this.#root.classList.toggle("is-on", enabled);

    this.#surfaceLayer = document.createElement("div");
    this.#root.appendChild(this.#surfaceLayer);

    this.#pathLayer = document.createElementNS(NS, "svg");
    this.#pathLayer.setAttribute("class", "pet-debug-path");
    this.#root.appendChild(this.#pathLayer);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(on: boolean): void {
    this.#enabled = on;
    this.#root.classList.toggle("is-on", on);
    if (!on) this.clear();
  }

  clear(): void {
    this.#surfaceLayer.textContent = "";
    this.#pathLayer.textContent = "";
  }

  renderSurfaces(surfaces: readonly Surface[]): void {
    if (!this.#enabled) return;
    const frag = document.createDocumentFragment();

    for (const s of surfaces) {
      const d = document.createElement("div");
      let cls = "pet-debug-surface";
      if (s.kind === "wall") cls += " is-wall";
      else if (s.kind === "floor") cls += " is-floor";
      else if (s.kind === "inputTop") cls += " is-input";
      d.className = cls;

      if (s.kind === "ledge" || s.kind === "inputTop") {
        // 顶面只是一条线，加 3px 高度便于看清
        d.style.left = `${s.rect.x}px`;
        d.style.top = `${s.rect.y}px`;
        d.style.width = `${s.rect.w}px`;
        d.style.height = "3px";
      } else {
        d.style.left = `${s.rect.x}px`;
        d.style.top = `${s.rect.y}px`;
        d.style.width = `${s.rect.w}px`;
        d.style.height = `${s.rect.h}px`;
      }
      frag.appendChild(d);

      if (s.kind === "inputTop") {
        const label = document.createElement("div");
        label.className = "pet-debug-label";
        label.textContent = `input ${Math.round(s.rect.w)}×${Math.round(s.fieldRect?.h ?? 0)}`;
        label.style.left = `${s.rect.x}px`;
        label.style.top = `${s.rect.y}px`;
        frag.appendChild(label);
      }
    }

    this.#surfaceLayer.textContent = "";
    this.#surfaceLayer.appendChild(frag);
  }

  renderPath(nodes: NavNode[]): void {
    if (!this.#enabled) return;
    this.#pathLayer.textContent = "";
    if (nodes.length < 2) return;

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const line = document.createElementNS(NS, "line");
      line.setAttribute("class", "pet-debug-leg");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      this.#pathLayer.appendChild(line);
    }

    for (const n of nodes) {
      const dot = document.createElement("div");
      dot.className = "pet-debug-port";
      dot.style.left = `${n.x}px`;
      dot.style.top = `${n.y}px`;
      this.#surfaceLayer.appendChild(dot);
    }
  }

  renderPorts(nodes: NavNode[]): void {
    if (!this.#enabled) return;
    for (const n of nodes) {
      const dot = document.createElement("div");
      dot.className = "pet-debug-port";
      dot.style.left = `${n.x}px`;
      dot.style.top = `${n.y}px`;
      this.#surfaceLayer.appendChild(dot);
    }
  }

  /** 表面右边界（调试用，标出可站立范围）。 */
  static bounds(s: Surface): [number, number] {
    return [s.rect.x, rectRight(s.rect)];
  }
}
