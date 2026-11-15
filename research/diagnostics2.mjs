/**
 * Second pass: signals built from professional match statistics only.
 * The judged game itself is always removed from the statistics it is scored with.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitLogistic } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const memory = JSON.parse(fs.readFileSync(path.join(root, "data", "kazewa-memory.json"), "utf8"));
const oe = JSON.parse(fs.readFileSync(path.join(root, ".cache", "oe-games.json"), "utf8"));
const byId = new Map(oe.map((g) => [g.id, g]));
const judged = memory.cases.filter((c) => c.verdict.side !== "even" && c.match?.gameId && byId.has(c.match.gameId));
const judgedIds = new Set(judged.map((c) => c.match.gameId));
const games = oe.filter((g) => g.winner && !judgedIds.has(g.id));
console.log("parties pro hors cas juges:", games.length, "| cas juges relies:", judged.length);

// Lane matchups (same role), duo synergies (same team), champion-role strength.
const lane = new Map();
const pair = new Map();
const solo = new Map();
const bump = (map, key, win) => {
  const s = map.get(key) ?? [0, 0];
  s[0]++;
  if (win) s[1]++;
  map.set(key, s);
};
const DUOS = [["bot", "sup"], ["jng", "mid"], ["top", "jng"], ["jng", "sup"], ["mid", "sup"], ["jng", "bot"], ["top", "mid"], ["mid", "bot"], ["top", "bot"], ["top", "sup"]];
for (const g of games) {
  for (const side of ["blue", "red"]) {
    const foe = side === "blue" ? "red" : "blue";
    const win = g.winner === side;
    for (const role of ROLES) {
      bump(solo, role + ":" + g[side][role], win);
      bump(lane, role + ":" + g[side][role] + ">" + g[foe][role], win);
    }
    for (const [a, b] of DUOS) bump(pair, a + ":" + g[side][a] + "+" + b + ":" + g[side][b], win);
  }
}
const edge = (stat, prior = 12) => (stat ? (stat[1] + prior / 2) / (stat[0] + prior) - 0.5 : 0);
const signals = {};
const add = (name, value, label) => {
  const s = (signals[name] ??= { agree: 0, disagree: 0, none: 0 });
  if (!value) s.none++;
  else if ((value > 0 ? "blue" : "red") === label) s.agree++;
  else s.disagree++;
};
const BLUE_SLOTS = [1, 4, 5, 8, 9];
const RED_SLOTS = [2, 3, 6, 7, 10];
const rows = [];
for (const c of judged) {
  const g = byId.get(c.match.gameId);
  const label = c.verdict.side;
  let laneEdge = 0;
  let soloEdge = 0;
  let duoEdge = 0;
  const lanes = {};
  for (const role of ROLES) {
    const e = edge(lane.get(role + ":" + g.blue[role] + ">" + g.red[role]), 20);
    lanes[role] = e;
    laneEdge += e;
    soloEdge += edge(solo.get(role + ":" + g.blue[role]), 40) - edge(solo.get(role + ":" + g.red[role]), 40);
  }
  for (const [a, b] of DUOS)
    duoEdge +=
      edge(pair.get(a + ":" + g.blue[a] + "+" + b + ":" + g.blue[b]), 20) -
      edge(pair.get(a + ":" + g.red[a] + "+" + b + ":" + g.red[b]), 20);
  const first = g.firstPick ?? "blue";
  const slot = (side, champion) => {
    const index = (g.order?.[side] ?? []).indexOf(champion);
    return index < 0 ? null : (side === first ? BLUE_SLOTS : RED_SLOTS)[index];
  };
  let counter = 0;
  let answered = 0;
  const perRole = {};
  for (const role of ROLES) {
    const b = slot("blue", g.blue[role]);
    const r = slot("red", g.red[role]);
    if (!b || !r) continue;
    const later = b > r ? 1 : -1;
    counter += later;
    perRole[role] = later;
    // A counter-pick that the pro matchup data confirms.
    if (later * lanes[role] > 0.01) answered += later;
  }
  add("matchups de lane (stats pro)", laneEdge, label);
  add("force brute des picks (stats pro)", soloEdge, label);
  add("synergies de duo (stats pro)", duoEdge, label);
  add("somme lane+force+duo", laneEdge + soloEdge + duoEdge, label);
  add("contre-picks", counter, label);
  add("contre-picks confirmes par les stats", answered, label);
  for (const role of ROLES) add("  contre-pick " + role, perRole[role] ?? 0, label);
  add("contre-picks + 8*lane", counter + 8 * laneEdge, label);
  rows.push({ label, group: c.group, x: [laneEdge, soloEdge, duoEdge, counter / 5, answered / 5, ...ROLES.map((r) => (perRole[r] ?? 0))], winner: g.winner });
}
for (const [name, s] of Object.entries(signals)) {
  const n = s.agree + s.disagree;
  console.log(name.padEnd(40), `${s.agree}/${n}`.padEnd(9), ((s.agree / n) * 100).toFixed(1) + "%", s.none ? `(sans signal: ${s.none})` : "");
}
// How well do the same statistics predict the real winner of these games?
const predictWinner = rows.filter((r) => (r.x[0] + r.x[1] + r.x[2] > 0 ? "blue" : "red") === r.winner).length;
console.log("reference: lane+force+duo donne le vainqueur reel dans", ((predictWinner / rows.length) * 100).toFixed(1) + "%");

// Leave-one-group-out logistic on these few signals.
const groups = [...new Set(rows.map((r) => r.group))];
for (const [name, cols] of [["contre-picks seuls", [3]], ["contre-picks par role", [5, 6, 7, 8, 9]], ["stats pro (lane, force, duo)", [0, 1, 2]], ["tout", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]]) {
  let ok = 0;
  for (const g of groups) {
    const train = rows.filter((r) => r.group !== g);
    const X = [];
    const y = [];
    for (const r of train) {
      const x = cols.map((j) => r.x[j]);
      X.push(x);
      y.push(r.label === "blue");
      X.push(x.map((v) => -v));
      y.push(r.label !== "blue");
    }
    const w = fitLogistic(X, y, { lambda: 1 });
    for (const r of rows.filter((q) => q.group === g)) {
      const z = cols.reduce((n, j, k) => n + r.x[j] * w[k], 0);
      ok += z === 0 ? 0.5 : (z > 0 ? "blue" : "red") === r.label ? 1 : 0;
    }
  }
  console.log(`hors-groupe, ${name}:`.padEnd(42), ((ok / rows.length) * 100).toFixed(1) + "%");
}
