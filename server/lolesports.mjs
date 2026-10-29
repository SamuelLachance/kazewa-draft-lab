/** Optional, unofficial adapter over publicly served LoL Esports pages/frames. */
import { readFile } from "node:fs/promises";

export const LOLESPORTS_HOME = "https://lolesports.com/en-US";
const FEED_BASE = "https://feed.lolesports.com/livestats/v1/window/";
const ASSETS_URL = new URL("../data/champion-assets.json", import.meta.url);
const ROLES = {
  top: "top",
  jungle: "jng",
  mid: "mid",
  bottom: "bot",
  support: "sup",
};
const text = (value, limit = 160) =>
  typeof value === "string"
    ? value.slice(0, limit).replace(/[\u0000-\u001f]/g, "")
    : "";
const validId = (value) =>
  typeof value === "string" && /^\d{10,30}$/.test(value);

async function boundedText(fetchImpl, url, timeoutMs, limit) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: url === LOLESPORTS_HOME ? "text/html" : "application/json",
    },
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "frame_not_available"
        : [401, 403].includes(response.status)
          ? "upstream_auth_required"
          : response.status === 429
            ? "upstream_rate_limited"
            : "upstream_unavailable",
    );
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("payload_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_payload");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("payload_too_large");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    bytes.set(part, cursor);
    cursor += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Apollo serializes undefined; convert only that data token, never execute JS. */
function parseApolloData(literal) {
  let result = "",
    quoted = false,
    escaped = false;
  for (let index = 0; index < literal.length; index++) {
    const character = literal[index];
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
      result += character;
    } else if (
      literal.startsWith("undefined", index) &&
      !/[A-Za-z0-9_$]/.test(literal[index - 1] || "") &&
      !/[A-Za-z0-9_$]/.test(literal[index + 9] || "")
    ) {
      result += "null";
      index += 8;
    } else result += character;
  }
  try {
    return JSON.parse(result);
  } catch {
    throw new Error("invalid_payload");
  }
}

function teamIdentity(team) {
  const supplied = String(team?.teamId ?? team?.id ?? "");
  const id = supplied.includes(":")
    ? supplied.slice(supplied.lastIndexOf(":") + 1)
    : supplied;
  if (!validId(id) || !text(team?.name, 100)) return null;
  return { id, name: text(team.name, 100) };
}

/** Current official SSR format, verified 2026-10-29. HTML changes fail closed. */
export function discoverLolesportsGames(html) {
  if (typeof html !== "string" || html.length > 5_000_000)
    throw new Error("payload_too_large");
  const payloads = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1].trim();
    const prefix = script.match(
      /^\(window\[Symbol\.for\(["']ApolloSSRDataTransport["']\)\]\s*\?\?=\s*\[\]\)\.push\(/,
    );
    if (!prefix) continue;
    if (!/\)\s*;?\s*$/.test(script)) throw new Error("invalid_payload");
    payloads.push(
      parseApolloData(
        script.slice(prefix[0].length).replace(/\)\s*;?\s*$/, ""),
      ),
    );
  }
  if (!payloads.length) throw new Error("invalid_payload");
  const stack = payloads.map((value) => ({ value, depth: 0 }));
  const events = new Map();
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (++visited > 150_000 || depth > 50) throw new Error("invalid_payload");
    if (value.__typename === "EventMatch" && value.match && validId(value.id)) {
      const prior = events.get(value.id);
      // Prefer the full home fragment over a fragment omitting state/teams.
      if (
        !prior ||
        (value.state && !prior.state) ||
        (value.matchTeams && !prior.matchTeams)
      )
        events.set(value.id, value);
    }
    for (const child of Object.values(value))
      if (child && typeof child === "object")
        stack.push({ value: child, depth: depth + 1 });
  }
  const liveEvents = [...events.values()].filter(
    (event) => event.state === "inProgress",
  );
  const games = new Map();
  for (const event of liveEvents) {
    if (!validId(String(event.match.id))) throw new Error("invalid_payload");
    const teams = (event.matchTeams ?? event.match.matchTeams ?? [])
      .map(teamIdentity)
      .filter(Boolean);
    if (teams.length !== 2 || teams[0].id === teams[1].id)
      throw new Error("invalid_payload");
    for (const game of event.match.games ?? []) {
      if (game.state !== "inProgress") continue;
      if (!validId(String(game.id))) throw new Error("invalid_payload");
      if (
        games.has(String(game.id)) &&
        games.get(String(game.id)).matchId !== String(event.match.id)
      )
        throw new Error("invalid_payload");
      games.set(String(game.id), {
        id: String(game.id),
        matchId: String(event.match.id),
        number: Number.isInteger(game.number) ? game.number : null,
        league: text(event.league?.name, 100),
        leagueSlug: text(event.league?.slug, 80),
        teams,
      });
    }
  }
  if (games.size > 30) throw new Error("invalid_payload");
  return {
    games: [...games.values()],
    activeSeries: liveEvents.length,
    totalEvents: events.size,
  };
}

export function normalizeLolesportsWindow(payload, game, assets) {
  if (
    !payload ||
    String(payload.esportsGameId) !== game.id ||
    String(payload.esportsMatchId) !== game.matchId ||
    !payload.gameMetadata ||
    !Array.isArray(payload.frames)
  )
    throw new Error("invalid_payload");
  const identifiers = new Map(
    (assets?.champions ?? []).flatMap((champion) => [
      [champion.id, champion.name],
      [champion.key, champion.name],
    ]),
  );
  if (identifiers.size < 100) throw new Error("invalid_payload");
  const latest = payload.frames
    .filter(
      (frame) =>
        typeof frame?.rfc460Timestamp === "string" &&
        Number.isFinite(Date.parse(frame.rfc460Timestamp)),
    )
    .sort(
      (a, b) => Date.parse(b.rfc460Timestamp) - Date.parse(a.rfc460Timestamp),
    )[0];
  if (!latest || !["in_game", "paused", "finished"].includes(latest.gameState))
    throw new Error("invalid_payload");
  let rolesConfirmed = true;
  const unknownChampionIds = [];
  const team = (side) => {
    const metadata = payload.gameMetadata[`${side}TeamMetadata`];
    const identity = game.teams.find(
      (entry) => entry.id === String(metadata?.esportsTeamId),
    );
    if (
      !identity ||
      !Array.isArray(metadata.participantMetadata) ||
      metadata.participantMetadata.length !== 5
    )
      throw new Error("invalid_payload");
    const picks = { top: null, jng: null, mid: null, bot: null, sup: null };
    const seen = new Set();
    for (const participant of metadata.participantMetadata) {
      const role = ROLES[participant.role];
      if (!role || seen.has(role)) throw new Error("invalid_payload");
      seen.add(role);
      const champion = identifiers.get(String(participant.championId));
      if (!champion) {
        rolesConfirmed = false;
        unknownChampionIds.push(text(String(participant.championId), 60));
      }
      picks[role] = champion ?? null;
    }
    return { name: identity.name, picks };
  };
  const blue = team("blue"),
    red = team("red");
  const blueId = String(payload.gameMetadata.blueTeamMetadata.esportsTeamId);
  if (blueId === String(payload.gameMetadata.redTeamMetadata.esportsTeamId))
    throw new Error("invalid_payload");
  return {
    id: `lolesports:${game.id}`,
    league: game.league,
    gameNumber: game.number,
    status: latest.gameState === "finished" ? "finished" : "in_game",
    patch: text(payload.gameMetadata.patchVersion, 30) || null,
    sourceUrl: "https://lolesports.com/en-US",
    observedAt: latest.rfc460Timestamp,
    rolesConfirmed,
    blue,
    red,
    ...(unknownChampionIds.length ? { unknownChampionIds } : {}),
  };
}

export function createLolesportsFeed({
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 8_000,
  assets,
  discoveryMs = 60_000,
} = {}) {
  let discovered = null,
    discoveryAt = -Infinity,
    assetData = assets;
  return {
    async getSnapshot() {
      if (!assetData) {
        try {
          assetData = JSON.parse(await readFile(ASSETS_URL, "utf8"));
        } catch {
          throw new Error("invalid_payload");
        }
      }
      if (!discovered || now() - discoveryAt >= discoveryMs) {
        const html = await boundedText(
          fetchImpl,
          LOLESPORTS_HOME,
          timeoutMs,
          5_000_000,
        );
        discovered = discoverLolesportsGames(html);
        discoveryAt = now();
      }
      const matches = [];
      let waiting = discovered.activeSeries > 0 && !discovered.games.length;
      // Request a ten-second block behind wall time. The undated endpoint was
      // verified to return opening frames, so it is only a just-started fallback.
      const startingTime = new Date(
        Math.floor((now() - 60_000) / 10_000) * 10_000,
      ).toISOString();
      for (let offset = 0; offset < discovered.games.length; offset += 4) {
        const batch = await Promise.all(
          discovered.games.slice(offset, offset + 4).map(async (game) => {
            let body;
            try {
              body = await boundedText(
                fetchImpl,
                `${FEED_BASE}${game.id}?startingTime=${encodeURIComponent(startingTime)}`,
                timeoutMs,
                2_000_000,
              );
            } catch (error) {
              if (error.message !== "frame_not_available") throw error;
              try {
                body = await boundedText(
                  fetchImpl,
                  `${FEED_BASE}${game.id}`,
                  timeoutMs,
                  2_000_000,
                );
              } catch (fallback) {
                if (fallback.message === "frame_not_available") {
                  waiting = true;
                  return null;
                }
                throw fallback;
              }
            }
            let payload;
            try {
              payload = JSON.parse(body);
            } catch {
              throw new Error("invalid_payload");
            }
            return normalizeLolesportsWindow(payload, game, assetData);
          }),
        );
        matches.push(...batch.filter(Boolean));
      }
      const observedAt = matches.length
        ? matches.reduce(
            (latest, match) =>
              Date.parse(match.observedAt) > Date.parse(latest)
                ? match.observedAt
                : latest,
            matches[0].observedAt,
          )
        : new Date(discoveryAt).toISOString();
      return {
        version: 1,
        status: "ok",
        provider: "lolesports-public",
        observedAt,
        capabilities: { draftPhase: false, rolesConfirmed: true },
        delaySeconds: null,
        matches,
        reason: waiting && !matches.length ? "waiting_for_frames" : null,
        observationClock: matches.length ? "source" : "discovery_receipt",
      };
    },
  };
}
