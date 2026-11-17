import { build } from "esbuild";
import { rm, mkdir, cp, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

/** core 的两壳共用编译参数。IIFE 是唯一同时满足 MV3 content_scripts 与站内 <script> 的形态。 */
const base = {
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  loader: { ".css": "text", ".json": "json" },
  legalComments: "none",
  logLevel: "warning",
};

async function bundle(entry, outfile, { minify }) {
  await build({
    ...base,
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, outfile),
    minify,
    sourcemap: minify ? false : "inline",
    define: {
      __PET_VERSION__: JSON.stringify(pkg.version),
      __DEV__: JSON.stringify(!minify),
    },
  });
  const { size } = await readFile(path.join(root, outfile)).then((b) => ({ size: b.length }));
  return `${outfile}  ${(size / 1024).toFixed(1)}KB`;
}

/** 把 skins/<id>/out 整体复制到产物目录；运行时按 host.assetUrl() 拼路径读取。 */
async function copySkins(destRoot) {
  const skinsRoot = path.join(root, "skins");
  if (!existsSync(skinsRoot)) return 0;
  let copied = 0;
  for (const ent of await readdir(skinsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const src = path.join(skinsRoot, ent.name, "out");
    if (!existsSync(src)) continue;
    const dest = path.join(destRoot, "skins", ent.name);
    await mkdir(dest, { recursive: true });
    // 跳过 QA 产物（contact sheet 只用于人工复核，不进发布包）
    await cp(src, dest, { recursive: true, filter: (f) => !f.includes('_contact') });
    copied += 1;
  }
  return copied;
}

async function buildSite(minify) {
  const outDir = path.join(root, "dist/site");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const line = await bundle("src/entry/site.ts", "dist/site/pet.js", { minify });
  const skins = await copySkins(outDir);
  return `${line}  (${skins} skin${skins === 1 ? "" : "s"})`;
}

async function buildExtension() {
  const outDir = path.join(root, "dist/extension");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const line = await bundle("src/entry/extension.ts", "dist/extension/pet.js", { minify: true });
  const skins = await copySkins(outDir);
  await cp(path.join(root, "shells/extension"), outDir, { recursive: true });
  return `${line}  (${skins} skin${skins === 1 ? "" : "s"})`;
}

/** 单文件植入版：素材内联成 data URI，产物不依赖任何外部请求。 */
async function buildEmbed() {
  const outDir = path.join(root, "dist/embed");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await build({
    ...base,
    entryPoints: [path.join(root, "src/entry/embed.ts")],
    outfile: path.join(outDir, "pet.embed.js"),
    loader: { ".css": "text", ".json": "json", ".webp": "dataurl" },
    minify: true,
    define: {
      __PET_VERSION__: JSON.stringify(pkg.version),
      __DEV__: "false",
    },
  });

  const { size } = await readFile(path.join(outDir, "pet.embed.js")).then((b) => ({ size: b.length }));
  return `dist/embed/pet.embed.js  ${(size / 1024).toFixed(0)}KB  (素材已内联)`;
}

const t0 = Date.now();
const results = [];

if (isDev) {
  const outDir = path.join(root, "dist/dev");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  results.push(await bundle("src/entry/site.ts", "dist/dev/pet.js", { minify: false }));
  results.push(`skins: ${await copySkins(outDir)}`);
} else {
  results.push(await buildSite(true));
  // 扩展壳在 M5 之前不存在，存在才构建，避免骨架阶段直接报错
  if (existsSync(path.join(root, "src/entry/extension.ts"))) {
    results.push(await buildExtension());
  } else {
    results.push("dist/extension  跳过（src/entry/extension.ts 尚未创建）");
  }
  if (existsSync(path.join(root, "src/entry/embed.ts"))) {
    results.push(await buildEmbed());
  }
}

for (const r of results) console.log("  " + r);
console.log(`\n✓ build  ${Date.now() - t0}ms`);
