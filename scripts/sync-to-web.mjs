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
const DEST = path.resolve(ROOT, "../kkl-web/assets/pet");

if (!existsSync(SRC)) {
  console.error("dist/site 不存在，先跑 npm run build");
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, { recursive: true });

const files = await readdir(DEST, { recursive: true });
const total = files.filter((f) => f.includes(".")).length;
console.log(`  dist/site → ${DEST}`);
console.log(`  ${total} files`);
