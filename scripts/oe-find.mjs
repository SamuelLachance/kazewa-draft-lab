/**
 * Read-only search of the professional match index (.cache/oe-games.json).
 *
 *   node scripts/oe-find.mjs --team EDG --team "Royal Never" --from 2021-10-01 --to 2021-11-10
 *   node scripts/oe-find.mjs --champs "Jhin,Leona,Graves,Jayce" --min 4 --year 2021
 *   node scripts/oe-find.mjs --id LOLTMNT01_12345
 *
 * --team    substring of a team name, or its initials (repeat for the two teams)
 * --champs  champions seen in the game, any side; --min sets how many must be there
 * --left / --right  champions known on each screen side; both orientations are scored
 * --from / --to / --year / --league   narrow the search
 * --limit   rows printed (default 30)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const args = process.argv.slice(2);
const all = (flag) =>
  args.flatMap((value, index) => (value === flag && args[index + 1] ? [args[index + 1]] : []));
const one = (flag) => all(flag)[0] ?? null;
const fold = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const list = (flag) =>
  (one(flag) ?? "")
    .split(",")
    .map(fold)
    .filter(Boolean);

const games = JSON.parse(fs.readFileSync(path.join(root, ".cache", "oe-games.json"), "utf8"));
const teams = all("--team").map(fold);
const champs = list("--champs");
const left = list("--left");
const right = list("--right");
const from = one("--from") ?? (one("--year") ? `${one("--year")}-01-01` : null);
const to = one("--to") ?? (one("--year") ? `${one("--year")}-12-31` : null);
const league = one("--league") ? fold(one("--league")) : null;
const id = one("--id");
const limit = Number(one("--limit")) || 30;
const wanted = champs.length + left.length + right.length;
const min = Number(one("--min")) || Math.min(wanted, Math.max(1, wanted - 1));

const initials = (name) =>
  String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toLowerCase();
const capitals = (name) => String(name).replace(/[^A-Z0-9]/g, "").toLowerCase();
const teamMatches = (query, name) =>
  fold(name).includes(query) ||
  initials(name).startsWith(query) ||
  (query.length >= 2 && capitals(name).startsWith(query));
const line = (team) => ROLES.map((role) => `${role} ${team[role] || "?"}`).join(", ");

const rows = [];
for (const game of games) {
  if (id && game.id !== id) continue;
  const date = (game.date ?? "").slice(0, 10);
  if (from && date < from) continue;
  if (to && date > to) continue;
  if (league && !fold(game.league).includes(league)) continue;
  if (teams.length) {
    const names = [game.teams?.blue, game.teams?.red];
    if (!teams.every((query) => names.some((name) => teamMatches(query, name)))) continue;
  }
  const blue = new Set(ROLES.map((role) => fold(game.blue[role])));
  const red = new Set(ROLES.map((role) => fold(game.red[role])));
  let hits = 0;
  let orientation = null;
  if (wanted) {
    const any = champs.filter((name) => blue.has(name) || red.has(name)).length;
    const leftBlue =
      left.filter((name) => blue.has(name)).length + right.filter((name) => red.has(name)).length;
    const leftRed =
      left.filter((name) => red.has(name)).length + right.filter((name) => blue.has(name)).length;
    hits = any + Math.max(leftBlue, leftRed);
    if (left.length + right.length)
      orientation =
        leftBlue === leftRed
          ? `left=? (${leftBlue}/${leftRed})`
          : leftBlue > leftRed
            ? `left=blue (${leftBlue} vs ${leftRed})`
            : `left=red (${leftRed} vs ${leftBlue})`;
    if (hits < min) continue;
  }
  rows.push({ game, hits, orientation });
}
rows.sort((a, b) => b.hits - a.hits || a.game.date.localeCompare(b.game.date));
console.log(`${rows.length} partie(s)${wanted ? `, au moins ${min} champion(s) sur ${wanted}` : ""}`);
for (const { game, hits, orientation } of rows.slice(0, limit)) {
  console.log(
    [
      `id ${game.id}`,
      game.league,
      game.date,
      `game ${game.game}`,
      `patch ${game.patch}`,
      wanted ? `hits ${hits}${orientation ? " " + orientation : ""}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  console.log(`   BLUE ${game.teams.blue}: ${line(game.blue)}`);
  console.log(`   RED  ${game.teams.red}: ${line(game.red)}`);
  console.log(`   winner ${game.winner}`);
}
if (rows.length > limit) console.log(`… ${rows.length - limit} de plus (--limit)`);
