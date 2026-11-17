/**
 * 带真实 CSP 头的本地静态服务器。
 * 目的是在 http 环境下复现 kkl.ltd 的 nginx 安全策略，验证「constructable stylesheet 不被拦」。
 *
 * 用法：node tools/serve-with-csp.mjs [port]
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const DIST = path.join(ROOT, "dist/site");
const FIXTURE = path.join(here, "fixture");
const PORT = Number(process.argv[2] ?? 5180);

/** 与 deploy/nginx-kkl-main.conf 逐条对齐；唯一去掉的是 upgrade-insecure-requests（本地是 http）。 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

function resolveFile(pathname) {
  if (pathname === "/" || pathname === "") return path.join(FIXTURE, "index.html");
  if (pathname === "/pet.js") return path.join(DIST, "pet.js");
  if (pathname === "/pet.css") return path.join(DIST, "pet.css");
  if (pathname.startsWith("/skins/")) {
    const safe = path.normalize(pathname).replace(/^([/\\])+/, "");
    if (safe.includes("..")) return null;
    return path.join(DIST, safe);
  }
  const safe = path.normalize(pathname).replace(/^([/\\])+/, "");
  if (safe.includes("..")) return null;
  return path.join(FIXTURE, safe);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const file = resolveFile(url.pathname);

  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-cache");

  if (!file) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }

  // 测试台没有 favicon，直接 204，避免污染 404 检查
  if (file.endsWith("favicon.ico")) {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const buf = await readFile(file);
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`404 ${url.pathname}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fixture: http://127.0.0.1:${PORT}/   (CSP: style-src 'self'; script-src 'self'; connect-src 'none')`);
});
