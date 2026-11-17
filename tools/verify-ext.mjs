/** M5 验收：把 dist/extension 装进浏览器，在严格 CSP 的站点上确认注入与样式。 */
import { chromium } from "playwright-core";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, "../dist/extension");
const profileDir = path.resolve(here, "out/ext-profile");
const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });
await rm(profileDir, { recursive: true, force: true });

const target = process.argv[2] ?? "http://127.0.0.1:5180/";

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: "msedge",
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

const errors = [];
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(3200);

const info = await page.evaluate(() => {
  const host = document.getElementById("kkl-pet-host");
  return {
    host: !!host,
    styleMode: host?.dataset.petStyle ?? null,
    zIndex: host ? getComputedStyle(host).zIndex : null,
    apiExposed: typeof window.__kklPet,
    state: window.__kklPet?.handle?.getState?.() ?? null,
  };
});

const shot = path.join(outDir, `ext-${new URL(target).hostname.replace(/\./g, "-")}.png`);
await page.screenshot({ path: shot });
console.error("screenshot", shot);

console.log(JSON.stringify({ target, info, errors }, null, 2));

await ctx.close();
