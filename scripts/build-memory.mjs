/**
 * Builds data/kazewa-memory.json: every draft Kazewa judged in the local corpus,
 * with the roster verified against professional match data when available.
 *
 * Sources (parent corpus, never shipped):
 *   kb/clean_verdicts/*.json   draft-phase-only extractions (highest label tier)
 *   verdicts/*.json            full-review extractions
 *   kb_key/test_key.json + kb/eval/test_drafts.json
 *   kb_key/test_key2.json + kb/eval2/dossiers/*.md headers
 * Optional: .cache/oe-games.json from scripts/build-oe-index.mjs.
 *
 *   node scripts/build-memory.mjs [--corpus <dir>] [--oe <index.json>]
 *
 * The output keeps one case per real game. A verdict comes from the best timing
 * tier available: draft phase, then review, then explicitly late opinion.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeChampion, ROLES } from "../src/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const corpus = path.resolve(
  arg(
    "--corpus",
    process.env.KAZEWA_CORPUS ?? path.resolve(root, "..", "..", "kazewa"),
  ),
);
const oePath = path.resolve(root, arg("--oe", ".cache/oe-games.json"));
const knowledge = JSON.parse(
  fs.readFileSync(path.join(root, "data", "knowledge.json"), "utf8"),
);
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(corpus, relative), "utf8"));
const champ = (value) =>
  typeof value === "string" ? normalizeChampion(value, knowledge) : null;
const SIDES = ["blue", "red"];
const flip = (side) =>
  side === "blue" ? "red" : side === "red" ? "blue" : side;

/* ------------------------------------------------------------------ */
/* 1. Records                                                          */
/* ------------------------------------------------------------------ */
const normalizeTeam = (picks) =>
  Object.fromEntries(ROLES.map((role) => [role, champ(picks?.[role])]));
const knownPicks = (record) => {
  const list = [];
  for (const screen of ["left", "right"])
    for (const role of ROLES)
      if (record[screen][role])
        list.push({ screen, role, champion: record[screen][role] });
  return list;
};
const cleanText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const tsSeconds = (value) => {
  if (typeof value !== "string") return null;
  const parts = value.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
};

const records = [];
const videoTitles = new Map();
// Only the playlist export carries real video titles. A title damaged by its
// encoding is dropped rather than shown with holes; titles written by the
// extraction step are descriptions, not titles, and are never shown.
try {
  for (const entry of readJson("pro_reviews.json")) {
    const title = cleanText(entry?.title);
    if (entry?.id && title && !title.includes("\uFFFD")) videoTitles.set(entry.id, title);
  }
} catch {
  /* optional */
}

for (const name of fs.readdirSync(path.join(corpus, "kb", "clean_verdicts")).sort()) {
  if (!name.endsWith(".json")) continue;
  for (const row of readJson(`kb/clean_verdicts/${name}`)) {
    const match = /^(.*)_g(\d+)$/.exec(row.file ?? "");
    if (!match) continue;
    records.push({
      kind: "clean",
      ref: `kb/clean_verdicts/${name}#${row.file}`,
      key: row.file,
      video: match[1],
      gameNo: Number(match[2]),
      left: normalizeTeam(row.left_picks),
      right: normalizeTeam(row.right_picks),
      teams: null,
      side: row.verdict?.side ?? null,
      confidence: Number(row.verdict?.confidence) || 0,
      label: cleanText(row.verdict?.label),
      late: false,
      reasons: (row.reasons ?? []).map(cleanText).filter(Boolean),
      reads: row.champion_reads ?? [],
      ts: tsSeconds(row.quote_ts),
      bans: (row.bans ?? []).map(champ).filter(Boolean),
      result: null,
    });
  }
}

for (const name of fs.readdirSync(path.join(corpus, "verdicts")).sort()) {
  if (!name.endsWith(".json")) continue;
  const file = readJson(`verdicts/${name}`);
  (file.games ?? []).forEach((game, index) => {
    records.push({
      kind: "raw",
      ref: `verdicts/${name}#${index + 1}`,
      key: `${file.video}#${index + 1}`,
      video: file.video,
      gameNo: Number(game.game) || index + 1,
      left: normalizeTeam(game.left_picks),
      right: normalizeTeam(game.right_picks),
      teams: { left: cleanText(game.left), right: cleanText(game.right) },
      side: game.verdict?.side ?? null,
      confidence: Number(game.verdict?.confidence) || 0,
      label: cleanText(game.verdict?.label),
      late: Boolean(game.late_opinion || game.verdict?.late_opinion),
      sidesUncertain: Boolean(game.sides_uncertain),
      reasons: (game.reasons ?? []).map(cleanText).filter(Boolean),
      reads: game.champion_reads ?? [],
      ts: null,
      bans: [],
      result: ["left", "right"].includes(game.result) ? game.result : null,
      context: cleanText(file.series?.context),
    });
  });
}

// Answer keys carry exact blue/red rosters. Their rosters use real map sides.
const keyRoster = (blue, red) => ({
  left: normalizeTeam(blue),
  right: normalizeTeam(red),
});
try {
  const drafts = new Map(
    readJson("kb/eval/test_drafts.json").map((d) => [d.id, d]),
  );
  for (const key of readJson("kb_key/test_key.json")) {
    const draft = drafts.get(key.id);
    if (!draft) continue;
    records.push({
      kind: "key1",
      ref: `kb_key/test_key.json#${key.id}`,
      key: key.id,
      video: key.video ?? null,
      gameNo: null,
      ...keyRoster(draft.blue, draft.red),
      mapSides: true,
      teams: null,
      side: key.kazewa === "blue" ? "left" : key.kazewa === "red" ? "right" : null,
      confidence: Number(key.kazewa_conf) || 0,
      label: "",
      late: false,
      reasons: [],
      reads: [],
      ts: null,
      bans: [],
      result: key.winner === "blue" ? "left" : key.winner === "red" ? "right" : null,
      date: key.date ?? null,
    });
  }
} catch (error) {
  console.warn("test_key.json ignoré :", error.message);
}
try {
  for (const key of readJson("kb_key/test_key2.json")) {
    const dossier = fs.readFileSync(
      path.join(corpus, "kb", "eval2", "dossiers", `${key.id}.md`),
      "utf8",
    );
    const parse = (label) => {
      const line = new RegExp(`^${label}:\\s*(.+)$`, "m").exec(dossier)?.[1] ?? "";
      const team = {};
      for (const part of line.split(",")) {
        const m = /^\s*(top|jng|mid|bot|sup)\s+(.+?)\s*$/.exec(part);
        if (m) team[m[1]] = m[2];
      }
      return team;
    };
    const match = /^(.*)_g(\d+)$/.exec(key.file ?? "");
    records.push({
      kind: "key2",
      ref: `kb_key/test_key2.json#${key.id}`,
      key: key.id,
      cleanFile: key.file ?? null,
      video: match?.[1] ?? null,
      gameNo: match ? Number(match[2]) : null,
      ...keyRoster(parse("BLUE"), parse("RED")),
      mapSides: true,
      teams: null,
      side: key.kazewa === "blue" ? "left" : key.kazewa === "red" ? "right" : null,
      confidence: Number(key.kconf) || 0,
      label: "",
      late: false,
      reasons: [],
      reads: [],
      ts: null,
      bans: [],
      result: key.win === "blue" ? "left" : key.win === "red" ? "right" : null,
      date: key.date ?? null,
    });
  }
} catch (error) {
  console.warn("test_key2.json ignoré :", error.message);
}

// Reviewed corrections to single extraction records (data/memory-overrides.json).
const overridesPath = path.join(root, "data", "memory-overrides.json");
const overridesFile = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, "utf8"))
  : {};
const overrides = overridesFile.records ?? {};
// A video recorded knowing the results: nothing in it is a draft-time opinion.
const hindsightVideos = new Set(
  Object.entries(overridesFile.videos ?? {})
    .filter(([, value]) => value?.hindsight)
    .map(([video]) => video),
);
for (const record of records)
  if (hindsightVideos.has(record.video)) record.late = true;
const appliedOverrides = [];
for (const record of records) {
  const fix = overrides[record.ref];
  if (!fix) continue;
  appliedOverrides.push(record.ref);
  if (fix.swapScreenSides) {
    [record.left, record.right] = [record.right, record.left];
    if (record.teams)
      record.teams = { left: record.teams.right, right: record.teams.left };
  }
  for (const [slot, name] of Object.entries(fix.picks ?? {})) {
    const [screen, role] = slot.split(".");
    const value = champ(name);
    if (!["left", "right"].includes(screen) || !ROLES.includes(role) || !value)
      throw Error(`Correction invalide pour ${record.ref}: ${slot}`);
    record[screen][role] = value;
  }
  if (fix.side) {
    record.side = fix.side;
    if (fix.side === "even") record.confidence = 0;
    else if (record.confidence < 1) record.confidence = 1;
  }
  if (fix.attachTo) record.attachTo = fix.attachTo;
  // Reviewed link: the record is about this professional game. "leftIs" is the
  // map side of the team the record calls left.
  if (fix.game && fix.attachTo)
    throw Error(`Correction contradictoire pour ${record.ref} : attachTo et game`);
  if (fix.game) {
    if (fix.leftIs != null && !SIDES.includes(fix.leftIs))
      throw Error(`Côté invalide pour ${record.ref}: ${fix.leftIs}`);
    record.forcedGame = { id: fix.game, leftIs: fix.leftIs ?? null };
  }
  // The verdict of this record stands, its label and reasons name the wrong team.
  if (fix.distrustText) record.distrustText = true;
}
const unknownOverrides = Object.keys(overrides).filter(
  (ref) => !appliedOverrides.includes(ref),
);
if (unknownOverrides.length)
  throw Error("Corrections sans enregistrement : " + unknownOverrides.join(", "));

for (const record of records) {
  record.known = knownPicks(record);
  const names = record.known.map((p) => p.champion);
  record.complete =
    record.known.length === 10 && new Set(names).size === 10;
}

/* ------------------------------------------------------------------ */
/* 2. Professional match index                                         */
/* ------------------------------------------------------------------ */
let oe = [];
if (fs.existsSync(oePath)) {
  oe = JSON.parse(fs.readFileSync(oePath, "utf8"));
  for (const game of oe)
    for (const side of SIDES)
      for (const role of ROLES) game[side][role] = champ(game[side][role]);
  oe = oe.filter((g) => SIDES.every((s) => ROLES.every((r) => g[s][r])));
} else if (process.argv.includes("--allow-unverified"))
  console.warn(`Index de matchs absent (${oePath}) : rosters non vérifiés.`);
else
  throw Error(
    `Index de matchs absent (${oePath}). Lancer npm run oe:index, ou passer --allow-unverified pour écraser la mémoire sans vérification.`,
  );
const byChampion = new Map();
oe.forEach((game, index) => {
  for (const side of SIDES)
    for (const role of ROLES) {
      const name = game[side][role];
      if (!byChampion.has(name)) byChampion.set(name, []);
      byChampion.get(name).push(index * 2 + (side === "blue" ? 0 : 1));
    }
});
const rosterKey = (blue, red) => {
  const a = ROLES.map((r) => blue[r]).join("|");
  const b = ROLES.map((r) => red[r]).join("|");
  return [a, b].sort().join("//");
};

/** Side-consistent champion overlap between a record and a roster. */
function overlap(record, blue, red) {
  const sets = {
    blue: new Set(ROLES.map((r) => blue[r])),
    red: new Set(ROLES.map((r) => red[r])),
  };
  const result = {};
  for (const leftIs of SIDES) {
    let hits = 0;
    let roleHits = 0;
    for (const pick of record.known) {
      const side = pick.screen === "left" ? leftIs : flip(leftIs);
      const team = side === "blue" ? blue : red;
      if (sets[side].has(pick.champion)) hits++;
      if (team[pick.role] === pick.champion) roleHits++;
    }
    result[leftIs] = { hits, roleHits };
  }
  return result;
}

function matchOe(record) {
  const known = record.known.length;
  if (known < 6 || !oe.length) return null;
  const hits = new Map();
  for (const pick of record.known) {
    for (const code of byChampion.get(pick.champion) ?? []) {
      const index = code >> 1;
      const side = code & 1 ? "red" : "blue";
      // Champion on `side`: consistent with left=side when the pick is on the left.
      const leftIs = pick.screen === "left" ? side : flip(side);
      const key = index * 2 + (leftIs === "blue" ? 0 : 1);
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
  }
  let best = null;
  let second = 0;
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of ranked) {
    const game = oe[key >> 1];
    const leftIs = key & 1 ? "red" : "blue";
    if (!best) {
      best = { game, leftIs, hits: count };
      continue;
    }
    // Rematches with the exact same ten champions are not competitors.
    const sameRoster =
      rosterKey(game.blue, game.red) === rosterKey(best.game.blue, best.game.red);
    if (sameRoster && count === best.hits) {
      const sameOrientation =
        ROLES.every((r) => game.blue[r] === best.game.blue[r]) === (leftIs === best.leftIs);
      if (sameOrientation) {
        best.twins = [...(best.twins ?? []), game];
        continue;
      }
    }
    second = count;
    break;
  }
  if (!best) return null;
  const tolerated = known >= 8 ? 1 : 0;
  if (best.hits < known - tolerated) return null;
  const exact = record.complete && best.hits === known;
  if (best.hits - second < (exact ? 1 : 2)) return null;
  // Answer keys already use map sides: a flipped match would be a contradiction.
  if (record.mapSides && best.leftIs !== "blue") return null;
  const mismatches = record.known
    .filter((pick) => {
      const side = pick.screen === "left" ? best.leftIs : flip(best.leftIs);
      return best.game[side][pick.role] !== pick.champion;
    })
    .map((pick) => {
      const side = pick.screen === "left" ? best.leftIs : flip(best.leftIs);
      return `${pick.screen}.${pick.role}: ${pick.champion} → ${best.game[side][pick.role]}`;
    });
  return { ...best, mismatches };
}

/* ------------------------------------------------------------------ */
/* 3. Cases                                                            */
/* ------------------------------------------------------------------ */
const cases = new Map();
const audit = {
  records: {},
  oeMatched: 0,
  oeRejected: 0,
  attachedWithinVideo: 0,
  ownRoster: 0,
  unresolved: [],
  rosterCorrections: [],
  teamNameMismatches: [],
};
const caseFor = (id, init) => {
  if (!cases.has(id)) cases.set(id, { id, observations: [], ...init });
  return cases.get(id);
};
const observe = (target, record, leftIs, how) => {
  target.observations.push({ record, leftIs, how });
  record.caseId = target.id;
  record.leftIs = leftIs;
  record.how = how;
};
const teamAlike = (name, official) => {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = fold(name);
  const b = fold(official);
  if (!a || !b) return null;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const acronym = String(official)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
  if (acronym === a || (a.length >= 2 && acronym.startsWith(a))) return true;
  return false;
};

for (const record of records) {
  audit.records[record.kind] = (audit.records[record.kind] ?? 0) + 1;
  if (record.attachTo || record.forcedGame) continue;
  const match = matchOe(record);
  if (!match) continue;
  const { game } = match;
  const target = caseFor(`oe:${game.id}`, {
    blue: game.blue,
    red: game.red,
    oe: game,
    twins: match.twins ?? [],
  });
  observe(target, record, match.leftIs, "oe");
  audit.oeMatched++;
  if (match.mismatches.length)
    audit.rosterCorrections.push({ source: record.ref, corrections: match.mismatches });
  if (record.teams) {
    const left = teamAlike(record.teams.left, game.teams[match.leftIs]);
    const right = teamAlike(record.teams.right, game.teams[flip(match.leftIs)]);
    if (left === false && right === false)
      audit.teamNameMismatches.push({
        source: record.ref,
        said: record.teams,
        match: game.teams,
        leftIs: match.leftIs,
      });
  }
}

// Reviewed links (data/memory-overrides.json): too few picks were recognised
// for an automatic match, a reviewer named the game from the video itself and
// two independent checks agreed. The compositions come from the match data.
const oeById = new Map(oe.map((game) => [game.id, game]));
audit.reviewedLinks = 0;
audit.reviewedLinkMismatches = [];
audit.reviewedLinkTextSetAside = [];
for (const record of records) {
  if (!record.forcedGame) continue;
  const game = oeById.get(record.forcedGame.id);
  if (!game) throw Error(`Partie inconnue pour ${record.ref}: ${record.forcedGame.id}`);
  const stated = ["left", "right"].includes(record.side) && record.confidence >= 1;
  if (!record.forcedGame.leftIs && (stated || record.result))
    throw Error(`Lien sans côté pour un enregistrement qui en dépend : ${record.ref}`);
  const both = overlap(record, game.blue, game.red);
  // No preference stated: the side is only used to place the record's picks.
  const leftIs =
    record.forcedGame.leftIs ?? (both.red.hits > both.blue.hits ? "red" : "blue");
  // An automatic match may hold this game together with a rematch that used
  // the same ten champions. A reviewer named the game: that settles it when the
  // case was opened on that game; the other way round is not handled.
  for (const other of cases.values())
    if (other.twins?.some((twin) => twin.id === game.id))
      throw Error(`Lien vers une partie jumelle d’un autre cas : ${record.ref}`);
  const target = caseFor(`oe:${game.id}`, {
    blue: game.blue,
    red: game.red,
    oe: game,
    twins: [],
  });
  target.twins = [];
  observe(target, record, leftIs, "reviewed_game");
  audit.reviewedLinks++;
  // Two picks or more written on the wrong team: the extraction mixed the two
  // compositions. Its verdict was checked against the team he names; its
  // label, reasons and reads are left to another record of the same game.
  if (both[flip(leftIs)].hits >= 2 && !record.distrustText) {
    record.distrustText = true;
    // Mixed, not contradicted: still better than a text a reviewer set aside.
    record.mixedText = true;
    audit.reviewedLinkTextSetAside.push(record.ref);
  }
  if (both[leftIs].hits < record.known.length)
    audit.reviewedLinkMismatches.push({
      source: record.ref,
      known: record.known.length,
      onStatedSide: both[leftIs].hits,
      onOtherSide: both[flip(leftIs)].hits,
    });
}

// Second pass: a video already tied to a professional series. A partial record
// of the same video is searched only among that series' games, where a few
// known picks are enough to single out one game.
const pairKey = (game) => [game.teams.blue, game.teams.red].sort().join("~");
const byPair = new Map();
for (const game of oe) {
  const key = pairKey(game);
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(game);
}
const dayOf = (game) => Date.parse(game.date.slice(0, 10) + "T00:00:00Z") / 86400000;
function seriesGames(video) {
  const pool = new Map();
  for (const item of cases.values()) {
    if (!item.oe) continue;
    if (!item.observations.some((o) => o.record.video === video)) continue;
    for (const game of byPair.get(pairKey(item.oe)) ?? [])
      if (Math.abs(dayOf(game) - dayOf(item.oe)) <= 1) pool.set(game.id, game);
  }
  return [...pool.values()];
}
audit.matchedWithinSeries = 0;
for (const record of records) {
  if (record.caseId || !record.video || record.mapSides || record.attachTo) continue;
  const known = record.known.length;
  if (known < 3) continue;
  const ranked = [];
  for (const game of seriesGames(record.video)) {
    const both = overlap(record, game.blue, game.red);
    for (const leftIs of SIDES) ranked.push({ game, leftIs, ...both[leftIs] });
  }
  ranked.sort((a, b) => b.hits - a.hits || b.roleHits - a.roleHits);
  const best = ranked[0];
  if (!best) continue;
  const second = ranked.find((r) => r !== best)?.hits ?? 0;
  const tolerated = known >= 6 ? 1 : 0;
  if (best.hits < Math.max(3, known - tolerated) || best.hits - second < 2) continue;
  const target = caseFor(`oe:${best.game.id}`, {
    blue: best.game.blue,
    red: best.game.red,
    oe: best.game,
    twins: [],
  });
  observe(target, record, best.leftIs, "series");
  audit.matchedWithinSeries++;
  const corrections = record.known
    .filter((pick) => {
      const side = pick.screen === "left" ? best.leftIs : flip(best.leftIs);
      return best.game[side][pick.role] !== pick.champion;
    })
    .map((pick) => {
      const side = pick.screen === "left" ? best.leftIs : flip(best.leftIs);
      return `${pick.screen}.${pick.role}: ${pick.champion} → ${best.game[side][pick.role]}`;
    });
  if (corrections.length)
    audit.rosterCorrections.push({ source: record.ref, corrections });
}

// Remaining records can only be attached inside their own video.
const videoCases = (video) =>
  [...cases.values()].filter((c) =>
    c.observations.some((o) => o.record.video && o.record.video === video),
  );
function attach(record) {
  const known = record.known.length;
  if (known < 5 || !record.video) return false;
  const ranked = [];
  for (const candidate of videoCases(record.video)) {
    const both = overlap(record, candidate.blue, candidate.red);
    for (const leftIs of SIDES)
      ranked.push({ candidate, leftIs, ...both[leftIs] });
  }
  ranked.sort((a, b) => b.hits - a.hits || b.roleHits - a.roleHits);
  const best = ranked[0];
  if (!best) return false;
  const second = ranked[1]?.hits ?? 0;
  const tolerated = record.complete && best.candidate.oe ? 2 : known >= 8 ? 1 : 0;
  if (best.hits < known - tolerated || best.hits - second < 2) return false;
  if (record.mapSides && best.candidate.oe && best.leftIs !== "blue") return false;
  observe(best.candidate, record, best.leftIs, "video");
  audit.attachedWithinVideo++;
  return true;
}
const pending = records.filter((r) => !r.caseId && !r.attachTo);
const order = { key2: 0, key1: 1, raw: 2, clean: 3 };
pending.sort(
  (a, b) => Number(b.complete) - Number(a.complete) || order[a.kind] - order[b.kind],
);
for (const record of pending) {
  if (attach(record)) continue;
  if (record.complete) {
    const blue = record.left;
    const red = record.right;
    const target = caseFor(`fp:${rosterKey(blue, red)}`, {
      blue: { ...blue },
      red: { ...red },
      oe: null,
      twins: [],
    });
    // An existing fingerprint case may be stored in the other orientation.
    const leftIs = ROLES.every((r) => target.blue[r] === blue[r]) ? "blue" : "red";
    observe(target, record, leftIs, "own");
    audit.ownRoster++;
  } else
    audit.unresolved.push({
      source: record.ref,
      known: record.known.length,
      stated: ["left", "right"].includes(record.side) && record.confidence >= 1,
    });
}

// Reviewed attachments: the record joins the case of another record.
audit.forcedAttachments = 0;
for (const record of records) {
  if (!record.attachTo) continue;
  const anchor = records.find((r) => r.ref === record.attachTo);
  const target = anchor?.caseId ? cases.get(anchor.caseId) : null;
  if (!target) throw Error(`Rattachement impossible : ${record.ref} -> ${record.attachTo}`);
  const both = overlap(record, target.blue, target.red);
  const leftIs = both.blue.hits >= both.red.hits ? "blue" : "red";
  observe(target, record, leftIs, "reviewed");
  audit.forcedAttachments++;
}

/* ------------------------------------------------------------------ */
/* 4. Verdict per case                                                 */
/* ------------------------------------------------------------------ */
const RANK = { clean: 3, key2: 3, raw: 2, key1: 2 };
const TIMING = { 3: "draft", 2: "review", 1: "late" };
const sideOf = (observation, screen) =>
  screen === "left" ? observation.leftIs : flip(observation.leftIs);
const out = [];
const conflicts = [];
// Standard pick sequence: 1 / 2-3 / 4-5 / 6 ... 7 / 8-9 / 10.
const FIRST_SLOTS = [1, 4, 5, 8, 9];
const SECOND_SLOTS = [2, 3, 6, 7, 10];
for (const item of cases.values()) {
  const views = item.observations.map((o) => {
    const { record } = o;
    const stated = ["left", "right"].includes(record.side) && record.confidence >= 1;
    const rank = record.late ? 1 : RANK[record.kind];
    return {
      o,
      record,
      rank,
      side: stated ? sideOf(o, record.side) : "even",
      stated,
    };
  });
  // Key 2 repeats a draft-phase extraction: it supports, it does not add a vote.
  const voters = views.filter(
    (v) => !(v.record.kind === "key2" && views.some((w) => w.record.kind === "clean")),
  );
  let verdict = { side: "even", confidence: 0, timing: null, label: "" };
  let primary = null;
  let conflict = false;
  for (const rank of [3, 2, 1]) {
    const tier = voters.filter((v) => v.rank === rank && v.stated);
    if (!tier.length) continue;
    const tally = { blue: 0, red: 0 };
    for (const v of tier) tally[v.side] += 1;
    if (tally.blue === tally.red) {
      conflict = true;
      conflicts.push({
        id: item.id,
        tier: TIMING[rank],
        sources: tier.map((v) => `${v.record.ref}=${v.side}`),
      });
      break;
    }
    const side = tally.blue > tally.red ? "blue" : "red";
    const agreeing = tier.filter((v) => v.side === side);
    // Prefer the record that explains itself.
    primary =
      agreeing.find((v) => v.record.reasons.length && v.record.kind === "clean" && !v.record.distrustText) ??
      agreeing.find((v) => v.record.reasons.length && !v.record.distrustText) ??
      agreeing[0];
    verdict = {
      side,
      confidence: Math.max(...agreeing.map((v) => v.record.confidence)),
      timing: TIMING[rank],
      label: primary.record.label,
    };
    break;
  }
  // The record that carries the verdict may be a bare answer key. His reasons
  // then come from the best record of the same game that agrees with it.
  if (primary && (!primary.record.reasons.length || primary.record.distrustText)) {
    const explains = (v) =>
      v.record.reasons.length &&
      (verdict.side === "even" || !v.stated || v.side === verdict.side);
    // A record whose picks are only mixed keeps its own text unless another
    // record states the same side, and not after the game was over.
    const sameVerdict = (v) =>
      explains(v) && v.rank >= 2 && (verdict.side === "even" || (v.stated && v.side === verdict.side));
    const explained = primary.record.mixedText
      ? views.filter((v) => sameVerdict(v) && !v.record.distrustText).sort((a, b) => b.rank - a.rank)[0]
      : (views
          .filter((v) => explains(v) && !v.record.distrustText)
          .sort((a, b) => b.rank - a.rank)[0] ??
        // Nothing clean: a text whose picks are mixed, rather than one a
        // reviewer set aside because it names the wrong team.
        views.filter((v) => explains(v) && v.record.mixedText).sort((a, b) => b.rank - a.rank)[0]);
    if (explained) {
      // The headline of a verdict is not taken from a record that gives none.
      const carriesVerdict = verdict.side === "even" || explained.stated;
      if (primary.record.distrustText) verdict.label = carriesVerdict ? explained.record.label : "";
      else if (!verdict.label && carriesVerdict) verdict.label = explained.record.label;
      primary = explained;
    }
  }
  const draftPhaseUndecided =
    verdict.timing !== "draft" &&
    views.some((v) => v.rank === 3 && !v.stated && v.o.how !== "reviewed_game");
  if (!primary)
    primary =
      views.find((v) => v.record.kind === "clean" && v.record.reasons.length) ??
      views.find((v) => v.record.reasons.length) ??
      views[0];
  const disagreements = views
    .filter((v) => v.stated && verdict.side !== "even" && v.side !== verdict.side)
    .map((v) => ({ timing: TIMING[v.rank], side: v.side, source: v.record.ref }));

  const blueSet = new Set(ROLES.map((r) => item.blue[r]));
  const redSet = new Set(ROLES.map((r) => item.red[r]));
  const reads = [];
  const seenRead = new Set();
  for (const v of [primary, ...views.filter((x) => x !== primary)]) {
    if (v.record.distrustText) continue;
    for (const read of v.record.reads ?? []) {
      const name = champ(read.champion);
      const text = cleanText(read.read);
      if (!name || !text || seenRead.has(name)) continue;
      const side = blueSet.has(name) ? "blue" : redSet.has(name) ? "red" : null;
      if (!side) continue;
      seenRead.add(name);
      reads.push({ champion: name, side, read: text, timing: TIMING[v.rank] });
    }
  }
  const videos = [
    ...new Set(item.observations.map((o) => o.record.video).filter(Boolean)),
  ];
  const sources = videos.map((video) => {
    const own = views.filter((v) => v.record.video === video);
    const ts = own.map((v) => v.record.ts).find((n) => Number.isFinite(n)) ?? null;
    return { video, title: videoTitles.get(video) ?? null, ts };
  });
  // Result: professional data first, then what the review states.
  let winner = item.oe && !item.twins.length ? item.oe.winner : null;
  let winnerSource = winner ? "match_data" : null;
  if (!winner) {
    const said = new Set(
      views
        .filter((v) => v.record.result)
        .map((v) => sideOf(v.o, v.record.result)),
    );
    if (said.size === 1) {
      winner = [...said][0];
      winnerSource = "review";
    }
  }
  const rawTeams = views.find((v) => v.record.teams?.left && v.record.teams?.right);
  const teams = item.oe
    ? { blue: item.oe.teams.blue ?? null, red: item.oe.teams.red ?? null }
    : rawTeams
      ? {
          blue: rawTeams.record.teams[rawTeams.o.leftIs === "blue" ? "left" : "right"],
          red: rawTeams.record.teams[rawTeams.o.leftIs === "blue" ? "right" : "left"],
        }
      : null;
  const fingerprint = rosterKey(item.blue, item.red);
  // Who answered whom: for each lane, the side that locked its champion later.
  let later = null;
  if (item.oe && !item.twins.length && item.oe.order?.blue && item.oe.order?.red) {
    const first = item.oe.firstPick ?? "blue";
    const slot = (side, champion) => {
      const index = item.oe.order[side].map(champ).indexOf(champion);
      return index < 0 ? null : (side === first ? FIRST_SLOTS : SECOND_SLOTS)[index];
    };
    const lanes = {};
    for (const role of ROLES) {
      const b = slot("blue", item.blue[role]);
      const r = slot("red", item.red[role]);
      if (b && r) lanes[role] = b > r ? "blue" : "red";
    }
    if (Object.keys(lanes).length === 5) later = lanes;
  }
  out.push({
    id: "kz_" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 12),
    blue: item.blue,
    red: item.red,
    sides: item.oe ? "map" : "screen",
    rosterVerified: Boolean(item.oe),
    later,
    verdict: { ...verdict, conflict, draftPhaseUndecided },
    reasons: primary?.record.reasons ?? [],
    reads,
    disagreements,
    winner,
    winnerSource,
    match: item.oe
      ? {
          teams,
          gameId: item.twins.length ? null : item.oe.id,
          date: item.twins.length ? null : item.oe.date.slice(0, 10),
          league: item.oe.league,
          patch: item.oe.patch,
          game: item.twins.length ? null : item.oe.game,
          firstPick: item.twins.length ? null : item.oe.firstPick,
          order: item.twins.length ? null : item.oe.order,
          bans: item.twins.length ? null : item.oe.bans,
        }
      : teams
        ? { teams, date: null, league: null, patch: null, game: null }
        : null,
    sources,
    evidence: views.map((v) => ({
      source: v.record.ref,
      kind: v.record.kind,
      via: v.o.how,
      side: v.side,
      confidence: v.record.confidence,
      timing: TIMING[v.rank],
    })),
    fingerprint,
  });
}

// Two cases with the same ten champions are one draft for a lookup.
const byFingerprint = new Map();
for (const item of out) {
  const list = byFingerprint.get(item.fingerprint) ?? [];
  list.push(item);
  byFingerprint.set(item.fingerprint, list);
}
const duplicates = [...byFingerprint.values()].filter((l) => l.length > 1);
// Two cases of one video with eight champions in common on the same sides:
// most likely one game heard twice. Listed for review, never merged silently.
const nearDuplicates = [];
const replayedDrafts = [];
const recordByRef = new Map(records.map((record) => [record.ref, record]));
for (let i = 0; i < out.length; i++)
  for (let j = i + 1; j < out.length; j++) {
    const a = out[i];
    const b = out[j];
    if (!a.sources.some((s) => b.sources.some((t) => t.video === s.video))) continue;
    const shared = (x, y) => ROLES.filter((r) => ROLES.some((q) => y[q] === x[r])).length;
    const straight = shared(a.blue, b.blue) + shared(a.red, b.red);
    const crossed = shared(a.blue, b.red) + shared(a.red, b.blue);
    const twoGames =
      a.match?.gameId && b.match?.gameId && a.match.gameId !== b.match.gameId;
    // Nine champions in common whatever the side, and at most one of the two
    // tied to a game: one game, written once with two lanes exchanged.
    const everyone = (x) => [...ROLES.map((r) => x.blue[r]), ...ROLES.map((r) => x.red[r])];
    const inCommon = everyone(a).filter((name) => everyone(b).includes(name)).length;
    if (!twoGames && inCommon >= 9 && Math.max(straight, crossed) < 8) {
      nearDuplicates.push({ cases: [a.id, b.id], shared: inCommon, sidesMixed: true, bothVerified: false });
      continue;
    }
    if (Math.max(straight, crossed) < 8) continue;
    const pair = { cases: [a.id, b.id], shared: Math.max(straight, crossed) };
    // Two games of the match index with nearly the same draft: a team that
    // replays its draft. Only when a record of each case names a champion its
    // game has and the other game has not; otherwise it stays a suspect.
    const told = (mine, other) =>
      mine.evidence.some((entry) =>
        (recordByRef.get(entry.source)?.known ?? []).some(
          (pick) => everyone(mine).includes(pick.champion) && !everyone(other).includes(pick.champion),
        ),
      );
    if (twoGames && told(a, b) && told(b, a))
      replayedDrafts.push({ ...pair, games: [a.match.gameId, b.match.gameId] });
    else nearDuplicates.push({ ...pair, bothVerified: a.rosterVerified && b.rosterVerified });
  }

// Leakage groups: cases linked by a shared video or a shared series.
const parent = new Map();
const find = (x) => {
  if (!parent.has(x)) parent.set(x, x);
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)));
    x = parent.get(x);
  }
  return x;
};
const union = (a, b) => parent.set(find(a), find(b));
for (const item of out) {
  const tokens = item.sources.map((s) => "v:" + s.video);
  if (item.match?.date && item.match.teams?.blue)
    tokens.push(
      "s:" + item.match.date + ":" + [item.match.teams.blue, item.match.teams.red].sort().join("~"),
    );
  tokens.push("c:" + item.id);
  for (const token of tokens) union(tokens[0], token);
}
for (const item of out) {
  const token = item.sources[0] ? "v:" + item.sources[0].video : "c:" + item.id;
  item.group = createHash("sha256").update(find(token)).digest("hex").slice(0, 10);
}

out.sort((a, b) => a.id.localeCompare(b.id));
const enrichmentPath = path.join(root, "data", "kazewa-enrichment.json");
const enrichment = fs.existsSync(enrichmentPath)
  ? JSON.parse(fs.readFileSync(enrichmentPath, "utf8"))
  : {};
let enriched = 0;
let staleEnrichment = 0;
// A translation and its arguments say "blue" and "red": they hold only for the
// exact text, the exact rosters and the exact verdict the translator was given.
const contextOf = (item) =>
  JSON.stringify({
    reasons: item.reasons,
    reads: item.reads.map((r) => r.read),
    blue: ROLES.map((role) => item.blue[role]),
    red: ROLES.map((role) => item.red[role]),
    side: item.verdict.side,
  });
const storedContext = (value) =>
  JSON.stringify({
    reasons: value.of?.reasons ?? [],
    reads: value.of?.reads ?? [],
    blue: value.of?.blue ?? null,
    red: value.of?.red ?? null,
    side: value.of?.side ?? null,
  });
const enrichmentByContext = new Map(
  Object.values(enrichment).map((value) => [storedContext(value), value]),
);
for (const item of out) {
  const byId = enrichment[item.id];
  const extra =
    byId && storedContext(byId) === contextOf(item)
      ? byId
      : (enrichmentByContext.get(contextOf(item)) ?? byId);
  if (!extra) continue;
  const same = storedContext(extra) === contextOf(item);
  if (!same) {
    staleEnrichment++;
    continue;
  }
  enriched++;
  if (extra.labelFr) item.labelFr = extra.labelFr;
  if (extra.reasonsFr) item.reasonsFr = extra.reasonsFr;
  if (extra.readsFr) item.reads.forEach((read, i) => (read.readFr = extra.readsFr[i]));
  const roster = new Set(
    SIDES.flatMap((side) => ROLES.map((role) => item[side][role])),
  );
  item.claims = (extra.claims ?? []).map((claim) => ({
    ...claim,
    champions: claim.champions.filter((name) => roster.has(name)),
  }));
}
const decided = out.filter((c) => c.verdict.side !== "even");
const summary = {
  cases: out.length,
  decided: decided.length,
  undecided: out.length - decided.length,
  byTiming: Object.fromEntries(
    ["draft", "review", "late"].map((t) => [
      t,
      decided.filter((c) => c.verdict.timing === t).length,
    ]),
  ),
  rosterVerified: out.filter((c) => c.rosterVerified).length,
  decidedRosterVerified: decided.filter((c) => c.rosterVerified).length,
  videos: new Set(out.flatMap((c) => c.sources.map((s) => s.video))).size,
  groups: new Set(out.map((c) => c.group)).size,
  withKnownWinner: out.filter((c) => c.winner).length,
  labelConflicts: conflicts.length,
  duplicateFingerprints: duplicates.length,
};
const memory = {
  version: "2.0.0",
  design:
    "One entry per real game Kazewa commented. Rosters matched to professional match data when the game is in the local mirror; the verdict keeps the earliest reliable timing tier (draft phase, then review, then explicitly late opinion).",
  summary,
  audit: {
    records: audit.records,
    matchedToMatchData: audit.oeMatched,
    matchedWithinSeries: audit.matchedWithinSeries,
    reviewedCorrections: appliedOverrides.length,
    reviewedLinks: audit.reviewedLinks,
    reviewedLinkMismatches: audit.reviewedLinkMismatches,
    reviewedLinkTextSetAside: audit.reviewedLinkTextSetAside,
    attachedWithinVideo: audit.attachedWithinVideo,
    keptOwnCompleteRoster: audit.ownRoster,
    unresolvedRecords: audit.unresolved.length,
    unresolvedWithStatedPreference: audit.unresolved.filter((u) => u.stated).length,
    rosterCorrections: audit.rosterCorrections.length,
    teamNameMismatches: audit.teamNameMismatches,
    conflicts,
    duplicateFingerprints: duplicates.map((l) => l.map((c) => c.id)),
    nearDuplicates,
    replayedDrafts,
  },
  cases: out,
};
fs.writeFileSync(
  path.join(root, "data", "kazewa-memory.json"),
  JSON.stringify(memory, null, 1) + "\n",
);
// Notes the extraction step left about the transcript or the screen layout.
const ANNOTATION = /^(side )?note\b|transcript|\bASR\b|header|on[- ]screen|screen side|his screen|by screen|garbled/i;
const spokenReasons = (c) => {
  const texts = c.reasonsFr ?? c.reasons;
  return texts.filter((_, i) => !ANNOTATION.test(c.reasons[i] ?? ""));
};
// An argument reused on another draft must not name the teams, the players or
// the map side of the game it came from.
const teamWords = new Set();
for (const record of records)
  for (const name of [record.teams?.left, record.teams?.right])
    if (name && name.length >= 2) teamWords.add(name.toLowerCase());
for (const game of oe)
  for (const name of [game.teams.blue, game.teams.red]) {
    if (!name) continue;
    teamWords.add(name.toLowerCase());
  }
const usedTeams = new Set();
for (const item of out)
  for (const name of [item.match?.teams?.blue, item.match?.teams?.red])
    if (name) {
      usedTeams.add(name.toLowerCase());
      for (const word of name.split(/\s+/)) if (word.length >= 3) usedTeams.add(word.toLowerCase());
    }
const SHORT_TEAMS = ["g2", "t1", "kc", "kcorp", "hle", "geng", "gen.g", "blg", "dk", "kt", "fnc", "fnatic", "tes", "jdg", "wbg", "lng", "bds", "sk", "mad", "th", "gx", "vit", "c9", "tl", "fly", "cfo", "al", "ig", "fpx", "drx", "edg", "rng", "nip", "psg", "gam", "mkoi", "koi", "heretics", "karmine", "damwon", "dwg", "liquid", "rogue", "astralis", "excel", "giants", "ns", "bro", "kdf", "dns"];
const champWords = new Set(Object.keys(knowledge.champions).flatMap((n) => n.toLowerCase().split(/[^a-z0-9']+/)));
const namesContext = (text) => {
  const lower = text.toLowerCase();
  if (/c[oô]t[eé] (bleu|rouge)|blue side|red side|\b(gauche|droite)\b|\b(left|right)\b/.test(lower)) return true;
  const words = lower.split(/[^a-z0-9.']+/).filter(Boolean);
  for (const word of words) {
    if (champWords.has(word)) continue;
    if (SHORT_TEAMS.includes(word) || (usedTeams.has(word) && word.length >= 4)) return true;
  }
  return false;
};
// What the site loads: verdicts in French, no audit trail.
const site = {
  version: memory.version,
  summary,
  cases: out.map((c) => ({
    id: c.id,
    blue: c.blue,
    red: c.red,
    sides: c.sides,
    rosterVerified: c.rosterVerified,
    later: c.later,
    verdict: {
      side: c.verdict.side,
      confidence: c.verdict.confidence,
      timing: c.verdict.timing,
      label: c.labelFr || c.verdict.label,
      conflict: c.verdict.conflict,
      draftPhaseUndecided: c.verdict.draftPhaseUndecided,
    },
    reasons: spokenReasons(c),
    reads: c.reads.map((r) => ({ champion: r.champion, side: r.side, read: r.readFr ?? r.read })),
    claims: (c.claims ?? [])
      .filter(
        (claim) =>
          claim.transferable &&
          claim.champions.length >= 2 &&
          !namesContext(claim.detailFr),
      )
      .map((claim) => ({
        tag: claim.tag,
        favours: claim.favours,
        champions: claim.champions,
        role: claim.role,
        transferable: true,
        detail: claim.detailFr,
      })),
    disagreements: c.disagreements.map((d) => ({ timing: d.timing, side: d.side })),
    winner: c.winner,
    winnerSource: c.winnerSource,
    match: c.match
      ? {
          teams: c.match.teams ?? null,
          date: c.match.date ?? null,
          league: c.match.league ?? null,
          patch: c.match.patch ?? null,
          game: c.match.game ?? null,
        }
      : null,
    sources: c.sources,
    fingerprint: c.fingerprint,
  })),
};
fs.writeFileSync(
  path.join(root, "data", "memory-site.json"),
  JSON.stringify(site) + "\n",
);
console.log(`Enrichissement français : ${enriched} cas (${staleEnrichment} périmés ignorés)`);
fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
// Raw extraction records with how each was attached, for audits.
const caseIdOf = new Map(
  [...cases.values()].map((item) => [
    item.id,
    "kz_" +
      createHash("sha256")
        .update(rosterKey(item.blue, item.red))
        .digest("hex")
        .slice(0, 12),
  ]),
);
fs.writeFileSync(
  path.join(root, ".cache", "memory-records.json"),
  JSON.stringify(
    records.map((r) => ({
      ref: r.ref,
      kind: r.kind,
      video: r.video,
      gameNo: r.gameNo,
      left: r.left,
      right: r.right,
      teams: r.teams,
      side: r.side,
      confidence: r.confidence,
      label: r.label,
      late: r.late,
      reasons: r.reasons,
      reads: (r.reads ?? []).map((x) => ({ champion: x.champion, comp: x.comp, read: x.read })),
      result: r.result,
      context: r.context ?? null,
      caseId: r.caseId ? caseIdOf.get(r.caseId) : null,
      internalCase: r.caseId ?? null,
      leftIs: r.leftIs ?? null,
      how: r.how ?? null,
    })),
  ),
);
fs.writeFileSync(
  path.join(root, ".cache", "memory-audit.json"),
  JSON.stringify(
    { unresolved: audit.unresolved, rosterCorrections: audit.rosterCorrections },
    null,
    1,
  ),
);
console.log(JSON.stringify(summary, null, 1));
console.log(
  `Enregistrements : ${JSON.stringify(audit.records)} ; reliés aux matchs : ${audit.oeMatched} (+${audit.matchedWithinSeries} par série) ; rattachés dans la vidéo : ${audit.attachedWithinVideo} ; roster propre : ${audit.ownRoster} ; non résolus : ${audit.unresolved.length} (dont ${audit.unresolved.filter((u) => u.stated).length} avec avis)`,
);
console.log(`Quasi-doublons dans une même vidéo : ${nearDuplicates.length} ${JSON.stringify(nearDuplicates)}`);
console.log(`Corrections de roster : ${audit.rosterCorrections.length} ; noms d’équipes discordants : ${audit.teamNameMismatches.length} ; conflits : ${conflicts.length}`);
