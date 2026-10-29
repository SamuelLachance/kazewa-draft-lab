import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

async function boundedJSON(fetchImpl, url, maxBytes = 2_000_000) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Data Dragon : HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Data Dragon : réponse vide");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes)
        throw new Error("Data Dragon : réponse trop volumineuse");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Exact official identifiers only. This updates asset names, not Kazewa profiles. */
export async function syncChampions({
  fetchImpl = fetch,
  patch,
  now = Date.now(),
} = {}) {
  if (patch === undefined) {
    const versions = await boundedJSON(fetchImpl, VERSIONS_URL, 200_000);
    if (!Array.isArray(versions) || typeof versions[0] !== "string")
      throw new Error("Data Dragon : liste de versions invalide");
    patch = versions[0];
  }
  if (!/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(patch))
    throw new Error("Data Dragon : version invalide");
  const sourceUrl = `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`;
  const payload = await boundedJSON(fetchImpl, sourceUrl);
  if (
    payload?.type !== "champion" ||
    !payload.data ||
    typeof payload.data !== "object"
  )
    throw new Error("Data Dragon : catalogue invalide");
  const champions = Object.values(payload.data)
    .map((champion) => {
      if (
        !champion ||
        typeof champion.id !== "string" ||
        !/^[A-Za-z][A-Za-z0-9]+$/.test(champion.id) ||
        typeof champion.key !== "string" ||
        !/^\d+$/.test(champion.key) ||
        typeof champion.name !== "string" ||
        champion.name.length > 60
      )
        throw new Error("Data Dragon : entrée champion invalide");
      return { id: champion.id, key: champion.key, name: champion.name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (
    champions.length < 100 ||
    champions.length > 300 ||
    new Set(champions.map((c) => c.id)).size !== champions.length ||
    new Set(champions.map((c) => c.key)).size !== champions.length
  )
    throw new Error("Data Dragon : catalogue incomplet ou contradictoire");
  return {
    version: 1,
    patch,
    sourceUrl,
    fetchedAt: new Date(now).toISOString(),
    champions,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const assets = await syncChampions({ patch: process.argv[2] });
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(
    path.join(ROOT, "data", "champion-assets.json"),
    JSON.stringify(assets, null, 2) + "\n",
  );
  console.log(
    `Data Dragon ${assets.patch} : ${assets.champions.length} identifiants officiels synchronisés.`,
  );
}
