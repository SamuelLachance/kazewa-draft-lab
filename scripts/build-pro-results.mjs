/**
 * Builds data/pro-results/: for every pair of rosters seen in the professional
 * match index, the games played with it and the roster that won. One file per
 * key prefix, so the site fetches a few kilobytes for the draft on screen.
 *
 *   node scripts/build-pro-results.mjs [--oe <index.json>]
 *
 * Source: .cache/oe-games.json (scripts/build-oe-index.mjs, from the Oracle's
 * Elixir match data). Champion names are not stored, only a hash of the two
 * rosters; see src/results.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChampion, ROLES } from "../src/engine.mjs";
import { resultKey, shardOf } from "../src/results.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--oe");
const oePath = path.resolve(root, at > -1 ? process.argv[at + 1] : ".cache/oe-games.json");
const knowledge = JSON.parse(fs.readFileSync(path.join(root, "data", "knowledge.json"), "utf8"));
const games = JSON.parse(fs.readFileSync(oePath, "utf8"));

// The source writes "unknown team" where it has no name.
const team = (name) =>
  typeof name === "string" && name.trim() && !/^unknown team$/i.test(name.trim())
    ? name.trim()
    : null;
// A record whose pick order names other champions than its own rosters is
// damaged at the source: its result cannot be trusted either.
const orderFits = (game, side, roster) => {
  const picked = (game.order?.[side] ?? []).filter(Boolean);
  if (picked.length !== 5) return true;
  const names = new Set(picked.map((name) => normalizeChampion(name, knowledge)));
  return ROLES.every((role) => names.has(roster[role]));
};
const shards = new Map();
let kept = 0;
let skipped = 0;
const damaged = [];
const repeated = [];
const contradictory = [];
// One game can sit in the index under two ids: same rosters, teams, day, game.
const stored = new Map();
let from = null;
let to = null;
const seen = new Set();
for (const game of games) {
  const draft = {};
  for (const side of ["blue", "red"])
    draft[side] = Object.fromEntries(
      ROLES.map((role) => [
        role,
        typeof game[side]?.[role] === "string"
          ? normalizeChampion(game[side][role], knowledge)
          : null,
      ]),
    );
  const found = resultKey(draft);
  const date = (game.date ?? "").slice(0, 10);
  if (!found || !["blue", "red"].includes(game.winner) || !date || seen.has(game.id)) {
    skipped++;
    continue;
  }
  seen.add(game.id);
  if (!orderFits(game, "blue", draft.blue) || !orderFits(game, "red", draft.red)) {
    damaged.push(game.id);
    skipped++;
    continue;
  }
  const second = found.first === "blue" ? "red" : "blue";
  const shard = shardOf(found.key);
  if (!shards.has(shard)) shards.set(shard, new Map());
  const rows = shards.get(shard);
  if (!rows.has(found.key)) rows.set(found.key, []);
  const row = [
    team(game.teams?.[found.first]),
    team(game.teams?.[second]),
    game.winner === found.first ? 0 : 1,
    date,
    game.league ?? null,
    Number(game.game) || null,
  ];
  const identity = JSON.stringify([found.key, row[0], row[1], row[3], row[5]]);
  const twin = stored.get(identity);
  if (twin) {
    // Same game twice. Two copies that disagree on the winner: neither is kept.
    if (twin.row[2] === row[2]) repeated.push(game.id);
    else if (!twin.dropped) {
      twin.dropped = true;
      rows.get(found.key).splice(rows.get(found.key).indexOf(twin.row), 1);
      contradictory.push(`${twin.id} / ${game.id}`);
      kept--;
      skipped++;
    }
    skipped++;
    continue;
  }
  stored.set(identity, { row, id: game.id, dropped: false });
  rows.get(found.key).push(row);
  kept++;
  if (!from || date < from) from = date;
  if (!to || date > to) to = date;
}

const dir = path.join(root, "data", "pro-results");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
let keys = 0;
let bytes = 0;
for (const [shard, rows] of [...shards].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sorted = Object.fromEntries(
    [...rows]
      .filter(([, list]) => list.length)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => [
        key,
        list.sort((a, b) => a[3].localeCompare(b[3]) || (a[5] ?? 0) - (b[5] ?? 0)),
      ]),
  );
  keys += Object.keys(sorted).length;
  const text = JSON.stringify(sorted) + "\n";
  bytes += text.length;
  fs.writeFileSync(path.join(dir, `${shard}.json`), text);
}
fs.writeFileSync(
  path.join(dir, "index.json"),
  JSON.stringify(
    {
      version: "1.0.0",
      games: kept,
      rosterPairs: keys,
      files: shards.size,
      from,
      to,
      source:
        "Professional match data from Oracle's Elixir (oracleselixir.com). Each row: first team, second team, winner (0 or 1), date, league, game number.",
    },
    null,
    1,
  ) + "\n",
);
if (damaged.length) console.log(`Enregistrements abîmés à la source, écartés : ${damaged.join(", ")}`);
if (contradictory.length)
  console.log(`Même partie, deux vainqueurs, écartées : ${contradictory.join(" ; ")}`);
console.log(`Parties en double sous deux identifiants, gardées une fois : ${repeated.length}`);
console.log(
  `${kept} parties, ${keys} paires de compositions, ${shards.size} fichiers, ${(bytes / 1048576).toFixed(1)} Mo ; ignorées : ${skipped} ; du ${from} au ${to}`,
);
