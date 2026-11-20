/**
 * Builds data/coach.json, what the draft coach reads besides the memory:
 *
 *   meta   how professional teams drafted in the last weeks of the match
 *          index: picks per role, bans, the stage of the draft where each
 *          champion is locked, and the role locked at each of the ten picks;
 *   notes  what Kazewa said about picking a champion: blind or counter-pick,
 *          first-pick value, strong or weak in the meta of the day. Each note
 *          keeps its date: it was said about one draft, on one patch.
 *
 *   node scripts/build-coach-data.mjs [--oe <index.json>] [--days 60]
 *
 * Source of `meta`: .cache/oe-games.json (scripts/build-oe-index.mjs, from the
 * Oracle's Elixir match data). Source of `notes`: data/kazewa-memory.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChampion, ROLES } from "../src/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const knowledge = read("data/knowledge.json");
const name = (value) => (typeof value === "string" ? normalizeChampion(value, knowledge) : null);
const days = Number(arg("--days", "60"));
// Academy series: not the professional meta, and a quarter of the recent games.
const ACADEMY = new Set(["LAS", "LCKC", "WSCI", "ASCI"]);

/* ------------------------------ professional play ------------------------------ */
const games = JSON.parse(fs.readFileSync(path.resolve(root, arg("--oe", ".cache/oe-games.json")), "utf8"))
  .filter(
    (game) =>
      game.date &&
      !ACADEMY.has(game.league) &&
      game.firstPick &&
      game.order?.blue?.filter(Boolean).length === 5 &&
      game.order?.red?.filter(Boolean).length === 5,
  )
  .sort((a, b) => a.date.localeCompare(b.date));
if (!games.length) throw Error("Aucune partie avec ordre de picks dans l’index.");
const last = games[games.length - 1].date.slice(0, 10);
const since = new Date(Date.parse(last) - days * 86400000).toISOString().slice(0, 10);
// Pick 1 to 10: first-pick team, then the other one twice, and so on.
const ORDER = ["F", "S", "S", "F", "F", "S", "S", "F", "F", "S"];
const INDEX = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const meta = {
  from: null,
  to: last,
  days,
  games: 0,
  patches: [],
  picks: {},
  bans: {},
  stages: {},
  slots: Array.from({ length: 10 }, () => Object.fromEntries(ROLES.map((role) => [role, 0]))),
};
const patches = new Set();
const leagues = {};
for (const game of games) {
  const date = game.date.slice(0, 10);
  if (date <= since) continue;
  const side = { F: game.firstPick, S: game.firstPick === "blue" ? "red" : "blue" };
  const roleOf = {};
  for (const team of ["blue", "red"])
    roleOf[team] = new Map(ROLES.map((role) => [name(game[team][role]), role]));
  const sequence = ORDER.map((who, slot) => {
    const champion = name(game.order[side[who]][INDEX[slot]]);
    return { champion, role: roleOf[side[who]].get(champion) ?? null };
  });
  // A record whose pick order names other champions than its rosters is damaged.
  if (sequence.some((pick) => !pick.champion || !pick.role)) continue;
  meta.games++;
  leagues[game.league] = (leagues[game.league] ?? 0) + 1;
  if (!meta.from || date < meta.from) meta.from = date;
  if (game.patch) patches.add(String(game.patch));
  sequence.forEach(({ champion, role }, slot) => {
    meta.picks[champion] ??= {};
    meta.picks[champion][role] = (meta.picks[champion][role] ?? 0) + 1;
    meta.slots[slot][role] += 1;
    meta.stages[champion] ??= [0, 0, 0];
    meta.stages[champion][slot < 3 ? 0 : slot < 6 ? 1 : 2] += 1;
  });
  for (const team of ["blue", "red"])
    for (const banned of new Set((game.bans?.[team] ?? []).map(name).filter(Boolean)))
      meta.bans[banned] = (meta.bans[banned] ?? 0) + 1;
}
meta.patches = [...patches].sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]) || Number(a.split(".")[1]) - Number(b.split(".")[1]));
const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
meta.picks = sorted(meta.picks);
meta.bans = sorted(meta.bans);
meta.stages = sorted(meta.stages);

/* ------------------------------ what he said ------------------------------ */
const NOTE_TAGS = new Set(["pick_order", "meta_strong", "meta_weak"]);
const PER_CHAMPION = 4;
const memory = read("data/kazewa-memory.json");
const notes = {};
const escaped = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const catalogue = Object.keys(knowledge.champions).map((champion) => ({
  champion,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escaped(champion)}(?![\\p{L}\\p{N}])`, "u"),
}));
// The first champion a sentence names; the longer name wins at the same place.
function firstNamed(text) {
  let best = null;
  for (const { champion, pattern } of catalogue) {
    const at = text.search(pattern);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && champion.length > best.champion.length))
      best = { champion, at };
  }
  return best?.champion ?? null;
}
const ROLE_WORDS = [
  ["top", /\btop(laner)?\b/i],
  ["jng", /\bjungl(e|er)\b/i],
  ["mid", /\bmid(laner)?\b/i],
  ["bot", /\b(adc|bot)\b/i],
  ["sup", /\bsupp(ort)?\b/i],
];
// One role named, and only one: the remark is about the champion in that role.
function roleNamed(text) {
  const found = ROLE_WORDS.filter(([, pattern]) => pattern.test(text)).map(([role]) => role);
  return found.length === 1 ? found[0] : null;
}
for (const item of memory.cases) {
  const source = item.sources?.[0];
  if (!source?.video) continue;
  for (const claim of item.claims ?? []) {
    if (!NOTE_TAGS.has(claim.tag)) continue;
    const text = String(claim.detailFr || claim.detail || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // A remark is filed under the champion it is about: the first one of the
    // whole catalogue it names. "Camille would have been fine with Karma" is
    // about Camille; when the argument does not list her, the remark is left out.
    const subject = firstNamed(text);
    if (!subject || !(claim.champions ?? []).includes(subject)) continue;
    for (const champion of [subject]) {
      (notes[champion] ??= []).push({
        date: item.match?.date ?? null,
        patch: item.match?.patch ?? null,
        tag: claim.tag,
        // The role, when the remark itself names one: it then holds for it only.
        role: roleNamed(text),
        text,
        video: source.video,
        ts: source.ts ?? null,
      });
    }
  }
}
for (const champion of Object.keys(notes)) {
  const seen = new Set();
  notes[champion] = notes[champion]
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || a.text.localeCompare(b.text, "fr"))
    .filter((note) => !seen.has(note.text) && seen.add(note.text))
    .slice(0, PER_CHAMPION);
}

const output = {
  version: "1.0.0",
  source:
    "meta: professional match data from Oracle's Elixir (oracleselixir.com), every league of the index but the academy series, the last days before `to`. notes: Kazewa's remarks on pick order and on the meta of the day, from the drafts he judged, each under the first champion it names.",
  meta,
  notes: sorted(notes),
};
fs.writeFileSync(path.join(root, "data", "coach.json"), JSON.stringify(output) + "\n");
const top = Object.entries(meta.picks)
  .map(([champion, byRole]) => [champion, (Object.values(byRole).reduce((n, v) => n + v, 0) + (meta.bans[champion] ?? 0)) / meta.games])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([champion, share]) => `${champion} ${Math.round(share * 100)} %`);
console.log(
  `Méta pro : ${meta.games} parties du ${meta.from} au ${meta.to}, patchs ${meta.patches.join(", ")} ; plus présents : ${top.join(", ")}`,
);
console.log(
  `Ligues : ${Object.entries(leagues).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([league, n]) => `${league} ${n}`).join(", ")}…`,
);
console.log(
  `Remarques de Kazewa : ${Object.values(notes).reduce((n, list) => n + list.length, 0)} sur ${Object.keys(notes).length} champions`,
);
