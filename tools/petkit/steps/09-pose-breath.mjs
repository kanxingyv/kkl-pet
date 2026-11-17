/**
 * Step 09 · pose-breath：把一张单帧姿态扩展成呼吸循环。
 *
 * 为什么需要它：AI 生成的四格「呼吸」常常是四个比例略有不同的角色（窄高/宽矮），
 * 播起来是忽胖忽瘦，不是呼吸。取其中一帧做基准、只做细微的竖向缩放，才真的像在呼吸。
 *
 * 用法：
 *   node tools/petkit/steps/09-pose-breath.mjs --action idle --from src/normalized/idle/f00.png
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { alphaBBox, composeFrame, readRgba } from "../lib/image.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** 四个相位：[scaleY, dy]。起伏控制在 ±1.2%，对应 162px 显示尺寸不到 2px。 */
const BREATH = [
  [1.0, 0],
  [1.012, -1.5],
  [1.0, 0],
  [0.994, 1],
];

export async function run() {
  const action = arg("action", "idle");
  const from = arg("from", `src/normalized/${action}/f00.png`);
  const abs = path.isAbsolute(from) ? from : path.join(SKIN, from);

  const motions = JSON.parse(
    await readFile(path.join(SKIN, "src/normalized/_motions.json"), "utf8")
  );
  const { w: canvasW, h: canvasH } = motions.canvas;
  const anchorX = motions.anchor.x;
  const anchorY = motions.anchor.y;

  const rgba = await readRgba(abs);
  const bbox = alphaBBox(rgba, 16);
  if (!bbox) throw new Error("源帧全透明");

  // 裁掉透明边，之后按内容高度 1:1 合成，不做额外缩放
  const content = await sharp(abs).extract(bbox).png().toBuffer();

  const dir = path.join(SKIN, "src/normalized", action);
  await mkdir(dir, { recursive: true });

  for (let i = 0; i < BREATH.length; i++) {
    const [scaleY, dy] = BREATH[i];
    const buf = await composeFrame(content, {
      canvasW,
      canvasH,
      anchorX,
      anchorY,
      targetHeight: bbox.height,
      scaleY,
      dy,
    });
    await writeFile(path.join(dir, `f${String(i).padStart(2, "0")}.png`), buf);
  }

  motions.motions[action] = { frames: BREATH.length, fps: 6 };
  await writeFile(
    path.join(SKIN, "src/normalized/_motions.json"),
    JSON.stringify(motions, null, 2)
  );

  console.log(
    `  ${action}: 基准帧 ${bbox.width}×${bbox.height} → ${BREATH.length} 帧呼吸（±1.2%，dy ±1.5px）`
  );
}

if (process.argv[1] && process.argv[1].endsWith("09-pose-breath.mjs")) {
  await run();
}
