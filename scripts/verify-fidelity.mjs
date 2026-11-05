import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(
  await readFile(path.join(root, "data", "evaluation.json"), "utf8"),
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
const broader = report.broader ?? {};
const percent = Number.isFinite(broader.agreement)
  ? `${(broader.agreement * 100).toFixed(1)} %`
  : "indisponible";
const meets =
  fresh &&
  broader.agreement >= 0.7 &&
  broader.coverage >= 0.8 &&
  broader.decided >= 57;
console.log(
  `Accord élargi : ${broader.correct ?? "—"}/${broader.decided ?? "—"} (${percent}), couverture ${Number.isFinite(broader.coverage) ? `${(broader.coverage * 100).toFixed(1)} %` : "—"}.`,
);
console.log(
  meets
    ? "Seuil de 70 % atteint. La publication n’est pas bloquée."
    : "Sous le seuil de 70 %, ou rapport périmé. La publication n’est pas bloquée.",
);
