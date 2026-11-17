/**
 * Step 05 · procedural：从一张基础图程序化合成全部动作帧。
 *
 * 为什么不用 AI 出多视角帧：实测侧身图与原图的角色比例、五官、脚型都对不齐，
 * 切动作时会「换了一只鸟」。这里改成同一张图的整体刚体变换——
 * 一致性问题彻底消失，代价是没有真正的侧身（Q 版角色用正面小碎步反而更讨喜）。
 *
 * 输出 src/normalized/<action>/fNN.png。pack 只认这个目录。
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { composeFrame } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

const CANVAS = { w: 324, h: 324 };
const ANCHOR = { x: 162, y: 300 };
const TARGET_H = 258;

/**
 * 每个动作的骨骼：
 * rotate 为整体倾角（度），scaleY 为竖向挤压，dx/dy 为重心位移。
 * 全部是刚体变换——不做肢体再articulation，这是保持画风一致的前提。
 */
const MOTIONS = {
  idle: {
    frames: 10,
    fps: 12,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      const s = Math.sin(p);
      return { scaleY: 1 + 0.025 * s, dy: -1.8 * Math.max(0, s) };
    },
  },
  walk: {
    frames: 8,
    fps: 12,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        rotate: Math.sin(p) * 3.6,
        scaleY: 1 + Math.sin(p * 2) * 0.022,
        dx: Math.sin(p) * 4.5,
        dy: -Math.abs(Math.sin(p * 2)) * 2.2,
      };
    },
  },
  climb: {
    frames: 8,
    fps: 13,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        rotate: -7 + Math.sin(p) * 1.8,
        scaleY: 1 + Math.sin(p) * 0.016,
        dx: Math.sin(p) * 2.2,
        dy: -Math.abs(Math.sin(p)) * 6,
      };
    },
  },
  fall: {
    frames: 6,
    fps: 14,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        rotate: Math.sin(p) * 6.5,
        scaleY: 1.03 + Math.sin(p * 2) * 0.022,
        dx: Math.sin(p) * 3,
      };
    },
  },
  peek: {
    frames: 6,
    fps: 8,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        rotate: -5.5 + Math.sin(p) * 1.2,
        scaleY: 0.985 + Math.sin(p) * 0.01,
        dy: Math.sin(p) * 1.6,
      };
    },
  },
  sit: {
    frames: 6,
    fps: 8,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        scaleY: 0.9 + Math.sin(p) * 0.012,
        scaleX: 1.07,
        rotate: -1.5,
      };
    },
  },
  sleep: {
    frames: 6,
    fps: 6,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        scaleY: 0.87 + Math.sin(p) * 0.014,
        scaleX: 1.09,
        rotate: 5.5,
      };
    },
  },
  wave: {
    frames: 8,
    fps: 12,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        rotate: Math.sin(p * 2) * 5.5,
        scaleY: 1 + Math.abs(Math.sin(p * 2)) * 0.02,
        dx: Math.sin(p * 2) * 3,
      };
    },
  },
  jump: {
    frames: 8,
    fps: 16,
    fn: (i, n) => {
      // 0-2 蹲，3-5 伸展腾空，6-7 回弹
      const p = i / n;
      const curve = Math.sin(p * Math.PI * 2 - Math.PI / 2);
      return {
        scaleY: 1 - curve * 0.09,
        scaleX: 1 + curve * 0.06,
        dy: curve > 0 ? -curve * 22 : 0,
      };
    },
  },
  drag: {
    frames: 4,
    fps: 10,
    fn: (i, n) => {
      const p = (i / n) * Math.PI * 2;
      return {
        scaleY: 1.07,
        scaleX: 0.96,
        rotate: Math.sin(p) * 4.5,
      };
    },
  },
  land: {
    frames: 4,
    fps: 16,
    fn: (i) => {
      const curve = [0.84, 1.05, 0.97, 1.0][i] ?? 1;
      return {
        scaleY: curve,
        scaleX: 1 + (1 - curve) * 0.7,
      };
    },
  },
};

export async function run({ only } = {}) {
  const base = JSON.parse(await readFile(path.join(SKIN, "src/raw/_base.json"), "utf8"));
  const src = path.join(SKIN, base.source);
  const content = await sharp(src)
    .ensureAlpha()
    .extract(base.bbox)
    .png()
    .toBuffer();

  const out = {};

  for (const [name, motion] of Object.entries(MOTIONS)) {
    if (only && only !== name) continue;

    const dir = path.join(SKIN, "src/normalized", name);
    await mkdir(dir, { recursive: true });

    const frames = [];
    const metrics = [];

    for (let i = 0; i < motion.frames; i++) {
      const t = motion.fn(i, motion.frames);
      const buf = await composeFrame(content, {
        canvasW: CANVAS.w,
        canvasH: CANVAS.h,
        anchorX: ANCHOR.x,
        anchorY: ANCHOR.y,
        targetHeight: TARGET_H,
        ...t,
      });
      frames.push(buf);

      const { info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      void info;
      const bm = await sharp(buf).metadata();
      metrics.push({ frame: i, w: bm.width, h: bm.height, ...t });
      await writeFile(path.join(dir, `f${String(i).padStart(2, "0")}.png`), buf);
    }

    out[name] = { frames: motion.frames, fps: motion.fps };
    console.log(`  ${name.padEnd(6)} ${motion.frames} frames @${motion.fps}fps`);
  }

  // 合并已有记录：--only 单跑一个动作时不能把其它动作的帧率信息冲掉
  let prev = { motions: {} };
  try {
    prev = JSON.parse(await readFile(path.join(SKIN, "src/normalized/_motions.json"), "utf8"));
  } catch {
    /* 首次运行没有这个文件 */
  }

  await writeFile(
    path.join(SKIN, "src/normalized/_motions.json"),
    JSON.stringify(
      {
        canvas: CANVAS,
        anchor: ANCHOR,
        targetHeight: TARGET_H,
        motions: { ...prev.motions, ...out },
      },
      null,
      2
    )
  );

  return out;
}

if (process.argv[1] && process.argv[1].endsWith("05-procedural.mjs")) {
  const i = process.argv.indexOf("--only");
  await run({ only: i >= 0 ? process.argv[i + 1] : undefined });
}
