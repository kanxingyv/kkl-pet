/**
 * M3 验收：行为调度与拖拽。
 *
 * 1. 静置 15 秒，记录状态序列，检查有没有抽搐（< 600ms 的连续切换）
 * 2. 模拟拖拽：pointerdown → 拖到半空 → 松手，检查是否进入 drag 并最终落地
 * 3. peek 时断言输入框的 value 与 activeElement 完全没变
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

await page.goto("http://127.0.0.1:5180/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__pet = window.KKLPet.mount();
});
await page.waitForTimeout(500);

// ── 1. 自动行为观察 ──
const obs = await page.evaluate(async () => {
  const seq = [];
  const t0 = performance.now();
  const timer = setInterval(() => {
    const s = window.__pet.getState();
    const now = Math.round(performance.now() - t0);
    const last = seq[seq.length - 1];
    if (!last || last.state !== s.state) {
      seq.push({ state: s.state, at: now, clip: s.clip, x: Math.round(s.x), y: Math.round(s.y) });
    }
  }, 80);

  await new Promise((r) => setTimeout(r, 15_000));
  clearInterval(timer);
  return { seq, final: window.__pet.getState() };
});

// 抽搐检测：连续切换间隔 < 600ms 视为抖动
// 移动段（walk/climb/fall/land）之间的衔接是路径的自然延续，不算抖动
const MOVE_STATES = new Set(["walk", "climb", "fall", "land"]);
const twitches = [];
for (let i = 1; i < obs.seq.length; i++) {
  const gap = obs.seq[i].at - obs.seq[i - 1].at;
  const bothMove = MOVE_STATES.has(obs.seq[i - 1].state) && MOVE_STATES.has(obs.seq[i].state);
  if (gap < 600 && !bothMove) {
    twitches.push({ from: obs.seq[i - 1].state, to: obs.seq[i].state, gap });
  }
}

// ── 2. 拖拽 ──
const before = await page.evaluate(() => window.__pet.getState());
const grabX = Math.round(before.x);
const grabY = Math.round(before.y) - 80;

await page.mouse.move(grabX, grabY);
await page.mouse.down();
await page.waitForTimeout(80);
const duringDrag = await page.evaluate(() => window.__pet.getState());

await page.mouse.move(grabX - 260, 260, { steps: 12 });
await page.waitForTimeout(120);
const midDrag = await page.evaluate(() => window.__pet.getState());
await page.screenshot({ path: path.join(outDir, "drag.png") });

await page.mouse.up();
await page.waitForTimeout(1600);
const afterDrop = await page.evaluate(() => window.__pet.getState());

// ── 3. peek 不改表单 ──
const formCheck = await page.evaluate(async () => {
  const input = document.querySelector(".field");
  input.focus();
  input.value = "用户正在输入的内容";
  const beforeVal = input.value;
  const beforeActive = document.activeElement === input;

  const h = window.__pet;
  await h.walkTo(".field");
  await new Promise((r) => setTimeout(r, 900));

  return {
    valueUnchanged: input.value === beforeVal,
    activeUnchanged: document.activeElement === input,
    wasFocused: beforeActive,
    value: input.value,
    petState: h.getState().state,
  };
});

console.log(
  JSON.stringify(
    {
      autoSeq: obs.seq.map((s) => `${s.at}ms ${s.state}`),
      stateDurations: obs.seq.slice(1).map((s, i) => ({
        state: s.state,
        ms: s.at - obs.seq[i].at,
      })),
      twitches,
      drag: {
        before: { x: Math.round(before.x), y: Math.round(before.y), state: before.state },
        duringDrag: { state: duringDrag.state, clip: duringDrag.clip },
        midDrag: { state: midDrag.state, x: Math.round(midDrag.x), y: Math.round(midDrag.y) },
        afterDrop: { state: afterDrop.state, x: Math.round(afterDrop.x), y: Math.round(afterDrop.y) },
      },
      formCheck,
      errors,
    },
    null,
    2
  )
);

await browser.close();
