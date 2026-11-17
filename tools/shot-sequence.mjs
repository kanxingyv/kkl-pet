/** 抓一段连续时序截图，用于肉眼检查爬升/走路的视觉是否成立。 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out/seq");
await mkdir(outDir, { recursive: true });

const target = process.argv[2] ?? ".card.tall";
const width = Number(process.argv[3] ?? 1200);
const height = Number(process.argv[4] ?? 900);
const steps = Number(process.argv[5] ?? 9);
const gap = Number(process.argv[6] ?? 800);

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

await page.goto("http://127.0.0.1:5180/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__pet = window.KKLPet.mount();
});
await page.waitForTimeout(400);

await page.evaluate((sel) => {
  window.__walk = window.__pet.walkTo(sel);
}, target);

for (let i = 0; i < steps; i++) {
  await page.waitForTimeout(gap);
  await page.screenshot({ path: path.join(outDir, `s${String(i).padStart(2, "0")}.png`) });
}

const result = await page.evaluate(async () => ({
  walk: await window.__walk,
  state: window.__pet.getState(),
}));

console.log(JSON.stringify(result, null, 2));
await browser.close();
