/**
 * M1 验收：世界模型 + 路径规划 + 连续位移。
 *
 * 检查项：
 * 1. 探针耗时、表面数、图规模
 * 2. 导航到卡片 / 输入框 / 地面是否成功，落点表面是否正确
 * 3. 全程无 PET_E_TELEPORT
 * 4. 采样轨迹里没有超过物理上限的跳跃
 * 5. debug 叠层画出表面与路径
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] ?? "http://127.0.0.1:5180/";
const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

await page.goto(baseUrl + "?pet-debug", { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForTimeout(600);

await page.evaluate(() => {
  window.__pet = window.KKLPet.mount({ debug: true });
});
await page.waitForTimeout(500);

const start = await page.evaluate(() => ({
  state: window.__pet.getState(),
  diag: window.__pet.diag(),
}));

// 轨迹采样器
await page.evaluate(() => {
  window.__track = [];
  window.__sampler = setInterval(() => {
    const s = window.__pet.getState();
    window.__track.push({ x: Math.round(s.x), y: Math.round(s.y), clip: s.clip });
  }, 60);
});

// 第一次：走到高卡片，途中截图看 debug 路径
await page.evaluate(() => {
  window.__w1 = window.__pet.walkTo(".card.tall");
});
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(outDir, "nav-path.png") });

const r1 = await page.evaluate(() => window.__w1);
const afterTall = await page.evaluate(() => window.__pet.getState());

// 第二次：走到输入框
const r2 = await page.evaluate(() => window.__pet.walkTo(".field"));
const afterInput = await page.evaluate(() => window.__pet.getState());

// 第三次：回到地面
const r3 = await page.evaluate(() => window.__pet.walkTo("body"));
const afterBody = await page.evaluate(() => window.__pet.getState());

const track = await page.evaluate(() => {
  clearInterval(window.__sampler);
  return window.__track;
});

await page.screenshot({ path: path.join(outDir, "nav-final.png") });

// 轨迹断点检测：walk/climb 下 60ms 位移应 < 40px；fall 由重力驱动，上限单列
const jumps = [];
for (let i = 1; i < track.length; i++) {
  const a = track[i - 1];
  const b = track[i];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const limit = b.clip === "fall" ? 140 : 40;
  if (d > limit) jumps.push({ i, dist: Math.round(d), from: a, to: b });
}

console.log(
  JSON.stringify(
    {
      probe: start.diag.probe,
      graph: {
        surfaces: start.diag.surfaces,
        ledges: start.diag.ledges,
        nodes: start.diag.nodes,
        edges: start.diag.edges,
      },
      start: start.state,
      walkTall: { ...r1, end: afterTall },
      walkInput: { ...r2, end: afterInput },
      walkFloor: { ...r3, end: afterBody },
      trackSamples: track.length,
      jumps,
      errors,
    },
    null,
    2
  )
);

await browser.close();
