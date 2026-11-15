/**
 * Compact index of professional games from locally mirrored Oracle's Elixir CSVs.
 * Used only to verify and complete the rosters of drafts Kazewa commented.
 * The index is a local cache (.cache/), never committed and never shipped.
 *
 *   node scripts/build-oe-index.mjs --csv-dir <dir with 2022.csv ...> [--out .cache/oe-games.json]
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
// Several folders can be given, separated by commas. When two of them hold the
// same year, the last one wins: a fresher download replaces an older one.
const csvDirs = arg(
  "--csv-dir",
  process.env.OE_CSV_DIR ?? path.resolve(root, "..", "..", "kazewa", "draft-lab", ".cache", "oe"),
)
  .split(",")
  .map((dir) => dir.trim())
  .filter(Boolean);
const out = path.resolve(root, arg("--out", ".cache/oe-games.json"));
const ROLES = ["top", "jng", "mid", "bot", "sup"];

export function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

async function main() {
  const games = new Map();
  const byYear = new Map();
  for (const dir of csvDirs)
    for (const name of fs.readdirSync(dir).filter((n) => /^\d{4}\.csv$/.test(n)))
      byYear.set(name, path.join(dir, name));
  const files = [...byYear.keys()].sort();
  if (!files.length) throw Error(`Aucun CSV annuel dans ${csvDirs.join(", ")}`);
  for (const name of files) {
    const lines = readline.createInterface({
      input: fs.createReadStream(byYear.get(name), "utf8"),
      crlfDelay: Infinity,
    });
    let col = null;
    for await (const raw of lines) {
      if (!col) {
        col = Object.fromEntries(
          parseCsvLine(raw.replace(/^﻿/, "")).map((h, i) => [h, i]),
        );
        continue;
      }
      if (!raw) continue;
      const f = parseCsvLine(raw);
      const id = f[col.gameid];
      if (!id) continue;
      let game = games.get(id);
      if (!game) {
        game = {
          id,
          league: f[col.league],
          year: Number(f[col.year]),
          split: f[col.split],
          playoffs: f[col.playoffs] === "1",
          date: f[col.date],
          game: Number(f[col.game]) || null,
          patch: f[col.patch],
          blue: {},
          red: {},
          teams: {},
          order: {},
          bans: {},
          firstPick: null,
          winner: null,
        };
        games.set(id, game);
      }
      const side =
        f[col.side] === "Blue" ? "blue" : f[col.side] === "Red" ? "red" : null;
      if (!side) continue;
      const position = f[col.position];
      if (position === "team") {
        game.teams[side] = f[col.teamname];
        game.order[side] = [1, 2, 3, 4, 5].map((n) => f[col["pick" + n]]);
        game.bans[side] = [1, 2, 3, 4, 5].map((n) => f[col["ban" + n]]);
        if (f[col.firstPick] === "1") game.firstPick = side;
        if (f[col.result] === "1") game.winner = side;
      } else if (ROLES.includes(position)) {
        game[side][position] = f[col.champion];
        game.teams[side] ??= f[col.teamname];
        if (f[col.result] === "1") game.winner = side;
      }
    }
    console.log(`${name}: ${games.size} parties cumulées`);
  }
  const complete = [...games.values()].filter((g) =>
    ROLES.every((r) => g.blue[r] && g.red[r]),
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(complete));
  console.log(`${complete.length} parties avec dix rôles écrites dans ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
