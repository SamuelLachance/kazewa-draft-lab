/**
 * What drives the verdicts? Parameter-free signals, measured on the games that
 * are matched to professional match data. No fitting: each signal is a fixed
 * sign rule, so the agreement needs no cross-validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const memory = JSON.parse(fs.readFileSync(path.join(root, "data", "kazewa-memory.json"), "utf8"));
const oe = JSON.parse(fs.readFileSync(path.join(root, ".cache", "oe-games.json"), "utf8"));
oe.sort((a, b) => a.date.localeCompare(b.date));

// Sequential Elo by team name, recorded before each game.
const elo = new Map();
const pre = new Map();
const rating = (team) => elo.get(team) ?? 1500;
for (const g of oe) {
  const b = rating(g.teams.blue);
  const r = rating(g.teams.red);
  pre.set(g.id, { blue: b, red: r, gamesBlue: 0 });
  if (!g.winner) continue;
  const expected = 1 / (1 + 10 ** ((r - b) / 400));
  const delta = 28 * ((g.winner === "blue" ? 1 : 0) - expected);
  elo.set(g.teams.blue, b + delta);
  elo.set(g.teams.red, r - delta);
}

// Rolling meta: champion-role picks and wins in the previous 60 days, all pro leagues.
const day = (date) => Date.parse(date.slice(0, 10) + "T00:00:00Z") / 86400000;
const byDay = oe.map((g) => ({ g, d: day(g.date) }));
function metaBefore(date, windowDays = 60) {
  const end = day(date);
  const stats = new Map();
  let games = 0;
  for (const { g, d } of byDay) {
    if (d >= end) break;
    if (d < end - windowDays) continue;
    games++;
    for (const side of ["blue", "red"])
      for (const role of ROLES) {
        const key = role + ":" + g[side][role];
        const s = stats.get(key) ?? { picks: 0, wins: 0, bans: 0 };
        s.picks++;
        if (g.winner === side) s.wins++;
        stats.set(key, s);
      }
    for (const side of ["blue", "red"])
      for (const ban of g.bans?.[side] ?? []) {
        if (!ban) continue;
        const key = "ban:" + ban;
        stats.set(key, (stats.get(key) ?? 0) + 1);
      }
  }
  return { stats, games };
}

const BLUE_SLOTS = [1, 4, 5, 8, 9];
const RED_SLOTS = [2, 3, 6, 7, 10];
const signals = {};
const add = (name, value, label) => {
  const s = (signals[name] ??= { agree: 0, disagree: 0, none: 0 });
  if (!value) s.none++;
  else if ((value > 0 ? "blue" : "red") === label) s.agree++;
  else s.disagree++;
};
let used = 0;
const rowsOut = [];
for (const c of memory.cases) {
  if (c.verdict.side === "even" || !c.match?.gameId) continue;
  const g = oe.find((x) => x.id === c.match.gameId);
  if (!g) continue;
  used++;
  const label = c.verdict.side;
  const p = pre.get(g.id);
  add("equipe la mieux classee (Elo)", p.blue - p.red, label);
  if (Math.abs(p.blue - p.red) >= 60) add("  Elo, ecart >= 60", p.blue - p.red, label);
  add("vainqueur reel", g.winner === "blue" ? 1 : g.winner === "red" ? -1 : 0, label);
  const { stats, games } = metaBefore(g.date);
  if (games >= 150) {
    let wr = 0;
    let presence = 0;
    for (const role of ROLES) {
      for (const [side, sign] of [["blue", 1], ["red", -1]]) {
        const s = stats.get(role + ":" + g[side][role]) ?? { picks: 0, wins: 0 };
        wr += sign * ((s.wins + 10) / (s.picks + 20) - 0.5);
        presence += sign * (s.picks / games);
      }
    }
    add("winrate meta (60 j, lisse)", Math.abs(wr) < 1e-9 ? 0 : wr, label);
    add("presence meta (60 j)", Math.abs(presence) < 1e-9 ? 0 : presence, label);
  }
  // Pick order: who answers whom in each lane.
  const first = g.firstPick ?? "blue";
  const slot = (side, champion) => {
    const index = (g.order?.[side] ?? []).indexOf(champion);
    if (index < 0) return null;
    return (side === first ? BLUE_SLOTS : RED_SLOTS)[index];
  };
  let counter = 0;
  let known = 0;
  for (const role of ROLES) {
    const b = slot("blue", g.blue[role]);
    const r = slot("red", g.red[role]);
    if (!b || !r) continue;
    known++;
    counter += b > r ? 1 : -1;
  }
  if (known === 5) {
    add("plus de lanes en contre-pick", counter, label);
    add("dernier pick (cote second)", first === "blue" ? -1 : 1, label);
  }
  add("cote bleu de la carte", 1, label);
  rowsOut.push({ id: c.id, label, timing: c.verdict.timing, elo: p.blue - p.red, winner: g.winner });
}
console.log("cas relies aux matchs avec avis tranche :", used);
for (const [name, s] of Object.entries(signals)) {
  const n = s.agree + s.disagree;
  console.log(
    name.padEnd(34),
    `${s.agree}/${n}`.padEnd(9),
    ((s.agree / n) * 100).toFixed(1) + "%",
    s.none ? `(sans signal: ${s.none})` : "",
  );
}
for (const timing of ["draft", "review", "late"]) {
  const list = rowsOut.filter((r) => r.timing === timing);
  const win = list.filter((r) => r.winner === r.label).length;
  const fav = list.filter((r) => r.elo !== 0 && (r.elo > 0 ? "blue" : "red") === r.label).length;
  console.log(`timing ${timing}: n=${list.length} | suit le vainqueur ${((win / list.length) * 100).toFixed(1)}% | suit le favori Elo ${((fav / list.length) * 100).toFixed(1)}%`);
}
const favWins = rowsOut.filter((r) => r.elo !== 0 && (r.elo > 0 ? "blue" : "red") === r.winner).length;
console.log(`reference: le favori Elo gagne ${((favWins / rowsOut.length) * 100).toFixed(1)}% de ces parties`);
