/**
 * Does the coach make sense? Replays real professional drafts step by step
 * and asks, at each ban and each pick, where the champion the team really
 * took stands in the coach's list.
 *
 *   node research/coach-eval.mjs [--from 2026-01-01] [--to 2026-12-31] [--every 8] [--days 60]
 *
 * What the coach is given for a game:
 *   - professional figures from the `--days` before it only, academy series
 *     left out, as in scripts/build-coach-data.mjs;
 *   - Kazewa's remarks dated before the game only;
 *   - games he commented are not replayed, since his arguments come from them.
 * The earlier picks of a draft are written in the role they were really
 * played in. The last line of the pick table does it the way the site does:
 * each earlier pick goes to the role the coach itself gives it on a click.
 * Needs .cache/oe-games.json (scripts/build-oe-index.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChampion, ROLES } from "../src/engine.mjs";
import { cardRelations } from "../src/relations.mjs";
import { coachTables, rankBans, rankPicks, WEIGHTS } from "../src/coach.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const knowledge = read("data/knowledge.json");
const champions = Object.keys(knowledge.champions);
const profiles = knowledge.champions;
const memory = read("data/memory-site.json");
const full = read("data/kazewa-memory.json");
const notes = read("data/coach.json").notes;
const noteOf = (champion) => notes[champion] ?? null;
const commented = new Set(full.cases.map((item) => item.match?.gameId).filter(Boolean));
const tables = coachTables(memory, cardRelations(read("data/champion-cards.json")));
const name = (value) => (typeof value === "string" ? normalizeChampion(value, knowledge) : null);
const ACADEMY = new Set(["LAS", "LCKC", "WSCI", "ASCI"]);

const games = read(".cache/oe-games.json")
  .filter(
    (game) =>
      game.firstPick &&
      game.order?.blue?.filter(Boolean).length === 5 &&
      game.order?.red?.filter(Boolean).length === 5,
  )
  .map((game) => {
    const first = game.firstPick;
    const second = first === "blue" ? "red" : "blue";
    const team = (side) => {
      const roleOf = new Map(ROLES.map((role) => [name(game[side][role]), role]));
      const picks = game.order[side].map(name);
      return {
        picks: picks.map((champion) => ({ champion, role: roleOf.get(champion) ?? null })),
        bans: (game.bans?.[side] ?? []).map(name),
      };
    };
    return {
      id: game.id,
      league: game.league,
      date: game.date,
      day: Date.parse(game.date.slice(0, 10)) / 86400000,
      first: team(first),
      second: team(second),
    };
  })
  .filter((game) =>
    [game.first, game.second].every((team) => team.picks.every((pick) => pick.champion && pick.role)),
  )
  .sort((a, b) => a.date.localeCompare(b.date));

// The twenty steps, the first-pick team written as "blue" like in the coach.
const PICKS = [["blue", 0], ["red", 0], ["red", 1], ["blue", 1], ["blue", 2], ["red", 2], ["red", 3], ["blue", 3], ["blue", 4], ["red", 4]];
const STEPS = [
  ...[0, 1, 2].flatMap((i) => [{ ban: ["blue", i] }, { ban: ["red", i] }]),
  ...PICKS.slice(0, 6).map((pick, i) => ({ pick, slot: i + 1 })),
  { ban: ["red", 3] }, { ban: ["blue", 3] }, { ban: ["red", 4] }, { ban: ["blue", 4] },
  ...PICKS.slice(6).map((pick, i) => ({ pick, slot: i + 7 })),
];

const meta = { games: 0, to: null, picks: {}, bans: {}, stages: {}, slots: Array.from({ length: 10 }, () => ({})) };
function count(game, sign) {
  if (ACADEMY.has(game.league)) return;
  meta.games += sign;
  const team = { blue: game.first, red: game.second };
  PICKS.forEach(([side, index], slot) => {
    const { champion, role } = team[side].picks[index];
    meta.picks[champion] ??= {};
    meta.picks[champion][role] = (meta.picks[champion][role] ?? 0) + sign;
    meta.slots[slot][role] = (meta.slots[slot][role] ?? 0) + sign;
    meta.stages[champion] ??= [0, 0, 0];
    meta.stages[champion][slot < 3 ? 0 : slot < 6 ? 1 : 2] += sign;
  });
  for (const side of ["blue", "red"])
    for (const champion of new Set(team[side].bans.filter(Boolean)))
      meta.bans[champion] = (meta.bans[champion] ?? 0) + sign;
}

const from = arg("--from", "2026-01-01");
const to = arg("--to", "2026-12-31");
const every = Number(arg("--every", "8"));
const days = Number(arg("--days", "60"));
const zero = { ...WEIGHTS, timing: 0, stage: 0, said: 0, saidLane: 0, card: 0, cardLane: 0, opinion: 0, frontline: 0, banMix: 0, own: 0 };
const moment = { ...zero, timing: WEIGHTS.timing, stage: WEIGHTS.stage, banMix: WEIGHTS.banMix };
const VARIANTS = {
  "présence pro seule": { weights: zero },
  "+ moment de la draft": { weights: moment },
  "+ ce qu’il a dit": { weights: { ...WEIGHTS, frontline: 0, own: 0 } },
  "coach complet": { weights: WEIGHTS },
  "coach complet, rôles placés": { weights: WEIGHTS, placed: true },
};
const extra = arg("--weights", null);
if (extra) VARIANTS["essai"] = { weights: { ...WEIGHTS, ...JSON.parse(extra) } };

const emptyBoard = () => ({
  blue: Object.fromEntries(ROLES.map((role) => [role, null])),
  red: Object.fromEntries(ROLES.map((role) => [role, null])),
});
const tally = Object.fromEntries(
  Object.keys(VARIANTS).map((key) => [key, { pick: [[], [], []], ban1: [], ban2: [] }]),
);
let head = 0;
let tail = 0;
let used = 0;
let index = 0;
for (const game of games) {
  // Slide the window so it holds the games of the `days` before this one.
  while (head < games.length && games[head].day < game.day) count(games[head++], +1);
  while (tail < head && games[tail].day < game.day - days) count(games[tail++], -1);
  const date = game.date.slice(0, 10);
  if (date < from || date > to || commented.has(game.id) || ACADEMY.has(game.league) || meta.games < 200) continue;
  if (index++ % every) continue;
  used++;
  // His remarks count for six months: counted from the day before this game.
  meta.to = new Date((game.day - 1) * 86400000).toISOString().slice(0, 10);
  const team = { blue: game.first, red: game.second };
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const { weights } = variant;
    const picks = emptyBoard();
    const bans = { blue: [], red: [] };
    let picked = 0;
    for (const step of STEPS) {
      const shared = { picks, bans, tables, meta, champions, noteOf, weights };
      if (step.ban) {
        const [side, i] = step.ban;
        const real = team[side].bans[i];
        if (!real) continue;
        const next = i < 3 ? "blue" : "red";
        const ownPicks =
          weights.own && next === side
            ? new Set(
                rankPicks({ ...shared, side, slot: picked + 1, profiles })
                  .filter((row) => row.playable && !row.rare)
                  .slice(0, 1)
                  .map((row) => row.champion),
              )
            : null;
        // As on the site: the ban of one's own best pick is not suggested.
        const rows = rankBans({ ...shared, side, ownPicks }).filter(
          (row) => row.playable && !row.reasons.some((reason) => reason.kind === "own"),
        );
        const rank = rows.findIndex((row) => row.champion === real);
        tally[key][i < 3 ? "ban1" : "ban2"].push(rank < 0 ? 999 : rank + 1);
        bans[side].push(real);
        continue;
      }
      const [side, i] = step.pick;
      const real = team[side].picks[i];
      const rows = rankPicks({ ...shared, side, slot: step.slot, profiles });
      const playable = rows.filter((row) => row.playable && !row.rare);
      const rank = playable.findIndex((row) => row.champion === real.champion);
      tally[key].pick[step.slot <= 3 ? 0 : step.slot <= 6 ? 1 : 2].push(rank < 0 ? 999 : rank + 1);
      // Where the pick is written: its real role, or the role a click gives it.
      let role = real.role;
      if (variant.placed) {
        const given = rows.find((row) => row.champion === real.champion)?.role;
        role = given ?? (picks[side][real.role] ? ROLES.find((lane) => !picks[side][lane]) : real.role);
      }
      if (picks[side][role]) role = ROLES.find((lane) => !picks[side][lane]);
      picks[side][role] = real.champion;
      picked++;
    }
  }
}

const share = (ranks, k) => ((100 * ranks.filter((rank) => rank <= k).length) / ranks.length).toFixed(1).padStart(5) + " %";
const median = (ranks) => [...ranks].sort((a, b) => a - b)[Math.floor(ranks.length / 2)];
const line = (key, ranks) =>
  "  " + key.padEnd(29) + share(ranks, 1) + " " + share(ranks, 5) + " " + share(ranks, 10) + "  " + String(median(ranks)).padStart(6) + "      " + ranks.length;
const header = "  lecture".padEnd(31) + "1er".padStart(7) + "top 5".padStart(9) + "top 10".padStart(9) + "  rang médian  (cas)";
console.log(`${used} parties du ${from} au ${to} (une sur ${every}), chiffres pro des ${days} jours précédents`);
for (const [label, pick] of [["Picks, tous", null], ["Picks 1 à 3", 0], ["Picks 4 à 6", 1], ["Picks 7 à 10", 2]]) {
  console.log(`\n${label} : le champion réellement pris est…`);
  console.log(header);
  for (const key of Object.keys(VARIANTS))
    console.log(line(key, pick === null ? tally[key].pick.flat() : tally[key].pick[pick]));
}
for (const [kind, label] of [["ban1", "Bans, première phase"], ["ban2", "Bans, seconde phase"]]) {
  console.log(`\n${label} : le champion réellement banni est…`);
  console.log(header);
  for (const key of Object.keys(VARIANTS)) if (!VARIANTS[key].placed) console.log(line(key, tally[key][kind]));
}
