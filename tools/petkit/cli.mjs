#!/usr/bin/env node
/**
 * petkit 统一入口。
 *
 *   node tools/petkit/cli.mjs <step> [--only walk]
 *
 * step:
 *   ingest      量基础图（bbox / 锚点 / 主色板）
 *   plan        展开 AI 生成任务清单
 *   procedural  程序化合成全部动作帧（当前默认路径）
 *   pack        PNG 序列 → webp + 更新 manifest
 *   qa          contact sheet + 锚点漂移检查
 *   all         ingest → procedural → qa → pack（一条龙）
 */
const step = process.argv[2] ?? "all";

const argv = process.argv.slice(3);
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;

async function run(name) {
  const map = {
    ingest: ["./steps/02-ingest.mjs", "ingest"],
    plan: ["./steps/03-plan.mjs", "plan"],
    procedural: ["./steps/05-procedural.mjs", "procedural"],
    pack: ["./steps/06-pack.mjs", "pack"],
    qa: ["./steps/07-qa.mjs", "qa"],
    idle: ["./steps/01-idle.mjs", "idle"],
  };

  const entry = map[name];
  if (!entry) {
    console.error(`未知步骤：${name}。可选：${Object.keys(map).join(", ")}, all`);
    process.exit(1);
  }

  const mod = await import(new URL(entry[0], import.meta.url).href);
  if (typeof mod.run === "function") {
    await mod.run(name === "procedural" ? { only } : undefined);
  }
}

const t0 = Date.now();

if (step === "all") {
  for (const s of ["ingest", "procedural", "qa", "pack"]) {
    console.log(`\n▸ ${s}`);
    await run(s);
  }
} else {
  await run(step);
}

console.log(`\n✓ ${step}  ${Date.now() - t0}ms`);
