/** 站内版验收：多宽度渲染、Alt+P 开关、页脚入口恢复、localStorage 持久化。 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });
const base = process.argv[2] ?? "http://127.0.0.1:5181/";

const browser = await chromium.launch({ channel: "msedge" });
const out = {};

for (const [w, h, name] of [
  [1440, 900, "site-1440"],
  [1024, 800, "site-1024"],
  [390, 844, "site-390"],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const issues = [];
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(base, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });

  const info = await page.evaluate(() => {
    const host = document.getElementById("kkl-pet-host");
    const st = window.kklPet?.handle?.getState?.();
    return {
      host: !!host,
      styleMode: host?.dataset.petStyle ?? null,
      pet: st ? { x: Math.round(st.x), y: Math.round(st.y), state: st.state } : null,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  out[name] = { ...info, issues };
  await page.close();
}

// 开关与持久化
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const beforeToggle = await page.evaluate(() => ({
  host: !!document.getElementById("kkl-pet-host"),
  restoreVisible: !document.querySelector("[data-pet-restore]")?.hidden,
}));

await page.keyboard.press("Alt+p");
await page.waitForTimeout(400);

const afterOff = await page.evaluate(() => ({
  host: !!document.getElementById("kkl-pet-host"),
  restoreVisible: !document.querySelector("[data-pet-restore]")?.hidden,
  stored: JSON.parse(localStorage.getItem("kkl-pet:v1") ?? "{}"),
}));

await page.screenshot({ path: path.join(outDir, "site-off.png") });

// 点页脚入口恢复
await page.evaluate(() => {
  const link = document.querySelector("[data-pet-restore]");
  link.hidden = false;
  link.click();
});
await page.waitForTimeout(800);

const afterOn = await page.evaluate(() => ({
  host: !!document.getElementById("kkl-pet-host"),
  restoreVisible: !document.querySelector("[data-pet-restore]")?.hidden,
  stored: JSON.parse(localStorage.getItem("kkl-pet:v1") ?? "{}"),
}));

await page.screenshot({ path: path.join(outDir, "site-on.png") });

console.log(JSON.stringify({ viewports: out, toggle: { beforeToggle, afterOff, afterOn } }, null, 2));
await browser.close();
