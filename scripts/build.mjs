import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEndpoint } from "../src/presentation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "dist");
// Only the owned build directory can be replaced, regardless of current shell directory.
if (path.dirname(output) !== root || path.basename(output) !== "dist")
  throw Error("Dossier de construction inattendu.");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "public"), output, { recursive: true });
await cp(path.join(root, "src"), path.join(output, "src"), { recursive: true });
await mkdir(path.join(output, "data"), { recursive: true });
for (const name of [
  "knowledge.json",
  "rules.json",
  "benchmark.json",
  "evaluation.json",
  "distillation.json",
  "champion-assets.json",
]) {
  const content = await readFile(path.join(root, "data", name), "utf8");
  JSON.parse(content);
  await writeFile(path.join(output, "data", name), content);
}
const config = JSON.parse(
  await readFile(path.join(root, "public", "config.json"), "utf8"),
);
if (process.env.LIVE_API_URL)
  config.liveApiUrl = validateEndpoint(process.env.LIVE_API_URL);
await writeFile(
  path.join(output, "config.json"),
  JSON.stringify(config, null, 2) + "\n",
);
await writeFile(path.join(output, ".nojekyll"), "");
console.log(
  "Site statique construit dans dist/ ; compatible avec les sous-chemins GitHub Pages.",
);
