import type { ClipId, ClipSpec, SkinManifest } from "../skin/schema";
import type { PetLayers } from "./host-el";
import { layoutFor, loadImage, type SheetLayout } from "./sheet";

/**
 * 渲染器：把状态翻译成最少的 style 写入。
 * 每帧最多 3 次写入（root transform / flip / squash），换帧时才多一次 background-position。
 */
export class Renderer {
  #layers: PetLayers;
  #manifest: SkinManifest;
  #displayHeight: number;
  #layout: SheetLayout | null = null;
  #currentFrame = -1;
  #flipped = false;
  #sx = 1;
  #sy = 1;
  #images = new Map<string, HTMLImageElement>();

  constructor(layers: PetLayers, manifest: SkinManifest, displayHeight: number) {
    this.#layers = layers;
    this.#manifest = manifest;
    this.#displayHeight = displayHeight;

    // 投影与尘土颜色来自皮肤，用 CSS 变量注入（CSSOM 写入，不受 CSP 限制）
    layers.root.style.setProperty("--pet-shadow-color", manifest.fx.shadowColor);
    layers.root.style.setProperty("--pet-dust-color", manifest.fx.dustColor);
  }

  get layout(): SheetLayout | null {
    return this.#layout;
  }

  /** 预解码并缓存。切换 clip 时只改样式，无网络/解码延迟。 */
  async preload(url: string): Promise<void> {
    if (this.#images.has(url)) return;
    const img = await loadImage(url);
    this.#images.set(url, img);
  }

  /** 同步切换到某个 clip。要求该 url 已经 preload 过。 */
  applyClip(clip: ClipSpec, url: string): void {
    const layout = layoutFor(this.#manifest, clip, this.#displayHeight);
    const { sprite } = this.#layers;

    sprite.style.width = `${layout.width}px`;
    sprite.style.height = `${layout.height}px`;
    // 负 margin 把画布锚点搬到父元素原点（= 脚底）。之后翻转/挤压都绕原点进行。
    sprite.style.marginLeft = `${-layout.anchorX}px`;
    sprite.style.marginTop = `${-layout.anchorY}px`;
    sprite.style.backgroundSize = `${layout.sheetWidth}px ${layout.sheetHeight}px`;
    sprite.style.backgroundImage = `url("${url}")`;

    this.#layout = layout;
    this.#currentFrame = -1;
    this.setFrame(0);
  }

  setFrame(index: number): void {
    if (!this.#layout || index === this.#currentFrame) return;
    this.#currentFrame = index;
    this.#layers.sprite.style.backgroundPosition = `${-index * this.#layout.width}px 0px`;
  }

  setPosition(x: number, y: number): void {
    this.#layers.root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  setFlip(flipped: boolean): void {
    if (flipped === this.#flipped) return;
    this.#flipped = flipped;
    this.#layers.flip.style.transform = `scaleX(${flipped ? -1 : 1})`;
  }

  setSquash(sx: number, sy: number): void {
    if (Math.abs(sx - this.#sx) < 0.0005 && Math.abs(sy - this.#sy) < 0.0005) return;
    this.#sx = sx;
    this.#sy = sy;
    this.#layers.squash.style.transform = `scale(${sx}, ${sy})`;
  }

  /** 投影随离地高度变化：越高越小越淡。 */
  setShadow(heightAbove: number): void {
    const k = Math.max(0.35, 1 - heightAbove / 900);
    this.#layers.shadow.style.opacity = String(Math.max(0.05, 0.28 * k));
    this.#layers.shadow.style.transform = `scale(${k}, ${k})`;
  }

  show(visible: boolean): void {
    this.#layers.root.classList.toggle("is-hidden", !visible);
  }

  /** 落地尘土。纯 CSS 动画，JS 只在两端加/去 class。 */
  dust(): void {
    const { fx } = this.#layers;
    fx.classList.remove("is-dust");
    // 强制回流以重启动画（读取 offsetWidth 是这里有意的副作用）
    void fx.offsetWidth;
    fx.classList.add("is-dust");
  }

  setDragging(isDragging: boolean): void {
    this.#layers.sprite.classList.toggle("is-dragging", isDragging);
  }

  /** 一次性压扁回弹。用 WAAPI，不手写逐帧。 */
  landSquash(): void {
    const [a, b, c] = this.#manifest.fx.landSquash;
    const el = this.#layers.squash;
    if (typeof el.animate !== "function") return;
    el.animate(
      [
        { transform: `scale(1, ${a})` },
        { transform: `scale(${(2 - b).toFixed(3)}, ${b})` },
        { transform: `scale(1, ${c})` },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1.2,.36,1)" }
    );
  }

  destroy(): void {
    this.#layers.host.remove();
  }
}

export type { ClipId };
