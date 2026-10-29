/** Server-only adapters. Provider credentials never reach the browser. */
import { createLolesportsFeed } from "./lolesports.mjs";
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const MAX_BODY_BYTES = 1_000_000;
const MAX_MATCHES = 100;
const TIMEOUT_MS = 8_000;
const STALE_MS = 180_000;
const clean = (value, max = 160) =>
  typeof value === "string"
    ? value.slice(0, max).replace(/[\u0000-\u001f]/g, "")
    : "";
const validTime = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function allowedUpstream(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash)
    throw new Error("invalid_config");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("invalid_config");
  return url;
}

function safeSource(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeTeam(team) {
  if (!team || typeof team !== "object" || Array.isArray(team))
    throw new Error("invalid_payload");
  const picks = {};
  for (const role of ROLES) {
    const value = team.picks?.[role];
    if (value !== undefined && value !== null && typeof value !== "string")
      throw new Error("invalid_payload");
    picks[role] = clean(value, 60) || null;
  }
  return { name: clean(team.name, 100) || "Équipe inconnue", picks };
}

/** Strict normalized interchange format. Unknown roles are never guessed from pick order. */
export function normalizeSnapshot(
  input,
  { now = Date.now(), provider = "upstream" } = {},
) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.matches) ||
    input.matches.length > MAX_MATCHES
  )
    throw new Error("invalid_payload");
  if (!["ok", "not_configured", "unavailable"].includes(input.status))
    throw new Error("invalid_payload");
  if (input.observedAt != null && !validTime(input.observedAt))
    throw new Error("invalid_payload");
  const seen = new Set();
  const matches = input.matches.map((match) => {
    if (!match || !["draft", "in_game", "finished"].includes(match.status))
      throw new Error("invalid_payload");
    if (
      typeof match.id !== "string" ||
      !match.id ||
      match.id.length > 180 ||
      seen.has(match.id)
    )
      throw new Error("invalid_payload");
    seen.add(match.id);
    if (match.observedAt != null && !validTime(match.observedAt))
      throw new Error("invalid_payload");
    const blue = normalizeTeam(match.blue);
    const red = normalizeTeam(match.red);
    const picks = [
      ...Object.values(blue.picks),
      ...Object.values(red.picks),
    ].filter(Boolean);
    if (new Set(picks.map((pick) => pick.toLowerCase())).size !== picks.length)
      throw new Error("invalid_payload");
    const observedAt = match.observedAt || input.observedAt || null;
    if (observedAt && Date.parse(observedAt) > now + 60_000)
      throw new Error("invalid_payload");
    return {
      id: match.id,
      league: clean(match.league, 100),
      gameNumber:
        Number.isInteger(match.gameNumber) && match.gameNumber > 0
          ? match.gameNumber
          : null,
      status: match.status,
      patch: clean(match.patch, 30) || null,
      sourceUrl: safeSource(match.sourceUrl),
      observedAt,
      stale: !observedAt || now - Date.parse(observedAt) > STALE_MS,
      rolesConfirmed: match.rolesConfirmed === true,
      blue,
      red,
    };
  });
  const observedAt = input.observedAt || null;
  if (observedAt && Date.parse(observedAt) > now + 60_000)
    throw new Error("invalid_payload");
  const unavailable = input.status !== "ok";
  return {
    version: 1,
    provider: clean(input.provider, 60) || provider,
    fetchedAt: new Date(now).toISOString(),
    observedAt,
    status: input.status,
    reason: unavailable
      ? input.status === "not_configured"
        ? "provider_not_configured"
        : "provider_unavailable"
      : null,
    capabilities: {
      draftPhase: input.capabilities?.draftPhase === true,
      rolesConfirmed: input.capabilities?.rolesConfirmed === true,
    },
    delaySeconds:
      Number.isFinite(input.delaySeconds) && input.delaySeconds >= 0
        ? input.delaySeconds
        : null,
    stale: !observedAt || now - Date.parse(observedAt) > STALE_MS,
    matches: unavailable ? [] : matches,
  };
}

function empty(status, reason, provider = "none", now = Date.now()) {
  return {
    version: 1,
    provider,
    fetchedAt: new Date(now).toISOString(),
    observedAt: null,
    status,
    reason,
    capabilities: { draftPhase: false, rolesConfirmed: false },
    delaySeconds: null,
    stale: true,
    matches: [],
  };
}

async function readJson(response) {
  const announced = Number(response.headers.get("content-length"));
  if (announced > MAX_BODY_BYTES) throw new Error("payload_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_payload");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("payload_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_payload");
  }
}

async function requestJson(fetchImpl, url, token, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok)
    throw new Error(
      [401, 403].includes(response.status)
        ? "upstream_auth_required"
        : response.status === 429
          ? "upstream_rate_limited"
          : "upstream_unavailable",
    );
  return readJson(response);
}

/** PandaScore's documented role-keyed frames. In-game state is deliberately discarded. */
export function normalizePandaFrame(message, match, now = Date.now()) {
  if (!message || (message.type != null && message.type !== "frame"))
    return null;
  // The public field reference describes the frame body. Accept an unwrapped body
  // or a frame envelope, but require the documented side/role objects in all cases.
  const frame =
    message.type === "frame" ? (message.payload ?? message.data) : message;
  if (
    !frame?.blue?.players ||
    !frame?.red?.players ||
    Array.isArray(frame.blue.players) ||
    Array.isArray(frame.red.players)
  )
    return null;
  if (frame.match_id != null && String(frame.match_id) !== String(match.id))
    return null;
  const roles = { top: "top", jng: "jun", mid: "mid", bot: "adc", sup: "sup" };
  const team = (side) => ({
    name:
      clean(frame[side].name, 100) ||
      match.opponents?.find((entry) => entry.opponent?.id === frame[side].id)
        ?.opponent?.name ||
      "Équipe inconnue",
    picks: Object.fromEntries(
      Object.entries(roles).map(([role, upstream]) => [
        role,
        clean(frame[side].players[upstream]?.champion?.name, 60) || null,
      ]),
    ),
  });
  const blue = team("blue");
  const red = team("red");
  const gameId = frame.game_id ?? frame.game?.id;
  if (!Number.isSafeInteger(gameId) || gameId < 1) return null;
  return {
    id: `pandascore:${match.id}:${gameId}`,
    league: clean(match.league?.name, 100),
    gameNumber:
      match.games?.find((game) => String(game.id) === String(gameId))
        ?.position ?? null,
    status:
      (frame.finished ?? frame.game?.finished) === true
        ? "finished"
        : "in_game",
    patch: clean(match.videogame_version?.name, 30) || null,
    sourceUrl: "https://www.pandascore.co/stats",
    observedAt: new Date(now).toISOString(),
    rolesConfirmed: true,
    blue,
    red,
  };
}

export function createLiveFeed({
  env = process.env,
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
  now = Date.now,
  timeoutMs = TIMEOUT_MS,
  cacheMs = 10_000,
} = {}) {
  let cached = null;
  let cacheAt = -Infinity;
  let pending = null;
  let discoveryAt = -Infinity;
  let closed = false;
  const sockets = new Map();
  const frames = new Map();
  let discoveryError = null;
  let upstream;
  let configError = false;
  const lolesports =
    env.LIVE_PROVIDER === "lolesports"
      ? createLolesportsFeed({ fetchImpl, now, timeoutMs })
      : null;
  if (env.LIVE_FEED_URL) {
    try {
      upstream = allowedUpstream(env.LIVE_FEED_URL);
    } catch {
      configError = true;
    }
  }

  function connect(entry) {
    const match = entry.match;
    const endpoint = entry.endpoints?.find(
      (endpoint) => endpoint.type === "frames" && endpoint.open === true,
    );
    if (!match?.id || !endpoint?.url || sockets.has(String(match.id))) return;
    let url;
    try {
      url = new URL(endpoint.url);
      if (
        url.protocol !== "wss:" ||
        url.hostname !== "live.pandascore.co" ||
        url.username ||
        url.password
      )
        return;
      url.searchParams.set("token", env.PANDASCORE_TOKEN);
    } catch {
      return;
    }
    const socket = new WebSocketImpl(url.href);
    sockets.set(String(match.id), socket);
    socket.addEventListener("message", (event) => {
      if (
        closed ||
        typeof event.data !== "string" ||
        event.data.length > MAX_BODY_BYTES
      )
        return;
      try {
        const draft = normalizePandaFrame(JSON.parse(event.data), match, now());
        if (draft) {
          frames.set(String(match.id), draft);
          cached = null;
        }
      } catch {
        /* Malformed provider frames cannot become verdicts. */
      }
    });
    socket.addEventListener("error", () => {
      discoveryError = "upstream_stream_unavailable";
      cached = null;
    });
    socket.addEventListener("close", (event) => {
      sockets.delete(String(match.id));
      cached = null;
      if (closed) return;
      if (event.code === 1000) {
        const prior = frames.get(String(match.id));
        if (prior)
          frames.set(String(match.id), { ...prior, status: "finished" });
        return;
      }
      frames.delete(String(match.id));
      discoveryError = [4001, 4003].includes(event.code)
        ? "upstream_auth_required"
        : event.code === 4029
          ? "upstream_rate_limited"
          : "upstream_stream_unavailable";
    });
  }

  async function pandaSnapshot() {
    if (!WebSocketImpl)
      return empty("unavailable", "websocket_unavailable", "pandascore", now());
    if (now() - discoveryAt > 45_000) {
      const entries = [];
      for (let page = 1; page <= 5; page++) {
        const batch = await requestJson(
          fetchImpl,
          `https://api.pandascore.co/lives?per_page=100&page=${page}`,
          env.PANDASCORE_TOKEN,
          timeoutMs,
        );
        if (!Array.isArray(batch) || batch.length > 100)
          throw new Error("invalid_payload");
        entries.push(...batch);
        if (batch.length < 100) break;
      }
      const live = entries
        .filter(
          (entry) => entry?.match?.videogame?.slug === "league-of-legends",
        )
        .slice(0, 30);
      const ids = new Set(live.map((entry) => String(entry.match.id)));
      for (const [id, socket] of sockets) {
        if (!ids.has(id)) {
          socket.close();
          sockets.delete(id);
        }
      }
      for (const id of frames.keys()) {
        if (!ids.has(id)) frames.delete(id);
      }
      live.forEach(connect);
      discoveryAt = now();
      discoveryError = null;
    }
    const matches = [...frames.values()].filter(
      (match) => now() - Date.parse(match.observedAt) <= STALE_MS,
    );
    if (discoveryError && !matches.length)
      return empty("unavailable", discoveryError, "pandascore", now());
    const observedAt = matches.length
      ? matches.reduce(
          (latest, match) =>
            match.observedAt > latest ? match.observedAt : latest,
          matches[0].observedAt,
        )
      : new Date(discoveryAt).toISOString();
    const result = normalizeSnapshot(
      {
        version: 1,
        status: "ok",
        provider: "pandascore",
        observedAt,
        capabilities: { draftPhase: false, rolesConfirmed: true },
        delaySeconds: null,
        matches,
      },
      { now: now() },
    );
    result.reason =
      discoveryError ||
      (sockets.size && !matches.length ? "waiting_for_frames" : null);
    result.observationClock = "receipt";
    return result;
  }

  async function refresh() {
    if (closed) return empty("unavailable", "feed_closed", "none", now());
    if (configError)
      return empty("unavailable", "invalid_config", "upstream", now());
    if (!upstream && !env.PANDASCORE_TOKEN && !lolesports)
      return empty("not_configured", "provider_not_configured", "none", now());
    try {
      if (upstream) {
        const value = await requestJson(
          fetchImpl,
          upstream.href,
          env.LIVE_FEED_TOKEN,
          timeoutMs,
        );
        return normalizeSnapshot(value, { now: now() });
      }
      if (lolesports) {
        const source = await lolesports.getSnapshot();
        const result = normalizeSnapshot(source, {
          now: now(),
          provider: "lolesports-public",
        });
        result.reason = source.reason;
        result.observationClock = source.observationClock;
        return result;
      }
      return await pandaSnapshot();
    } catch (error) {
      const allowed = [
        "invalid_payload",
        "payload_too_large",
        "upstream_auth_required",
        "upstream_rate_limited",
        "upstream_unavailable",
      ];
      const reason = allowed.includes(error?.message)
        ? error.message
        : error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "upstream_timeout"
          : "upstream_unavailable";
      return empty(
        "unavailable",
        reason,
        upstream ? "upstream" : lolesports ? "lolesports-public" : "pandascore",
        now(),
      );
    }
  }

  return {
    async getSnapshot() {
      if (cached && now() - cacheAt < cacheMs) return cached;
      if (pending) return pending;
      pending = refresh()
        .then((result) => {
          cached = result;
          cacheAt = now();
          return result;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    close() {
      closed = true;
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
      frames.clear();
      cached = null;
    },
  };
}
