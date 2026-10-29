import { createServer as createHttpServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveFeed } from "./live-feed.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function originConfig(value) {
  if (!value) return "*";
  const parsed = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
  )
    throw new Error("FRONTEND_ORIGIN doit être une origine HTTPS sans chemin.");
  return parsed.origin;
}

/** Read-only static frontend + live feed. Does not expose the evidence corpus or env. */
export function createServer({
  root = PROJECT_ROOT,
  env = process.env,
  feed = createLiveFeed({ env }),
} = {}) {
  const allowedOrigin = originConfig(env.FRONTEND_ORIGIN);
  const server = createHttpServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const json = (status, body) => {
      response.writeHead(status, {
        "Content-Type": MIME[".json"],
        "Cache-Control": "no-store",
      });
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(body),
      );
    };
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (url.pathname === "/api/live") {
        if (allowedOrigin === "*" || request.headers.origin === allowedOrigin)
          response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        response.setHeader("Vary", "Origin");
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Max-Age": "600",
          });
          response.end();
          return;
        }
        if (!["GET", "HEAD"].includes(request.method)) {
          response.setHeader("Allow", "GET, HEAD, OPTIONS");
          json(405, { error: "method_not_allowed" });
          return;
        }
        const snapshot = await feed.getSnapshot();
        json(snapshot.status === "unavailable" ? 503 : 200, snapshot);
        return;
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        json(405, { error: "method_not_allowed" });
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      if (
        decoded.includes("\\") ||
        decoded.includes("\0") ||
        decoded.split("/").some((part) => part.startsWith("."))
      ) {
        json(404, { error: "not_found" });
        return;
      }
      const bucket = decoded.startsWith("/src/")
        ? "src"
        : decoded.startsWith("/data/")
          ? "data"
          : "public";
      const relative =
        bucket === "public"
          ? decoded === "/"
            ? "index.html"
            : decoded.slice(1)
          : decoded.slice(bucket.length + 2);
      const base = path.resolve(root, bucket);
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep)) {
        json(404, { error: "not_found" });
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()];
      if (!type) {
        json(404, { error: "not_found" });
        return;
      }
      const [actualBase, actualFile] = await Promise.all([
        realpath(base),
        realpath(file),
      ]);
      if (
        !actualFile.startsWith(actualBase + path.sep) ||
        !(await stat(actualFile)).isFile()
      ) {
        json(404, { error: "not_found" });
        return;
      }
      const content = await readFile(actualFile);
      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-cache",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      json(
        ["ENOENT", "ENOTDIR", "EISDIR"].includes(error?.code) ||
          error instanceof URIError
          ? 404
          : 500,
        { error: "request_failed" },
      );
    }
  });
  server.on("close", () => feed.close?.());
  return server;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT invalide");
  const env = { ...process.env };
  if (
    process.argv.includes("--public-live") &&
    !env.LIVE_PROVIDER &&
    !env.LIVE_FEED_URL &&
    !env.PANDASCORE_TOKEN
  )
    env.LIVE_PROVIDER = "lolesports";
  const server = createServer({ env });
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(
      `Draft Lab : http://${process.env.HOST || "127.0.0.1"}:${port}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
