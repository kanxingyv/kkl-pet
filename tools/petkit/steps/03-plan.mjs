/**
 * Step 03 · plan：把 actions.json 展开成待生成任务清单。
 *
 * 输出 src/gen/_tasks.json。每条任务包含：
 * - 完整 prompt（base.style 前缀 + 姿态描述，保证风格不漂）
 * - 参考图（基础图；同视角后续任务再追加该视角的锚点图）
 * - 落地路径
 *
 * 图像生成不在这里执行——内置 ImageGen 是工具调用，不是 HTTP 接口。
 * 用 `--emit` 打印成可直接复制/批处理的 JSONL。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SKIN = path.join(ROOT, "skins/kkl-whitebird");
const ACTIONS = path.join(ROOT, "tools/petkit/actions/kkl-whitebird.actions.json");

export async function run({ emit = false } = {}) {
  const spec = JSON.parse(await readFile(ACTIONS, "utf8"));
  const base = spec.base;
  const tasks = [];

  // 视角锚点先生成，后续同视角动作可以拿它当第二张参考图
  const anchorByView = new Map();

  for (const action of spec.actions) {
    const isAnchor = action.kind === "anchor";
    for (const gen of action.gen ?? []) {
      const refs = [base.image];
      const anchor = anchorByView.get(action.view);
      if (anchor && !isAnchor) refs.push(anchor);

      const prompt = [base.style, gen.prompt].filter(Boolean).join(", ");

      tasks.push({
        id: `${action.id}/${gen.key}`,
        action: action.id,
        key: gen.key,
        view: action.view,
        isAnchor,
        prompt,
        refs,
        out: `skins/kkl-whitebird/src/gen/${action.id}/${gen.key}.png`,
        size: base.canvasHint,
        background: "transparent",
        inputFidelity: base.inputFidelity,
      });

      if (isAnchor) anchorByView.set(action.view, `src/gen/${action.id}/${gen.key}.png`);
    }
  }

  await mkdir(path.join(SKIN, "src/gen"), { recursive: true });
  const planPath = path.join(SKIN, "src/gen/_tasks.json");
  await writeFile(planPath, JSON.stringify({ generatedAt: new Date().toISOString(), tasks }, null, 2));

  console.log(`  ${tasks.length} tasks → src/gen/_tasks.json`);
  for (const t of tasks) {
    console.log(`    ${t.id.padEnd(20)} ${t.isAnchor ? "[anchor]" : "        "} refs=${t.refs.length}`);
  }

  if (emit) {
    for (const t of tasks) console.log(JSON.stringify(t));
  }

  return tasks;
}

if (process.argv[1] && process.argv[1].endsWith("03-plan.mjs")) {
  await run({ emit: process.argv.includes("--emit") });
}
