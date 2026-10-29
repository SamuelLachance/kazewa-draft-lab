import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  discoverLolesportsGames,
  normalizeLolesportsWindow,
  createLolesportsFeed,
  LOLESPORTS_HOME,
} from "../server/lolesports.mjs";
import { createLiveFeed, normalizeSnapshot } from "../server/live-feed.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/lolesports-public.json", import.meta.url),
    "utf8",
  ),
);
const assets = JSON.parse(
  await readFile(
    new URL("../data/champion-assets.json", import.meta.url),
    "utf8",
  ),
);
const sourceTime = Date.parse(fixture.window.frames[0].rfc460Timestamp);
const clone = (value) => JSON.parse(JSON.stringify(value));
const html = (events, tail = "") =>
  `<html><script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"empty":{"data":undefined}},"events":[{"type":"next","value":{"result":{"data":{"esports":{"events":${JSON.stringify(events)}}}}}}]})${tail}</script></html>`;
const active = () => {
  const event = clone(fixture.event);
  event.state = "inProgress";
  event.match.state = "inProgress";
  event.match.games[0].state = "inProgress";
  return event;
};

test("Captured official completed game stays historical and never becomes a live match", () => {
  const result = discoverLolesportsGames(html([fixture.event]));
  assert.equal(result.totalEvents, 1);
  assert.equal(result.activeSeries, 0);
  assert.deepEqual(result.games, []);
});

test("Official public SSR structure discovers active games using game state and stable team IDs", () => {
  const result = discoverLolesportsGames(html([active(), active()]));
  assert.equal(result.activeSeries, 1);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].id, fixture.window.esportsGameId);
  assert.equal(
    result.games[0].teams[0].id,
    fixture.window.gameMetadata.blueTeamMetadata.esportsTeamId,
  );
});

test("No JS is executed; undefined inside a team name survives; missing transport fails closed", () => {
  const event = active();
  event.matchTeams[0].name = "undefined is a team name";
  assert.equal(
    discoverLolesportsGames(html([event])).games[0].teams[0].name,
    "undefined is a team name",
  );
  assert.throws(
    () =>
      discoverLolesportsGames(
        "<html>No transport after a site redesign</html>",
      ),
    /invalid_payload/,
  );
  assert.throws(
    () =>
      discoverLolesportsGames(html([event], "; globalThis.injected = true")),
    /invalid_payload/,
  );
  assert.equal(globalThis.injected, undefined);
});

test("Historical real feed metadata maps KSante and MonkeyKing through exact official Data Dragon identifiers", () => {
  const game = discoverLolesportsGames(html([active()])).games[0];
  const result = normalizeLolesportsWindow(fixture.window, game, assets);
  assert.equal(result.red.picks.top, "K'Sante");
  assert.equal(result.red.picks.jng, "Wukong");
  assert.equal(result.blue.picks.mid, "Ryze");
  assert.equal(result.blue.name, fixture.event.matchTeams[0].name);
  assert.equal(result.rolesConfirmed, true);
  assert.equal(result.observedAt, fixture.window.frames[0].rfc460Timestamp);
  assert.equal("summonerName" in result.blue, false);
});

test("Unknown champions remain unresolved; duplicated roles or conflicting team identities are rejected", () => {
  const game = discoverLolesportsGames(html([active()])).games[0];
  const missing = clone(fixture.window);
  missing.gameMetadata.blueTeamMetadata.participantMetadata[0].championId =
    "NewUnknownChampion";
  const result = normalizeLolesportsWindow(missing, game, assets);
  assert.equal(result.blue.picks.top, null);
  assert.equal(result.rolesConfirmed, false);
  const badRole = clone(fixture.window);
  badRole.gameMetadata.blueTeamMetadata.participantMetadata[0].role = "mid";
  assert.throws(
    () => normalizeLolesportsWindow(badRole, game, assets),
    /invalid_payload/,
  );
  const badTeam = clone(fixture.window);
  badTeam.gameMetadata.blueTeamMetadata.esportsTeamId = "999999999999999999";
  assert.throws(
    () => normalizeLolesportsWindow(badTeam, game, assets),
    /invalid_payload/,
  );
});

test("A valid no-key source with no active game returns an honest empty response", async () => {
  const urls = [];
  const feed = createLolesportsFeed({
    assets,
    now: () => sourceTime,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(html([fixture.event]));
    },
  });
  const response = await feed.getSnapshot();
  assert.deepEqual(urls, [LOLESPORTS_HOME]);
  assert.equal(response.status, "ok");
  assert.equal(response.provider, "lolesports-public");
  assert.equal(response.capabilities.draftPhase, false);
  assert.deepEqual(response.matches, []);
});

test("Adapter requests a timestamped ten-second block; opening-frame fallback preserves historical age", async () => {
  const urls = [];
  const now = Date.parse("2026-10-29T12:00:00Z");
  const feed = createLolesportsFeed({
    assets,
    now: () => now,
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "error");
      if (url === LOLESPORTS_HOME) return new Response(html([active()]));
      if (url.includes("startingTime="))
        return new Response("{}", { status: 404 });
      return Response.json(fixture.window);
    },
  });
  const response = normalizeSnapshot(await feed.getSnapshot(), { now });
  assert.ok(urls[1].includes("startingTime=2026-10-29T11%3A59%3A00.000Z"));
  assert.equal(urls.length, 3);
  assert.equal(response.matches[0].stale, true);
  assert.equal(response.stale, true);
  assert.equal(response.observedAt, fixture.window.frames[0].rfc460Timestamp);
});

test("Frame query succeeds without authorization; HTML discovery is cached separately from frame polling", async () => {
  let pages = 0,
    frames = 0;
  const feed = createLolesportsFeed({
    assets,
    now: () => sourceTime + 60_000,
    fetchImpl: async (url) => {
      if (url === LOLESPORTS_HOME) {
        pages++;
        return new Response(html([active()]));
      }
      frames++;
      return Response.json(fixture.window);
    },
  });
  await feed.getSnapshot();
  await feed.getSnapshot();
  assert.equal(pages, 1);
  assert.equal(frames, 2);
});

test("LIVE_PROVIDER=lolesports integrates a sanitized cached public snapshot without any provider token", async () => {
  const requests = [];
  const feed = createLiveFeed({
    env: { LIVE_PROVIDER: "lolesports", LIVE_FEED_TOKEN: "must-stay-private" },
    now: () => sourceTime + 60_000,
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.Authorization, undefined);
      if (url === LOLESPORTS_HOME) return new Response(html([active()]));
      return Response.json({ ...fixture.window, token: "must-stay-private" });
    },
  });
  const first = await feed.getSnapshot();
  const second = await feed.getSnapshot();
  assert.equal(first, second);
  assert.equal(requests.length, 2);
  assert.equal(first.status, "ok");
  assert.equal(first.provider, "lolesports-public");
  assert.equal(first.capabilities.draftPhase, false);
  assert.equal(first.observationClock, "source");
  assert.equal(first.matches[0].rolesConfirmed, true);
  assert.equal(first.matches[0].red.picks.jng, "Wukong");
  assert.equal(first.matches[0].stale, false);
  assert.equal(JSON.stringify(first).includes("must-stay-private"), false);
  feed.close();
});
