/**
 * 带 CSP 的 kkl-web 预览服务器。
 * 用途：在部署前用真实响应头验证站内版（style-src 'self' / script-src 'self' / connect-src 'none'）。
 *
 * 用法：node tools/serve-web.mjs [port]
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "../../kkl-web");
const PORT = Number(process.argv[2] ?? 5181);

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
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (rel.endsWith("/")) rel += "index.html";

  const safe = path.normalize(rel).replace(/^([/\\])+/, "");
  if (safe.includes("..")) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }

  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-cache");

  let file = path.join(WEB, safe);
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.statusCode = 404;
    try {
      body = await readFile(path.join(WEB, "404.html"));
      file = "404.html";
    } catch {
      res.end("404");
      return;
    }
  }

  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`kkl-web: http://127.0.0.1:${PORT}/  (CSP: style-src 'self'; script-src 'self'; connect-src 'none')`);
});
