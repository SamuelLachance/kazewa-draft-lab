/**
 * What is Shanei's reading of a finished draft worth as a predictor?
 *
 *   node research/shanei-eval.mjs [--from 2021-01-01]
 *
 * The reading (src/method.mjs, shaneiReading) names the composition his grid
 * finds healthier. Nothing in it is fitted. This script sets it next to:
 *   - Kazewa's verdict, on the drafts he judged (data/kazewa-memory.json);
 *   - the result of the game, on every professional game of the match index
 *     (.cache/oe-games.json), academies left out.
 * It also prints how often each fault fires on professional compositions:
 * a rule that faults most professional drafts says more about the rule's
 * translation into code than about the drafts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChampion, ROLES } from "../src/engine.mjs";
import { indexMethod, shaneiReading } from "../src/method.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const knowledge = read("data/knowledge.json");
const index = indexMethod(read("data/method.json"));
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)} % (${k}/${n})` : "—");

/* --------------------------- Kazewa's verdicts --------------------------- */
const memory = read("data/kazewa-memory.json");
const decided = memory.cases.filter((item) => item.verdict.side !== "even");
const rows = decided
  .map((item) => ({ item, reading: shaneiReading({ blue: item.blue, red: item.red }, index) }))
  .filter((row) => row.reading);
const leaning = rows.filter((row) => row.reading.side !== "even");
console.log(`Drafts jugées par Kazewa : ${rows.length} lues, la grille de Shanei penche sur ${leaning.length}`);
console.log(`  même côté que le verdict de Kazewa : ${pct(leaning.filter((row) => row.reading.side === row.item.verdict.side).length, leaning.length)}`);
for (const least of [1, 2, 3]) {
  const clear = leaning.filter((row) => Math.abs(row.reading.margin) >= least);
  console.log(`  écart d’au moins ${least} : ${pct(clear.filter((row) => row.reading.side === row.item.verdict.side).length, clear.length)}`);
}
const timed = leaning.filter((row) => row.item.verdict.timing === "draft");
console.log(`  avis donnés pendant la draft : ${pct(timed.filter((row) => row.reading.side === row.item.verdict.side).length, timed.length)}`);
const won = leaning.filter((row) => row.item.winner);
console.log(`  même côté que le vainqueur de ces parties : ${pct(won.filter((row) => row.reading.side === row.item.winner).length, won.length)}`);

/* --------------------------- professional games -------------------------- */
const file = path.join(root, ".cache", "oe-games.json");
if (!fs.existsSync(file)) {
  console.log("Pas d’index des parties pro (.cache/oe-games.json) : mesure sur le résultat sautée.");
  process.exit(0);
}
const ACADEMY = new Set(["LAS", "LCKC", "WSCI", "ASCI"]);
const from = arg("--from", "2021-01-01");
const name = (value) => (typeof value === "string" ? normalizeChampion(value, knowledge) : null);
const games = JSON.parse(fs.readFileSync(file, "utf8")).filter(
  (game) => game.date >= from && !ACADEMY.has(game.league) && (game.winner === "blue" || game.winner === "red"),
);
let read5 = 0;
const byMargin = new Map();
const faults = new Map();
const families = {};
let comps = 0;
let clean = 0;
for (const game of games) {
  const draft = {
    blue: Object.fromEntries(ROLES.map((role) => [role, name(game.blue?.[role])])),
    red: Object.fromEntries(ROLES.map((role) => [role, name(game.red?.[role])])),
  };
  if (ROLES.some((role) => !draft.blue[role] || !draft.red[role])) continue;
  const reading = shaneiReading(draft, index);
  if (!reading) continue;
  read5++;
  for (const side of ["blue", "red"]) {
    comps++;
    const team = reading[side];
    families[team.family ?? "aucune"] = (families[team.family ?? "aucune"] ?? 0) + 1;
    const found = team.items.filter((item) => item.kind === "fault");
    if (!found.length) clean++;
    for (const item of found) faults.set(item.rule, (faults.get(item.rule) ?? 0) + 1);
  }
  if (reading.side === "even") continue;
  const key = Math.min(4, Math.ceil(Math.abs(reading.margin)));
  const cell = byMargin.get(key) ?? [0, 0];
  cell[1]++;
  if (reading.side === game.winner) cell[0]++;
  byMargin.set(key, cell);
}
const all = [...byMargin.values()].reduce((sum, cell) => [sum[0] + cell[0], sum[1] + cell[1]], [0, 0]);
console.log(`\nParties pro depuis ${from} : ${read5} lues, la grille penche sur ${all[1]}`);
console.log(`  même côté que le vainqueur : ${pct(all[0], all[1])}`);
for (const key of [...byMargin.keys()].sort()) {
  const [k, n] = byMargin.get(key);
  console.log(`  écart ${key === 4 ? "de 4 ou plus" : `jusqu’à ${key}`} : ${pct(k, n)}`);
}
console.log(`\nFamille lue sur ${comps} compositions pro : ${Object.entries(families).map(([family, n]) => `${family} ${((100 * n) / comps).toFixed(0)} %`).join(" · ")}`);
console.log(`Compositions sans aucune faute d’après la grille : ${pct(clean, comps)}`);
console.log("Fautes les plus fréquentes :");
for (const [rule, n] of [...faults.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14))
  console.log(`  ${rule.padEnd(6)} ${((100 * n) / comps).toFixed(1).padStart(5)} %  ${index.rules[rule]?.text.slice(0, 110) ?? ""}`);
