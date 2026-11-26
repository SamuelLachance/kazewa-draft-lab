/**
 * Agreement of the draft system with Kazewa's verdicts, measured once per version, with
 * no setting fitted on them. The rules and profiles were written before this run.
 *
 *   node research/draftsystem/evaluate.mjs
 *
 * Caveat, stated in the output: the profiles and rules come from the same
 * videos as the verdicts, so this agreement is in-sample for the knowledge base.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeDraft } from "../../src/draft-system/chooser.mjs";
import { buildLinks } from "../../src/draft-system/links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const knowledge = read("data/knowledge.json");
const memory = read("data/memory-site.json");
const links = buildLinks({ method: read("data/method.json"), cards: read("data/champion-cards.json") });

const rows = [];
for (const item of memory.cases) {
  const side = item.verdict?.side;
  if (side !== "blue" && side !== "red") continue;
  const result = judgeDraft({ blue: item.blue, red: item.red }, { champions: knowledge.champions, links });
  rows.push({
    group: item.sources?.[0]?.video ?? item.id,
    credit: result.side === "even" ? 0.5 : result.side === side ? 1 : 0,
    answered: result.side !== "even",
  });
}

const groups = [...new Set(rows.map((r) => r.group))];
const agree = (subset) => subset.reduce((sum, r) => sum + r.credit, 0) / subset.length;
const pooled = agree(rows);

// Group bootstrap: whole videos are resampled, as the other measures of the site do.
let seed = 7;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const byGroup = new Map(groups.map((g) => [g, rows.filter((r) => r.group === g)]));
const draws = [];
for (let i = 0; i < 2000; i += 1) {
  const picked = [];
  for (let j = 0; j < groups.length; j += 1) picked.push(...byGroup.get(groups[Math.floor(random() * groups.length)]));
  draws.push(agree(picked));
}
draws.sort((a, b) => a - b);
const low = draws[Math.floor(0.025 * draws.length)];
const high = draws[Math.floor(0.975 * draws.length)];

const result = {
  judgedDrafts: rows.length,
  videos: groups.length,
  agreement: Number(pooled.toFixed(4)),
  ci95ByVideo: [Number(low.toFixed(4)), Number(high.toFixed(4))],
  sideAnswered: rows.filter((r) => r.answered).length,
  version: "2: rules, profiles, duos, counters and families of the accumulated knowledge",
  note: "Rules and profiles are the accumulated knowledge, written before this measure. In-sample for the knowledge base: the same videos wrote the rules and judged the drafts.",
};
console.log(JSON.stringify(result, null, 1));
