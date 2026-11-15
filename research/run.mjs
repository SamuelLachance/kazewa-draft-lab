/** CLI: node research/run.mjs <model.mjs> [--split dev|sealed|all] [--no-order] [--permute N] */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluate, loadCases, permutationTest } from "./harness.mjs";

const target = process.argv[2];
if (!target)
  throw Error("usage: node research/run.mjs <model.mjs> [--split dev|sealed|all] [--no-order] [--permute N]");
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const mod = await import(pathToFileURL(path.resolve(target)).href);
const cases = loadCases({ split: option("--split", "dev") });
const useOrder = !process.argv.includes("--no-order");
console.log(
  `${cases.length} cas, ${new Set(cases.map((c) => c.group)).size} groupes, ordre des picks ${useOrder ? "visible" : "cache"}`,
);
await evaluate(mod, { cases, useOrder });
const runs = Number(option("--permute", 0));
if (runs) {
  const test = await permutationTest(mod, { cases, runs, useOrder });
  console.log(
    `hasard mesure: moyenne ${(test.nullMean * 100).toFixed(1)}%, ecart-type ${(test.nullSd * 100).toFixed(1)}, max ${(test.nullMax * 100).toFixed(1)}% | reel ${(test.real * 100).toFixed(1)}% | p=${test.p.toFixed(3)}`,
  );
}
