/**
 * Writes one dossier per video that still has extraction records tied to no
 * game, into .cache/link/dossiers/. A dossier puts side by side the video
 * title, the teams and picks heard per game, every record of the video (those
 * already tied to a professional game, and those that are not), and the games
 * of the series already identified. A reviewer uses it to say which
 * professional game each loose record is about, or that none can be named.
 *
 *   node scripts/link-dossiers.mjs --corpus <kazewa corpus>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const corpusFlag = process.argv.indexOf("--corpus");
const corpus = corpusFlag >= 0 ? process.argv[corpusFlag + 1] : null;
if (!corpus) throw Error("--corpus <dossier du corpus Kazewa> est requis.");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const optional = (file) => (fs.existsSync(file) ? read(file) : null);

const memory = read(path.join(root, "data", "kazewa-memory.json"));
const records = read(path.join(root, ".cache", "memory-records.json"));
const oe = read(path.join(root, ".cache", "oe-games.json"));
const byGame = new Map(oe.map((game) => [game.id, game]));
const caseById = new Map(memory.cases.map((item) => [item.id, item]));
const titles = new Map(
  (optional(path.join(corpus, "pro_reviews.json")) ?? []).map((entry) => [entry.id, entry.title]),
);
const pair = (game) => [game.teams.blue, game.teams.red].sort().join("~");
const byPair = new Map();
for (const game of oe) {
  if (!byPair.has(pair(game))) byPair.set(pair(game), []);
  byPair.get(pair(game)).push(game);
}
const day = (game) => Date.parse(game.date.slice(0, 10) + "T00:00:00Z") / 86400000;
const line = (team) => ROLES.map((role) => `${role} ${team?.[role] ?? "?"}`).join(", ");
const brief = (game) => ({
  gameId: game.id,
  league: game.league,
  date: game.date.slice(0, 10),
  game: game.game,
  patch: game.patch,
  blueTeam: game.teams.blue,
  redTeam: game.teams.red,
  blue: line(game.blue),
  red: line(game.red),
  winner: game.winner,
});

const loose = records.filter((record) => !record.caseId);
const videos = [...new Set(loose.map((record) => record.video))].sort();
const dir = path.join(root, ".cache", "link", "dossiers");
fs.mkdirSync(dir, { recursive: true });
const index = [];
for (const video of videos) {
  const mine = records.filter((record) => record.video === video);
  const linked = mine.filter((record) => record.caseId);
  const linkedGames = new Map();
  for (const record of linked) {
    const item = caseById.get(record.caseId);
    const game = item?.match?.gameId ? byGame.get(item.match.gameId) : null;
    if (game) linkedGames.set(game.id, game);
  }
  const series = new Map();
  for (const game of linkedGames.values())
    for (const other of byPair.get(pair(game)) ?? [])
      if (Math.abs(day(other) - day(game)) <= 1) series.set(other.id, other);
  const dossier = {
    video,
    url: `https://www.youtube.com/watch?v=${video}`,
    title: titles.get(video) ?? null,
    heardPerGame: optional(path.join(corpus, "kb", "seg", `${video}.json`))?.games ?? [],
    rawFile: (() => {
      const raw = optional(path.join(corpus, "verdicts", `${video}.json`));
      if (!raw) return null;
      return {
        series: raw.series ?? null,
        games: (raw.games ?? []).map((game, position) => ({
          position: position + 1,
          game: game.game ?? null,
          left: game.left ?? null,
          right: game.right ?? null,
          left_picks: game.left_picks ?? null,
          right_picks: game.right_picks ?? null,
          verdict: game.verdict ?? null,
          result: game.result ?? null,
        })),
      };
    })(),
    looseRecords: loose
      .filter((record) => record.video === video)
      .map((record) => ({
        ref: record.ref,
        kind: record.kind,
        gameNo: record.gameNo,
        teams: record.teams,
        left: line(record.left),
        right: line(record.right),
        prefers: record.side,
        confidence: record.confidence,
        label: record.label,
        reasons: record.reasons,
        championReads: (record.reads ?? []).map((read) => ({
          champion: read.champion,
          comp: read.comp,
          read: read.read,
        })),
        resultSeen: record.result,
      })),
    tiedRecords: linked.map((record) => {
      const item = caseById.get(record.caseId);
      return {
        ref: record.ref,
        kind: record.kind,
        gameNo: record.gameNo,
        teams: record.teams,
        left: line(record.left),
        right: line(record.right),
        prefers: record.side,
        label: record.label,
        caseId: record.caseId,
        how: record.how,
        leftIs: record.leftIs,
        tiedGameId: item?.match?.gameId ?? null,
      };
    }),
    seriesGames: [...series.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(brief),
  };
  fs.writeFileSync(path.join(dir, `${video}.json`), JSON.stringify(dossier, null, 1));
  index.push({ video, loose: dossier.looseRecords.length, tied: dossier.tiedRecords.length });
}
fs.writeFileSync(path.join(root, ".cache", "link", "index.json"), JSON.stringify(index, null, 1));
console.log(`${index.length} dossiers, ${loose.length} enregistrements à relier`);
