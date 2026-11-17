import type { ClipSpec, SkinManifest } from "../skin/schema";

export interface SheetLayout {
  /** sprite 元素的 CSS 宽高 */
  width: number;
  height: number;
  /** 锚点在 sprite 内的 CSS 偏移（从 sprite 左上角量），用于负 margin 对齐脚底 */
  anchorX: number;
  anchorY: number;
  /** background-size 用的纹理尺寸 */
  sheetWidth: number;
  sheetHeight: number;
  frames: number;
}

/**
 * 把 manifest 的画布坐标换算成 CSS 布局。
 * 关键：所有帧共用同一锚点，所以换算只做一次，渲染循环里不再计算。
 */
export function layoutFor(
  manifest: SkinManifest,
  clip: ClipSpec,
  displayHeight: number
): SheetLayout {
  const pr = manifest.canvas.pixelRatio || 1;
  const cssW = manifest.canvas.width / pr;
  const cssH = manifest.canvas.height / pr;
  const k = displayHeight / cssH;
  const width = cssW * k;
  const height = cssH * k;

  return {
    width,
    height,
    anchorX: (manifest.anchor.x / pr) * k,
    anchorY: (manifest.anchor.y / pr) * k,
    sheetWidth: width * clip.frames,
    sheetHeight: height,
    frames: clip.frames,
  };
}

/** 预解码，避免第一帧闪白。 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  if (typeof img.decode === "function") {
    await img.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed: " + url));
    });
  }
  return img;
}
