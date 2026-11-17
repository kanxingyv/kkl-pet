/**
 * Step 06 · pack：normalized/*.png → out/<action>.webp + 更新 manifest.clips。
 * 只打包实际存在的动作，缺的 clip 运行时自动回退 idle。
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripHorizontal } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

/** 视角与镜像策略。全部是正面素材，镜像开启（正面镜像不会翻转任何不对称细节）。 */
const VIEW = {
  idle: { view: "front", mirror: false },
  walk: { view: "front", mirror: true },
  climb: { view: "front", mirror: true },
  fall: { view: "front", mirror: true },
  peek: { view: "front", mirror: true },
  sit: { view: "front", mirror: true },
  sleep: { view: "front", mirror: false },
  wave: { view: "front", mirror: true },
  jump: { view: "front", mirror: true },
  drag: { view: "front", mirror: false },
  land: { view: "front", mirror: false },
};

export async function run() {
  const motions = JSON.parse(
    await readFile(path.join(SKIN, "src/normalized/_motions.json"), "utf8")
  );
  const canvas = motions.canvas;

  await mkdir(path.join(SKIN, "out"), { recursive: true });

  const clips = {};
  const report = [];

  for (const [name, info] of Object.entries(motions.motions)) {
    const dir = path.join(SKIN, "src/normalized", name);
    if (!existsSync(dir)) continue;

    const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    if (files.length === 0) continue;

    const frames = [];
    for (const f of files) frames.push(await readFile(path.join(dir, f)));

    const webp = await stripHorizontal(frames, {
      frameW: canvas.w,
      frameH: canvas.h,
      quality: 92,
    });
    await writeFile(path.join(SKIN, "out", `${name}.webp`), webp);

    const meta = VIEW[name] ?? { view: "front", mirror: true };
    clips[name] = {
      sheet: `${name}.webp`,
      frames: frames.length,
      fps: info.fps,
      loop: true,
      view: meta.view,
      mirror: meta.mirror,
    };

    report.push(`${name.padEnd(6)} ${String(frames.length).padStart(2)}f → ${(webp.length / 1024).toFixed(0)}KB`);
  }

  const manifestPath = path.join(SKIN, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // 合并：只更新本次打包的动作，保留其它已生成的 clip
  manifest.clips = { ...manifest.clips, ...clips };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(report.map((r) => "  " + r).join("\n"));
  console.log(`  manifest.clips → ${Object.keys(clips).join(", ")}`);

  return clips;
}

if (process.argv[1] && process.argv[1].endsWith("06-pack.mjs")) {
  await run();
}
