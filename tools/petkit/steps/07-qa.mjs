/**
 * Step 07 · qa：产出 contact sheet 并做一致性检查。
 *
 * 程序化素材的常见问题是「锚点漂移」和「尺度跳变」——这在走路时会表现为左右抖/上下抽。
 * 这里逐帧量 bbox 底边与高度，超出阈值直接报错。
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { alphaBBox, readRgba } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

const SCALE = 0.5;

export async function run() {
  const motions = JSON.parse(
    await readFile(path.join(SKIN, "src/normalized/_motions.json"), "utf8")
  );
  const { w: cw, h: ch } = motions.canvas;
  const anchorY = motions.anchor.y;

  const report = {};
  const problems = [];
  const outDir = path.join(SKIN, "out/_contact");
  await mkdir(outDir, { recursive: true });

  for (const name of Object.keys(motions.motions)) {
    const dir = path.join(SKIN, "src/normalized", name);
    if (!existsSync(dir)) continue;

    const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    if (files.length === 0) continue;

    const rows = [];
    let minBottom = Infinity;
    let maxBottom = -Infinity;
    let minTop = Infinity;
    let maxTop = -Infinity;

    for (const f of files) {
      const buf = await readFile(path.join(dir, f));
      const rgba = await readRgba(buf);
      const bbox = alphaBBox(rgba);
      if (!bbox) {
        problems.push(`${name}/${f}: 全透明`);
        continue;
      }
      const bottom = bbox.top + bbox.height;
      minBottom = Math.min(minBottom, bottom);
      maxBottom = Math.max(maxBottom, bottom);
      minTop = Math.min(minTop, bbox.top);
      maxTop = Math.max(maxTop, bbox.top);

      // 缩到 50% 再拼，contact sheet 才看得下
      const thumb = await sharp(buf)
        .resize({ width: Math.round(cw * SCALE), height: Math.round(ch * SCALE) })
        .png()
        .toBuffer();
      rows.push(thumb);
    }

    if (rows.length === 0) continue;

    const tw = Math.round(cw * SCALE);
    const th = Math.round(ch * SCALE);

    // 锚点基准线：画一条 1px 红线，肉眼就能看出脚底是否在同一条线
    const baselineY = Math.round(anchorY * SCALE);
    const line = await sharp({
      create: { width: tw, height: 1, channels: 4, background: { r: 220, g: 60, b: 50, alpha: 0.85 } },
    })
      .png()
      .toBuffer();

    const sheet = await sharp({
      create: {
        width: tw * rows.length,
        height: th,
        channels: 4,
        background: { r: 250, g: 246, b: 239, alpha: 1 },
      },
    })
      .composite([
        ...rows.map((buf, i) => ({ input: buf, left: i * tw, top: 0 })),
        { input: line, left: 0, top: Math.min(th - 1, baselineY) },
      ])
      .png()
      .toBuffer();

    await writeFile(path.join(outDir, `${name}.png`), sheet);

    const drift = maxBottom - minBottom;
    const heightVar = maxTop - minTop;
    report[name] = {
      frames: rows.length,
      bottomDrift: drift,
      topDrift: heightVar,
      canvas: `${cw}×${ch}`,
    };

    // 脚底漂移上限按动作区分：爬行的 dy 是刻意的「往上蹭」，走/落应几乎不动
    // jump 的离地、land 的压扁都是设计意图，单独放宽
    const LIMITS = { idle: 4, walk: 4, climb: 8, fall: 4, peek: 4, sit: 4, sleep: 4, wave: 4, drag: 4, jump: 30, land: 6 };
    const TOP_LIMITS = { land: 80, jump: 40 };
    const limit = LIMITS[name] ?? 5;
    const topLimit = TOP_LIMITS[name] ?? 26;
    if (drift > limit) problems.push(`${name}: 脚底漂移 ${drift}px > ${limit}px`);
    if (heightVar > topLimit) problems.push(`${name}: 顶部起伏 ${heightVar}px > ${topLimit}px`);
  }

  await writeFile(path.join(SKIN, "out/_contact/_qa.json"), JSON.stringify({ report, problems }, null, 2));

  console.log("  action   frames  bottomDrift  topDrift");
  for (const [k, v] of Object.entries(report)) {
    console.log(
      `  ${k.padEnd(8)} ${String(v.frames).padStart(4)}  ${String(v.bottomDrift).padStart(9)}px  ${String(v.topDrift).padStart(6)}px`
    );
  }
  console.log(problems.length === 0 ? "  ✓ QA 通过" : "  ✗ " + problems.join("\n  ✗ "));

  return { report, problems };
}

if (process.argv[1] && process.argv[1].endsWith("07-qa.mjs")) {
  await run();
}
