/**
 * 把构建产物同步到 kkl-web 的静态目录。
 * 站点是纯静态部署，产物落地后只需要 index.html 里一行 <script>。
 */
import { cp, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const SRC = path.join(ROOT, "dist/site");
const destArg = process.argv.indexOf("--dest");
const DEST =
  destArg >= 0
    ? path.resolve(process.argv[destArg + 1])
    : path.resolve(ROOT, "../kkl-web/assets/pet");
const WEB_ROOT = path.dirname(path.dirname(DEST));

// 这是作者自用的同步脚本：目标站点不在时给出明确提示，而不是静默创建一个空目录
if (!existsSync(WEB_ROOT)) {
  console.error(`目标站点不存在：${WEB_ROOT}`);
  console.error("用法：node scripts/sync-to-web.mjs [--dest <目录>]");
  console.error("如果你只是想本地跑起来，不需要这一步——直接 npm run serve 即可。");
  process.exit(1);
}

if (!existsSync(SRC)) {
  console.error("dist/site 不存在，先跑 npm run build");
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, { recursive: true });

// 单文件植入版一并同步，站点上就有公网地址可以直接 <script src>
const EMBED = path.join(ROOT, "dist/embed/pet.embed.js");
if (existsSync(EMBED)) {
  await cp(EMBED, path.join(DEST, "pet.embed.js"));
}

const files = await readdir(DEST, { recursive: true });
const total = files.filter((f) => f.includes(".")).length;
console.log(`  dist/site → ${DEST}`);
console.log(`  ${total} files`);
