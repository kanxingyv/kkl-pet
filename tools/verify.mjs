import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? "http://127.0.0.1:5180/";
const outName = process.argv[3] ?? "m0.png";
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);

const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
});

const issues = [];
const cspViolations = [];

page.on("console", (m) => {
  const text = m.text();
  if (text.includes("Content Security Policy") || text.includes("Refused to")) {
    cspViolations.push(text);
  }
  if (m.type() === "error") issues.push("CONSOLE " + text);
});
page.on("pageerror", (e) => issues.push("PAGEERROR " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400) issues.push("HTTP " + r.status() + " " + r.url());
});

await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForTimeout(900);

const info = await page.evaluate(() => {
  const host = document.getElementById("kkl-pet-host");
  const api = window.KKLPet;
  return {
    hostExists: !!host,
    hostSize: host ? [host.getBoundingClientRect().width, host.getBoundingClientRect().height] : null,
    zIndex: host ? getComputedStyle(host).zIndex : null,
    shadowClosed: host ? host.shadowRoot === null : null,
    styleMode: host ? host.dataset.petStyle : null,
    apiType: typeof api,
    skins: api && typeof api.skins === "function" ? api.skins() : null,
    version: api?.version ?? null,
  };
});

const shot = path.join(outDir, outName);

await page.screenshot({ path: shot });

// 帧推进检查：重新 mount 一次拿 handle，隔一段时间读两次 frame，确认动画在跑
const frames = await page.evaluate(async () => {
  const api = window.KKLPet;
  if (!api) return null;
  const handle = api.mount();
  await new Promise((r) => setTimeout(r, 500));
  const a = handle.getState();
  await new Promise((r) => setTimeout(r, 260));
  const b = handle.getState();
  return {
    first: { clip: a.clip, frame: a.frame, x: Math.round(a.x), y: Math.round(a.y) },
    second: { clip: b.clip, frame: b.frame },
    advanced: a.frame !== b.frame,
  };
});

console.log(
  JSON.stringify(
    { info, frames, cspViolations, issues, screenshot: shot },
    null,
    2
  )
);

await browser.close();
