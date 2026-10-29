import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allowedUpstream,
  createLiveFeed,
  normalizeSnapshot,
  normalizePandaFrame,
} from "../server/live-feed.mjs";
import { createServer } from "../server/server.mjs";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const picks = (names) =>
  Object.fromEntries(
    ["top", "jng", "mid", "bot", "sup"].map((role, index) => [
      role,
      names[index] ?? null,
    ]),
  );
const snapshot = () => ({
  version: 1,
  status: "ok",
  observedAt: new Date(NOW).toISOString(),
  capabilities: { draftPhase: true, rolesConfirmed: true },
  matches: [
    {
      id: "test:1",
      status: "draft",
      rolesConfirmed: true,
      blue: {
        name: "Blue",
        picks: picks(["Ornn", "Vi", "Orianna", "Jinx", "Lulu"]),
      },
      red: {
        name: "Red",
        picks: picks(["Renekton", "Lee Sin", "Ahri", "Kai'Sa", "Nautilus"]),
      },
    },
  ],
});

test("No credentials means an explicit unconfigured feed and no fake matches", async () => {
  const feed = createLiveFeed({
    env: {},
    fetchImpl: () => {
      throw new Error("must not call");
    },
    now: () => NOW,
  });
  const result = await feed.getSnapshot();
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.matches, []);
  assert.equal(result.capabilities.draftPhase, false);
});

test("Configuration allows HTTPS and HTTP localhost, rejects insecure remote URLs and embedded credentials", () => {
  assert.equal(
    allowedUpstream("https://feed.example/live").hostname,
    "feed.example",
  );
  assert.equal(
    allowedUpstream("http://localhost:4173/live").hostname,
    "localhost",
  );
  for (const url of [
    "http://example.com/live",
    "https://secret:token@example.com/live",
    "file:///etc/passwd",
  ])
    assert.throws(() => allowedUpstream(url));
});

test("Role confirmation requires explicit per-match evidence; incomplete picks stay null", () => {
  const input = snapshot();
  delete input.matches[0].rolesConfirmed;
  input.matches[0].blue.picks.mid = null;
  const output = normalizeSnapshot(input, { now: NOW });
  assert.equal(output.matches[0].rolesConfirmed, false);
  assert.equal(output.matches[0].blue.picks.mid, null);
  assert.equal(output.capabilities.rolesConfirmed, true);
  assert.equal(output.matches[0].stale, false);
});

test("Bad schema, duplicate champions, future timestamps and excessive matches are rejected", () => {
  assert.throws(() =>
    normalizeSnapshot({ version: 1, matches: "bad" }, { now: NOW }),
  );
  const duplicate = snapshot();
  duplicate.matches[0].red.picks.top = "Ornn";
  assert.throws(() => normalizeSnapshot(duplicate, { now: NOW }));
  const future = snapshot();
  future.observedAt = new Date(NOW + 120_000).toISOString();
  assert.throws(() => normalizeSnapshot(future, { now: NOW }));
  const excessive = snapshot();
  excessive.matches = Array(101).fill(excessive.matches[0]);
  assert.throws(() => normalizeSnapshot(excessive, { now: NOW }));
});

test("Observation time is preserved and stale/unknown age is visible", () => {
  const old = snapshot();
  old.observedAt = new Date(NOW - 240_000).toISOString();
  const result = normalizeSnapshot(old, { now: NOW });
  assert.equal(result.stale, true);
  assert.equal(result.matches[0].stale, true);
  assert.equal(result.observedAt, old.observedAt);
  delete old.observedAt;
  assert.equal(normalizeSnapshot(old, { now: NOW }).stale, true);
});

test("Upstream token stays in request header; extra provider fields are discarded; cache coalesces calls", async () => {
  let calls = 0;
  const feed = createLiveFeed({
    env: {
      LIVE_FEED_URL: "https://feed.example/live",
      LIVE_FEED_TOKEN: "server-secret",
    },
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://feed.example/live");
      assert.equal(options.headers.Authorization, "Bearer server-secret");
      assert.equal(options.redirect, "error");
      return Response.json({ ...snapshot(), token: "server-secret" });
    },
  });
  const [a, b] = await Promise.all([feed.getSnapshot(), feed.getSnapshot()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.status, "ok");
  assert.equal(JSON.stringify(a).includes("server-secret"), false);
});

test("Authentication, timeouts, rate limits and malformed payloads fail without invented matches or leaked errors", async () => {
  const cases = [
    [async () => new Response("{}", { status: 401 }), "upstream_auth_required"],
    [async () => new Response("{}", { status: 429 }), "upstream_rate_limited"],
    [async () => new Response("bad JSON"), "invalid_payload"],
    [
      async () =>
        new Response("x", { headers: { "content-length": "1000001" } }),
      "payload_too_large",
    ],
    [
      async () => {
        throw new DOMException("secret token omitted", "TimeoutError");
      },
      "upstream_timeout",
    ],
    [
      async () => {
        throw new Error("server-secret");
      },
      "upstream_unavailable",
    ],
  ];
  for (const [fetchImpl, reason] of cases) {
    const feed = createLiveFeed({
      env: { LIVE_FEED_URL: "https://feed.example/live" },
      fetchImpl,
      now: () => NOW,
    });
    const result = await feed.getSnapshot();
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.matches, []);
    assert.equal(JSON.stringify(result).includes("server-secret"), false);
  }
});

test("An unavailable upstream cannot pass through old picks", async () => {
  const input = snapshot();
  input.status = "unavailable";
  const feed = createLiveFeed({
    env: { LIVE_FEED_URL: "https://feed.example/live" },
    fetchImpl: async () => Response.json(input),
    now: () => NOW,
  });
  assert.deepEqual((await feed.getSnapshot()).matches, []);
});

test("PandaScore role keyed frames use champion identity only; game stats do not leak to drafts", () => {
  const players = (names) =>
    Object.fromEntries(
      ["top", "jun", "mid", "adc", "sup"].map((role, index) => [
        role,
        { champion: { name: names[index] }, kills: 100, gold: 9000 },
      ]),
    );
  const message = {
    type: "frame",
    payload: {
      game_id: 55,
      current_timestamp: 1000,
      blue: {
        id: 1,
        name: "Blue",
        players: players(["Ornn", "Vi", "Orianna", "Jinx", "Lulu"]),
      },
      red: {
        id: 2,
        name: "Red",
        players: players(["Renekton", "Lee Sin", "Ahri", "Kai'Sa", "Nautilus"]),
      },
    },
  };
  const result = normalizePandaFrame(
    message,
    { id: 99, league: { name: "LCK" }, games: [{ id: 55, position: 2 }] },
    NOW,
  );
  assert.equal(result.gameNumber, 2);
  assert.equal(result.blue.picks.jng, "Vi");
  assert.equal(result.blue.picks.bot, "Jinx");
  assert.equal(result.rolesConfirmed, true);
  assert.equal(result.status, "in_game");
  assert.equal(JSON.stringify(result).includes("gold"), false);
  assert.equal(normalizePandaFrame({ type: "hello" }, {}, NOW), null);
  assert.equal(
    normalizePandaFrame({ ...message.payload, match_id: 99 }, { id: 99 }, NOW)
      .blue.picks.top,
    "Ornn",
  );
  assert.equal(
    normalizePandaFrame(
      { type: "frame", data: message.payload },
      { id: 99 },
      NOW,
    ).red.picks.jng,
    "Lee Sin",
  );
  assert.equal(
    normalizePandaFrame({ ...message.payload, match_id: 123 }, { id: 99 }, NOW),
    null,
  );
  assert.equal(
    normalizePandaFrame(
      { ...message.payload, game_id: undefined, id: 123 },
      { id: 99 },
      NOW,
    ),
    null,
  );
  assert.equal(
    normalizePandaFrame(
      { ...message.payload, blue: { players: [] } },
      { id: 99 },
      NOW,
    ),
    null,
  );
});

test("PandaScore discovery opens only documented provider hosts and shares received frames", async () => {
  const opened = [];
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      opened.push(this);
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }
  const match = {
    id: 1,
    videogame: { slug: "league-of-legends" },
    league: { name: "LCK" },
  };
  const feed = createLiveFeed({
    env: { PANDASCORE_TOKEN: "server-secret" },
    WebSocketImpl: FakeSocket,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.pandascore.co/lives?per_page=100&page=1");
      assert.equal(options.headers.Authorization, "Bearer server-secret");
      return Response.json([
        {
          match,
          endpoints: [
            {
              type: "frames",
              open: true,
              url: "wss://live.pandascore.co/matches/1",
            },
          ],
        },
        {
          match: { ...match, id: 2 },
          endpoints: [
            {
              type: "frames",
              open: true,
              url: "wss://attacker.example/matches/2",
            },
          ],
        },
      ]);
    },
  });
  const waiting = await feed.getSnapshot();
  assert.equal(waiting.reason, "waiting_for_frames");
  assert.equal(opened.length, 1);
  const players = (names) =>
    Object.fromEntries(
      ["top", "jun", "mid", "adc", "sup"].map((role, index) => [
        role,
        { champion: { name: names[index] } },
      ]),
    );
  opened[0].dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        type: "frame",
        payload: {
          game_id: 3,
          blue: { players: players(["Ornn", "Vi", "Orianna", "Jinx", "Lulu"]) },
          red: {
            players: players([
              "Renekton",
              "Lee Sin",
              "Ahri",
              "Kai'Sa",
              "Nautilus",
            ]),
          },
        },
      }),
    }),
  );
  const live = await feed.getSnapshot();
  assert.equal(live.matches.length, 1);
  assert.equal(live.capabilities.draftPhase, false);
  assert.equal(live.matches[0].blue.picks.bot, "Jinx");
  assert.equal(JSON.stringify(live).includes("server-secret"), false);
  feed.close();
});

test("PandaScore honors discovery pagination and exposes stream plan denial as unavailable", async () => {
  const opened = [];
  const requests = [];
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      opened.push(this);
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }
  const feed = createLiveFeed({
    env: { PANDASCORE_TOKEN: "server-secret" },
    WebSocketImpl: FakeSocket,
    now: () => NOW,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith("page=1"))
        return Response.json(
          Array.from({ length: 100 }, (_, id) => ({
            match: { id: id + 1, videogame: { slug: "another-game" } },
          })),
        );
      return Response.json([
        {
          match: { id: 101, videogame: { slug: "league-of-legends" } },
          endpoints: [
            {
              type: "frames",
              open: true,
              url: "wss://live.pandascore.co/matches/101",
            },
          ],
        },
      ]);
    },
  });
  await feed.getSnapshot();
  assert.equal(requests.length, 2);
  assert.equal(opened.length, 1);
  const denied = new Event("close");
  Object.defineProperty(denied, "code", { value: 4003 });
  opened[0].dispatchEvent(denied);
  const result = await feed.getSnapshot();
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "upstream_auth_required");
  assert.deepEqual(result.matches, []);
  feed.close();
});

test("Configured timeout actually aborts an upstream request", async () => {
  const feed = createLiveFeed({
    env: { LIVE_FEED_URL: "https://feed.example/live" },
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        // A socket normally keeps Node alive; emulate that while awaiting abort.
        const timer = setTimeout(
          () => reject(new Error("test_request_did_not_abort")),
          1000,
        );
        signal.addEventListener("abort", () => clearTimeout(timer), {
          once: true,
        });
      }),
  });
  const result = await feed.getSnapshot();
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "upstream_timeout");
});

test("Server serves only frontend folders, no evidence/env files; CORS and read-only API work", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kazewa-live-test-"));
  await mkdir(path.join(root, "public"));
  await writeFile(
    path.join(root, "public", "index.html"),
    "<title>Draft Lab</title>",
  );
  await writeFile(path.join(root, "private.json"), '{"secret":true}');
  const feed = {
    getSnapshot: async () => ({
      version: 1,
      status: "not_configured",
      matches: [],
    }),
    close() {},
  };
  const server = createServer({
    root,
    env: { FRONTEND_ORIGIN: "https://samuel.example" },
    feed,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/private.json`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/server/live-feed.mjs`)).status, 404);
  const live = await fetch(`${base}/api/live`, {
    headers: { Origin: "https://samuel.example" },
  });
  assert.equal(
    live.headers.get("access-control-allow-origin"),
    "https://samuel.example",
  );
  assert.equal((await live.json()).status, "not_configured");
  assert.equal(
    (
      await fetch(`${base}/api/live`, {
        headers: { Origin: "https://other.example" },
      })
    ).headers.get("access-control-allow-origin"),
    null,
  );
  assert.equal(
    (await fetch(`${base}/api/live`, { method: "POST" })).status,
    405,
  );
});
