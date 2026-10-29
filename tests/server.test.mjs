import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLiveFeed } from "../server/live-feed.mjs";
import { createServer } from "../server/server.mjs";

async function fixture(t, { env = {}, feed } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kazewa-http-test-"));
  for (const name of ["public", "src", "data", "server", "private"])
    await mkdir(path.join(root, name));
  await Promise.all([
    writeFile(path.join(root, "public/index.html"), "<title>Draft Lab</title>"),
    writeFile(path.join(root, "public/style.css"), "body{color:red}"),
    writeFile(path.join(root, "public/.env"), "TOKEN=public-secret"),
    writeFile(path.join(root, ".env"), "TOKEN=root-secret"),
    writeFile(
      path.join(root, "src/engine.mjs"),
      'export const name = "engine";',
    ),
    writeFile(path.join(root, "data/knowledge.json"), '{"champions":[]}'),
    writeFile(
      path.join(root, "server/secret.json"),
      '{"secret":"server-secret"}',
    ),
    writeFile(
      path.join(root, "private/secret.json"),
      '{"secret":"private-secret"}',
    ),
  ]);
  const server = createServer({ root, env, ...(feed ? { feed } : {}) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { root, server, base };
}

// Native http.request preserves malicious paths; fetch() would normalize some
// traversal attempts before they ever reach the server under test.
function rawGet(base, requestPath) {
  return new Promise((resolve, reject) => {
    const req = request(base, { path: requestPath }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          body,
          headers: response.headers,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

test("HTTP frontend serves expected MIME paths and HEAD without a body", async (t) => {
  const { base } = await fixture(t);
  for (const [name, type, text] of [
    ["/", "text/html", "Draft Lab"],
    ["/style.css", "text/css", "color:red"],
    ["/src/engine.mjs", "text/javascript", "engine"],
    ["/data/knowledge.json", "application/json", "champions"],
  ]) {
    const response = await fetch(base + name);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), new RegExp(type));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok((await response.text()).includes(text));
  }
  const head = await fetch(base + "/data/knowledge.json", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("Raw HTTP paths cannot expose env, server files, dotfiles or traverse out of allowed folders", async (t) => {
  const { base } = await fixture(t);
  for (const requestPath of [
    "/.env",
    "/public/.env",
    "/%2eenv",
    "/server/secret.json",
    "/private/secret.json",
    "/src/../server/secret.json",
    "/src/%2e%2e/server/secret.json",
    "/src/%2e%2e/%2e%2e/.env",
    "/data/..%5cserver%5csecret.json",
    "/data/%00knowledge.json",
    "/src/.hidden.mjs",
    "/data/%GG",
    "/data/",
    "/server/server.mjs",
    "/package.json",
    "/docs/LIVE_SOURCES.md",
  ]) {
    const response = await rawGet(base, requestPath);
    assert.equal(response.status, 404, requestPath);
    assert.equal(
      /root-secret|public-secret|server-secret|private-secret/.test(
        response.body,
      ),
      false,
    );
  }
});

test("Static server refuses symlink/junction escapes from allowed folders", async (t) => {
  const { root, base } = await fixture(t);
  try {
    await symlink(
      path.join(root, "private"),
      path.join(root, "data", "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip("The host does not permit creating test symlinks");
      return;
    }
    throw error;
  }
  const response = await fetch(base + "/data/escape/secret.json");
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes("private-secret"), false);
});

test("API exposes explicit unconfigured status, no-store and an empty match list", async (t) => {
  const { base } = await fixture(t, { env: {} });
  const response = await fetch(base + "/api/live");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "not_configured");
  assert.equal(body.reason, "provider_not_configured");
  assert.deepEqual(body.matches, []);
});

test("API outages map to 503 and sanitized JSON while arbitrary provider errors remain private", async (t) => {
  const feed = createLiveFeed({
    env: {
      LIVE_FEED_URL: "https://feed.example/live",
      LIVE_FEED_TOKEN: "private-token",
    },
    fetchImpl: async () => {
      throw new Error("https://private.example/?token=private-token");
    },
  });
  const { base } = await fixture(t, { feed });
  const response = await fetch(base + "/api/live");
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes("private-token"), false);
  const body = JSON.parse(text);
  assert.equal(body.status, "unavailable");
  assert.deepEqual(body.matches, []);
});

test("Configured CORS applies only to the exact Pages origin and supports read-only preflight", async (t) => {
  const { base } = await fixture(t, {
    env: { FRONTEND_ORIGIN: "https://samuel.github.io" },
  });
  const allowed = await fetch(base + "/api/live", {
    headers: { Origin: "https://samuel.github.io" },
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://samuel.github.io",
  );
  assert.equal(allowed.headers.get("vary"), "Origin");
  for (const origin of [
    "https://samuel.github.io.attacker.example",
    "http://samuel.github.io",
    "null",
  ]) {
    assert.equal(
      (
        await fetch(base + "/api/live", { headers: { Origin: origin } })
      ).headers.get("access-control-allow-origin"),
      null,
    );
  }
  const preflight = await fetch(base + "/api/live", {
    method: "OPTIONS",
    headers: {
      Origin: "https://samuel.github.io",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-methods"),
    "GET, HEAD, OPTIONS",
  );
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await fetch(base + "/api/live", { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
  }
});

test("Invalid FRONTEND_ORIGIN is rejected rather than silently weakening CORS", () => {
  for (const FRONTEND_ORIGIN of [
    "https://user:secret@example.com",
    "https://example.com/path",
    "http://remote.example",
    "https://example.com/?token=secret",
  ]) {
    assert.throws(() => createServer({ env: { FRONTEND_ORIGIN } }));
  }
});
