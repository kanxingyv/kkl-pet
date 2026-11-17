/**
 * Step 01 · idle：从一张静态基础图程序化生成呼吸循环，零 credits。
 *
 * 只用整体垂直缩放 + 轻微上浮表达呼吸，脚底锚点全程不动。
 * 输出 out/idle.webp（水平条）与 src/normalized/idle/_metrics.json。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  alphaBBox,
  alphaCoverage,
  footAnchorX,
  placeAtAnchor,
  readRgba,
  stripHorizontal,
} from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

export const CANVAS = { w: 324, h: 324 };
export const ANCHOR = { x: 162, y: 300 };
const TARGET_H = 258;
const FRAMES = 10;
const BOB = 1.8;

export async function run() {
  const src = path.join(SKIN, "src/raw/base.png");
  const rgba = await readRgba(src);
  const bbox = alphaBBox(rgba);
  if (!bbox) throw new Error("base.png has no opaque content");

  const footX = footAnchorX(rgba, bbox);
  const footY = bbox.top + bbox.height;
  console.log(
    `  base ${rgba.width}x${rgba.height}  bbox ${bbox.width}x${bbox.height}@${bbox.left},${bbox.top}` +
      `  foot (${footX.toFixed(1)}, ${footY})  coverage ${(alphaCoverage(rgba) * 100).toFixed(1)}%`
  );

  // 裁到内容再统一缩放，避免原图四周透明留白影响比例
  const content = await sharp(src).ensureAlpha().extract(bbox).png().toBuffer();

  const frames = [];
  const metrics = [];

  for (let i = 0; i < FRAMES; i++) {
    const phase = (i / FRAMES) * Math.PI * 2;
    const s = Math.sin(phase);
    const scaleY = 1 + 0.025 * s;
    const dy = -BOB * Math.max(0, s);

    const buf = await placeAtAnchor(content, {
      canvasW: CANVAS.w,
      canvasH: CANVAS.h,
      anchorX: ANCHOR.x,
      anchorY: ANCHOR.y,
      targetHeight: TARGET_H,
      scaleY,
      dy,
    });
    frames.push(buf);

    const frameRgba = await readRgba(buf);
    const fb = alphaBBox(frameRgba);
    metrics.push({
      frame: i,
      scaleY: +scaleY.toFixed(4),
      dy: +dy.toFixed(2),
      top: fb.top,
      bottom: fb.top + fb.height,
      height: fb.height,
      coverage: +alphaCoverage(frameRgba).toFixed(4),
    });
  }

  await mkdir(path.join(SKIN, "src/normalized/idle"), { recursive: true });
  await mkdir(path.join(SKIN, "out"), { recursive: true });

  for (let i = 0; i < frames.length; i++) {
    await writeFile(
      path.join(SKIN, `src/normalized/idle/f${String(i).padStart(2, "0")}.png`),
      frames[i]
    );
  }

  const webp = await stripHorizontal(frames, { frameW: CANVAS.w, frameH: CANVAS.h });
  await writeFile(path.join(SKIN, "out/idle.webp"), webp);

  const driftTop = Math.max(...metrics.map((m) => m.top)) - Math.min(...metrics.map((m) => m.top));
  const bottoms = metrics.map((m) => m.bottom);
  console.log(
    `  idle ${FRAMES} frames → out/idle.webp ${(webp.length / 1024).toFixed(1)}KB` +
      `  topDrift ${driftTop}px  bottom ${Math.min(...bottoms)}..${Math.max(...bottoms)}`
  );

  await writeFile(
    path.join(SKIN, "src/normalized/idle/_metrics.json"),
    JSON.stringify({ canvas: CANVAS, anchor: ANCHOR, targetHeight: TARGET_H, frames: metrics }, null, 2)
  );

  return { frames: FRAMES, bytes: webp.length, metrics };
}

if (process.argv[1] && process.argv[1].endsWith("01-idle.mjs")) {
  await run();
}
