import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGate } from "./evaluate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(
  await readFile(path.join(root, "data", "evaluation.json"), "utf8"),
);
const benchmark = JSON.parse(
  await readFile(path.join(root, "data", "benchmark.json"), "utf8"),
);
let fresh = true;
for (const [key, name] of [
  ["engine", "src/engine.mjs"],
  ["knowledge", "data/knowledge.json"],
  ["benchmark", "data/benchmark.json"],
]) {
  const hash = createHash("sha256")
    .update(await readFile(path.join(root, name)))
    .digest("hex");
  if (report.sourceHashes?.[key] !== hash) {
    console.error(`Rapport périmé : ${name}. Relancer npm run evaluate.`);
    fresh = false;
  }
}
// Fixed minimums cannot be weakened by changing only the generated report.
const gate = evaluateGate(report.primary, {
  minimumAgreement: Math.max(0.85, benchmark.gate?.minimumAgreement || 0),
  minimumCoverage: Math.max(0.8, benchmark.gate?.minimumCoverage || 0),
  minimumCases: Math.max(50, benchmark.gate?.minimumCases || 0),
  minimumVideos: Math.max(10, benchmark.gate?.minimumVideos || 0),
});
if (!fresh || !gate.passed) {
  console.error(
    `Publication bloquée : fidélité non validée (${gate.reasons.join(", ") || "rapport périmé"}).`,
  );
  console.error(
    "Le site peut être construit et examiné localement. La validation prospective et un corpus strict plus large restent nécessaires.",
  );
  process.exitCode = 1;
} else
  console.log(
    "Seuil rétrospectif de fidélité atteint ; une validation prospective reste nécessaire.",
  );
