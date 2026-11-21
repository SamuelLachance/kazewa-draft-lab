import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// The browser loads public/*.mjs, which import "./src/....mjs" from the same
// folder. A named import that the module no longer exports breaks the whole
// page at load time, and no other test would notice it.
const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = path.join(root, "public");

test("every named import of the browser code exists in the module it names", async () => {
  const files = (await readdir(publicDir)).filter((name) => name.endsWith(".mjs"));
  assert.ok(files.includes("app.mjs"));
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*["'](\.\/src\/[^"']+)["']/g;
  let checked = 0;
  for (const file of files) {
    const text = await readFile(path.join(publicDir, file), "utf8");
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[2];
      // "./src/x.mjs" in public/ is the project's src/x.mjs (the build copies it next to the page).
      const target = path.join(root, specifier.replace(/^\.\//, ""));
      const exported = await import(pathToFileURL(target).href);
      const names = match[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+as\s+/)[0].trim());
      for (const name of names) {
        checked += 1;
        assert.ok(name in exported, `${file} imports ${name} from ${specifier}, which does not export it`);
      }
    }
  }
  assert.ok(checked > 10, `only ${checked} imports were checked`);
});
