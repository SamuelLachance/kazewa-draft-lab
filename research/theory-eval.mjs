/**
 * What does the draft procedure of the two coaches (src/theory.mjs) say of
 * the drafts Kazewa judged? Nothing is fitted: the rubric is applied as it
 * stands, and the answer is compared with his verdict.
 *
 *   node research/theory-eval.mjs
 *
 * Professional games are not read here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDraft, theoryContext } from "../src/theory.mjs";
import { indexMethod } from "../src/method.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const knowledge = read("data/knowledge.json");
const ctx = theoryContext({ knowledge, index: indexMethod(read("data/method.json")) });
const memory = read("data/kazewa-memory.json");
const decided = memory.cases.filter((item) => item.verdict.side !== "even");

const rows = decided.map((item) => {
  const reading = evaluateDraft({ blue: item.blue, red: item.red }, ctx);
  return { item, reading };
});
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)} % (${k}/${n})` : "—");
const called = rows.filter((row) => row.reading.side !== "even");
const hit = (list) => list.filter((row) => row.reading.side === row.item.verdict.side).length;

console.log(`Drafts jugées par Kazewa, verdict tranché : ${decided.length}`);
console.log(`Procédure qui penche d’un côté : ${pct(called.length, decided.length)}`);
console.log(`Même côté que son verdict : ${pct(hit(called), called.length)}`);
for (const confidence of [0, 1, 2, 3]) {
  const list = rows.filter((row) => row.reading.confidence === confidence && row.reading.side !== "even");
  if (list.length) console.log(`  confiance ${confidence} : ${pct(hit(list), list.length)}`);
}
const byTiming = (timing) => rows.filter((row) => row.item.verdict.timing === timing && row.reading.side !== "even");
for (const timing of ["draft", "review", "late"]) {
  const list = byTiming(timing);
  if (list.length) console.log(`  avis ${timing} : ${pct(hit(list), list.length)}`);
}
// The same procedure, read per draft: how often each hole fires on the side he preferred.
const holes = new Map();
for (const { item, reading } of rows)
  for (const side of ["blue", "red"])
    for (const hole of reading[side].holes) {
      const entry = holes.get(hole.id) ?? { label: hole.label, coach: hole.coach, n: 0, against: 0 };
      entry.n++;
      if (item.verdict.side !== side) entry.against++;
      holes.set(hole.id, entry);
    }
console.log("\nTrous (le côté qui en porte est-il celui que Kazewa n’a pas préféré ?) :");
for (const [id, entry] of [...holes.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${id.padEnd(16)} ${String(entry.n).padStart(4)} fois, ${pct(entry.against, entry.n)} du côté qu’il n’a pas préféré · ${entry.coach}`);
