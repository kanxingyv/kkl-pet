/**
 * Step 08 · from-sheet：把 AI 生成的 2×2 精灵图集切成逐帧素材。
 *
 * 与 05-procedural 的区别：那边是从一张静态图变形，这边是真正读取多帧。
 * 这一支才是「腿会动」的来源。
 *
 * 用法：
 *   node tools/petkit/steps/08-from-sheet.mjs --sheet <png/jpg> --action walk --cols 2 --rows 2
 */
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { alphaBBox, readRgba } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

const CANVAS = { w: 324, h: 324 };
const ANCHOR = { x: 162, y: 300 };
const TARGET_H = 258;

/** 背景色距离的两个阈值：低于 LO 视为纯背景，高于 HI 视为纯前景。 */
const KEY_LO = 42;
const KEY_HI = 125;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * 色键抠图 + 反解前景色。
 *
 * 只做 alpha 会把洋红留在半透明边缘（紫边）。用 C = a·F + (1-a)·B 反解 F，
 * 边缘就能还原成角色本来的颜色。
 */
function keyOut(data, bg) {
  const out = Buffer.alloc(data.length);
  const span = KEY_HI - KEY_LO;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);
    let a = (d - KEY_LO) / span;
    a = a < 0 ? 0 : a > 1 ? 1 : a;

    if (a <= 0.02) continue; // 全透明，保持 0

    out[i] = Math.max(0, Math.min(255, Math.round((r - (1 - a) * bg[0]) / a)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round((g - (1 - a) * bg[1]) / a)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round((b - (1 - a) * bg[2]) / a)));
    out[i + 3] = Math.round(a * 255);
  }

  return out;
}

/** 采样四个角的中位数作为背景色，比取单个角稳。 */
function detectBg(rgba) {
  const { data, width, height } = rgba;
  const picks = [];
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    picks.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (const [bx, by] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    for (let k = 0; k < 12; k++) {
      sample(bx ? width - 3 - k * 3 : 2 + k * 3, by ? height - 3 : 2);
    }
  }
  const med = (idx) => {
    const v = picks.map((p) => p[idx]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [med(0), med(1), med(2)];
}

export async function run() {
  const sheetPath = arg("sheet");
  const action = arg("action", "walk");
  const cols = Number(arg("cols", 2));
  const rows = Number(arg("rows", 2));

  if (!sheetPath) throw new Error("需要 --sheet <path>");

  const abs = path.isAbsolute(sheetPath) ? sheetPath : path.join(ROOT, sheetPath);
  const img = sharp(abs);
  const meta = await img.metadata();
  const cellW = Math.floor(meta.width / cols);
  const cellH = Math.floor(meta.height / rows);

  console.log(`  sheet ${meta.width}×${meta.height} → ${cols}×${rows} 格，每格 ${cellW}×${cellH}`);

  const full = await readRgba(abs);
  const bg = detectBg(full);
  console.log(`  背景色 rgb(${bg.join(", ")})`);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const raw = await sharp(abs)
        .ensureAlpha()
        .extract({ left: c * cellW, top: r * cellH, width: cellW, height: cellH })
        .raw()
        .toBuffer();

      const keyed = keyOut(raw, bg);
      const buf = await sharp(keyed, { raw: { width: cellW, height: cellH, channels: 4 } })
        .png()
        .toBuffer();

      const rgba = await readRgba(buf);
      const bbox = alphaBBox(rgba, 16);
      if (!bbox) {
        console.warn(`  格 (${c},${r}) 全透明，跳过`);
        continue;
      }
      cells.push({ buf, bbox, order: r * cols + c });
    }
  }

  if (cells.length === 0) throw new Error("切格后没有内容，检查背景色或网格");

  // 统一尺度：用各帧高度的中位数，避免某一帧画大/画小把整体带偏
  const heights = cells.map((c) => c.bbox.height).sort((a, b) => a - b);
  const medianH = heights[heights.length >> 1];
  const k = TARGET_H / medianH;

  console.log(
    `  ${cells.length} 帧，高度 ${heights.join("/")}，中位数 ${medianH}，缩放 ×${k.toFixed(3)}`
  );

  const dir = path.join(SKIN, "src/normalized", action);
  // 先清空：否则上一轮程序化生成的旧帧会混进来，帧数对不上
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const frames = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const w = Math.max(1, Math.round(cell.bbox.width * k));
    const h = Math.max(1, Math.round(cell.bbox.height * k));

    const resized = await sharp(cell.buf)
      .extract(cell.bbox)
      .resize({ width: w, height: h, fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();

    const left = Math.round(ANCHOR.x - w / 2);
    const top = Math.round(ANCHOR.y - h);

    const frame = await sharp({
      create: {
        width: CANVAS.w,
        height: CANVAS.h,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: resized, left: Math.max(0, left), top: Math.max(0, top) }])
      .png()
      .toBuffer();

    await writeFile(path.join(dir, `f${String(i).padStart(2, "0")}.png`), frame);
    frames.push(frame);
  }

  // 合并进 _motions.json，pack 才能打包
  const motionsPath = path.join(SKIN, "src/normalized/_motions.json");
  let motions = { canvas: CANVAS, anchor: ANCHOR, targetHeight: TARGET_H, motions: {} };
  try {
    motions = JSON.parse(await readFile(motionsPath, "utf8"));
  } catch {
    /* 首次运行 */
  }
  motions.motions[action] = { frames: frames.length, fps: frames.length <= 4 ? 8 : 10 };
  await writeFile(motionsPath, JSON.stringify(motions, null, 2));

  console.log(`  → src/normalized/${action}/  ${frames.length} 帧 @${motions.motions[action].fps}fps`);
  return { action, frames: frames.length };
}

if (process.argv[1] && process.argv[1].endsWith("08-from-sheet.mjs")) {
  await run();
}
