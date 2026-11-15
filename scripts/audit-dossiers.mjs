/**
 * Writes one audit dossier per memory case into .cache/audit/dossiers/.
 * A dossier puts side by side what the extractions said, the professional game
 * the case was matched to, and the other games of the same series, so a
 * reviewer can tell whether the match and the sides are right.
 *
 *   node scripts/audit-dossiers.mjs [id ...]      (default: every case)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const read = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const memory = read("data/kazewa-memory.json");
const records = read(".cache/memory-records.json");
const oe = fs.existsSync(path.join(root, ".cache", "oe-games.json"))
  ? read(".cache/oe-games.json")
  : [];
const flaggedPath = path.join(root, ".cache", "audit", "flagged.json");
const flagged = fs.existsSync(flaggedPath) ? JSON.parse(fs.readFileSync(flaggedPath, "utf8")) : [];
const byGame = new Map(oe.map((g) => [g.id, g]));
const pair = (g) => [g.teams.blue, g.teams.red].sort().join("~");
const byPair = new Map();
for (const g of oe) {
  if (!byPair.has(pair(g))) byPair.set(pair(g), []);
  byPair.get(pair(g)).push(g);
}
const day = (g) => Date.parse(g.date.slice(0, 10) + "T00:00:00Z") / 86400000;
const line = (team) => ROLES.map((r) => `${r} ${team[r] ?? "?"}`).join(", ");
const brief = (g) => ({
  gameId: g.id,
  league: g.league,
  date: g.date.slice(0, 10),
  game: g.game,
  patch: g.patch,
  blueTeam: g.teams.blue,
  redTeam: g.teams.red,
  blue: line(g.blue),
  red: line(g.red),
  winner: g.winner,
});

const wanted = process.argv.slice(2);
const dir = path.join(root, ".cache", "audit", "dossiers");
fs.mkdirSync(dir, { recursive: true });
let written = 0;
for (const c of memory.cases) {
  if (wanted.length && !wanted.includes(c.id)) continue;
  const mine = records.filter((r) => r.caseId === c.id);
  const game = c.match?.gameId ? byGame.get(c.match.gameId) : null;
  const series = game
    ? (byPair.get(pair(game)) ?? [])
        .filter((g) => Math.abs(day(g) - day(game)) <= 1)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(brief)
    : [];
  const dossier = {
    id: c.id,
    memory: {
      blue: line(c.blue),
      red: line(c.red),
      teams: c.match?.teams ?? null,
      verdict: c.verdict,
      rosterVerified: c.rosterVerified,
      matchedGame: game ? brief(game) : null,
    },
    seriesGames: series,
    extractions: mine.map((r) => ({
      source: r.ref,
      kind: r.kind,
      attachedVia: r.how,
      screenLeftMappedTo: r.leftIs,
      leftTeam: r.teams?.left ?? null,
      rightTeam: r.teams?.right ?? null,
      leftPicks: line(r.left),
      rightPicks: line(r.right),
      preferredScreenSide: r.side,
      confidence: r.confidence,
      label: r.label,
      lateOpinion: r.late,
      gameWinnerSaid: r.result,
      context: r.context,
      reasons: r.reasons,
      reads: r.reads,
    })),
    otherExtractionsOfTheSameVideos: records
      .filter(
        (r) =>
          r.caseId !== c.id &&
          mine.some((m) => m.video && m.video === r.video),
      )
      .map((r) => ({
        source: r.ref,
        attachedToCase: r.caseId,
        leftPicks: line(r.left),
        rightPicks: line(r.right),
      })),
    translatorRemarks: flagged.filter((text) => text.includes(c.id)),
  };
  fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(dossier, null, 1));
  written++;
}
console.log(`${written} dossiers dans ${dir}`);
