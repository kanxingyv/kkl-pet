/**
 * Step 02 · ingest：量基础图。
 * 输出 src/raw/_base.json：bbox、脚底锚点、主色板、描边色、alpha 覆盖率。
 * 这些数字决定后面所有动作的画布尺寸与锚点，必须只算一次。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alphaBBox, alphaCoverage, footAnchorX, readRgba } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

/** 量化到 4bit/通道后统计，够看清主色又不会被抗锯齿噪声淹没。 */
function colorPalette(rgba, topN = 12) {
  const { data } = rgba;
  const map = new Map();
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i] >> 4;
    const g = data[i + 1] >> 4;
    const b = data[i + 2] >> 4;
    const key = (r << 8) | (g << 4) | b;
    map.set(key, (map.get(key) ?? 0) + 1);
    total++;
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, count]) => ({
      hex:
        "#" +
        [(k >> 8) & 15, (k >> 4) & 15, k & 15]
          .map((v) => (v * 17).toString(16).padStart(2, "0"))
          .join(""),
      ratio: +(count / total).toFixed(4),
    }));
}

/** 从主色板里挑出最像「棕色描边」的一个。 */
function pickOutline(palette) {
  for (const c of palette) {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    if (r > 100 && r < 210 && r - g > 35 && g - b > 5) return c;
  }
  return palette[0] ?? { hex: "#a9634f", ratio: 0 };
}

export async function run() {
  const src = path.join(SKIN, "src/raw/base.png");
  const rgba = await readRgba(src);
  const bbox = alphaBBox(rgba);
  if (!bbox) throw new Error("base.png has no opaque content");

  const footX = footAnchorX(rgba, bbox);
  const palette = colorPalette(rgba);
  const outline = pickOutline(palette);

  const base = {
    source: "src/raw/base.png",
    width: rgba.width,
    height: rgba.height,
    bbox,
    anchor: { x: +footX.toFixed(1), y: bbox.top + bbox.height },
    coverage: +alphaCoverage(rgba).toFixed(4),
    palette,
    outline: outline.hex,
  };

  await mkdir(path.join(SKIN, "src/raw"), { recursive: true });
  await writeFile(path.join(SKIN, "src/raw/_base.json"), JSON.stringify(base, null, 2));

  console.log(
    `  base ${rgba.width}×${rgba.height}  bbox ${bbox.width}×${bbox.height}@${bbox.left},${bbox.top}` +
      `  anchor (${base.anchor.x}, ${base.anchor.y})  coverage ${(base.coverage * 100).toFixed(1)}%`
  );
  console.log(`  palette ${palette.slice(0, 5).map((c) => c.hex).join(" ")}  outline ${outline.hex}`);

  return base;
}

if (process.argv[1] && process.argv[1].endsWith("02-ingest.mjs")) {
  await run();
}
