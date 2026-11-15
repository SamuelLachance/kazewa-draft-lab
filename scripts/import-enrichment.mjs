/**
 * Validates the French enrichment batches and stores them next to the memory.
 *
 *   .cache/enrich/out_*.json  -> data/kazewa-enrichment.json  (keyed by case id)
 *   .cache/cards/out_*.json   -> data/champion-cards.json     (keyed by champion)
 *
 * A batch entry that does not line up with its source case is reported and
 * skipped, never patched silently.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = ["top", "jng", "mid", "bot", "sup"];
export const CLAIM_TAGS = [
  "frontline",
  "damage",
  "range",
  "engage",
  "disengage_peel",
  "answer",
  "identity_clear",
  "identity_matchup",
  "scaling",
  "early",
  "lane",
  "jungle",
  "synergy",
  "meta_strong",
  "meta_weak",
  "pick_order",
  "players_team",
  "other",
];
// Card headings the translation left in English. The established jargon stays.
const IDENTITY_FR = {
  "Reset comps": "Compos à reset",
  "Weak-side bot": "Bot en weak side",
  "Frontline-themed drafts": "Drafts à thème frontline",
  "Anti-assassin / pick denial": "Anti-assassin / refus de pick",
  "Tempo (priority)": "Tempo (priorité)",
  "Teamfight (wombo-ish)": "Teamfight (type wombo)",
  "Tempo / map pressure": "Tempo / pression de map",
  "Tempo / lane-swap meta": "Tempo / méta lane swap",
  "Full engage (light)": "Full engage (léger)",
  "Hyper carry/protect (solo queue)": "Hyper carry/protect (soloQ)",
  "Teamfight vs engage": "Teamfight contre engage",
  "Catch / pick (blue)": "Catch / pick",
  "Catch (follow-up only)": "Catch (en follow-up seulement)",
  "Global/ult bridge": "Global / pont par l’ultime",
  "Anti-strategy": "Anti-stratégie",
  "Catch / chain-CC": "Catch / chaîne de CC",
  "Nash/objective (Drake)": "Nash/objective (dragons)",
  "Teamfight engage": "Teamfight d’engage",
  "Teamfight anti-tank": "Teamfight anti-tank",
  "Hyper carry (top)": "Hyper carry (top)",
  "Frontline/tank-buster": "Frontline / anti-tank",
  "Global / anti-split": "Global / anti-split",
};
const text = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const readBatches = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => /^out_\d+\.json$/.test(name))
        .sort()
        .map((name) => ({
          name,
          rows: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
        }))
    : [];

export function validateEnrichment(entry, source) {
  const problems = [];
  const roster = new Set(
    ["blue", "red"].flatMap((side) => ROLES.map((role) => source[side][role])),
  );
  const reasonsFr = Array.isArray(entry.reasons_fr)
    ? entry.reasons_fr.map(text)
    : [];
  if (reasonsFr.length !== source.reasons.length || reasonsFr.some((r) => !r))
    problems.push(
      `reasons_fr: ${reasonsFr.length} pour ${source.reasons.length} raisons`,
    );
  const readsFr = Array.isArray(entry.reads_fr) ? entry.reads_fr : [];
  const readsOk =
    readsFr.length === source.reads.length &&
    readsFr.every(
      (read, i) => read?.champion === source.reads[i].champion && text(read.read_fr),
    );
  if (!readsOk) problems.push("reads_fr ne suit pas les lectures sources");
  const claims = [];
  for (const claim of Array.isArray(entry.claims) ? entry.claims : []) {
    const detail = text(claim?.detail_fr);
    if (!CLAIM_TAGS.includes(claim?.tag) || !["blue", "red"].includes(claim?.favours) || !detail) {
      problems.push(`argument rejeté: ${JSON.stringify(claim).slice(0, 90)}`);
      continue;
    }
    const champions = [
      ...new Set((claim.champions ?? []).filter((name) => roster.has(name))),
    ];
    claims.push({
      tag: claim.tag,
      favours: claim.favours,
      champions,
      role: ROLES.includes(claim.role) ? claim.role : "",
      transferable: claim.transferable === true,
      detailFr: detail,
    });
  }
  return {
    problems,
    value: {
      labelFr: text(entry.label_fr),
      reasonsFr:
        reasonsFr.length === source.reasons.length && !reasonsFr.some((r) => !r)
          ? reasonsFr
          : null,
      readsFr: readsOk ? readsFr.map((read) => text(read.read_fr)) : null,
      claims,
    },
  };
}

function importCases() {
  const memory = JSON.parse(
    fs.readFileSync(path.join(root, "data", "kazewa-memory.json"), "utf8"),
  );
  const out = {};
  const report = { cases: 0, claims: 0, problems: [] };
  const dir = path.join(root, ".cache", "enrich");
  // Later batches replace earlier ones for the same case.
  for (const batch of readBatches(dir)) {
    // The enrichment is tied to the exact English text the translator was given.
    const given = new Map(
      JSON.parse(
        fs.readFileSync(path.join(dir, batch.name.replace("out_", "in_")), "utf8"),
      ).map((c) => [c.id, c]),
    );
    for (const entry of batch.rows) {
      const source = given.get(entry?.id);
      if (!source) {
        report.problems.push(`${batch.name}: id inconnu ${entry?.id}`);
        continue;
      }
      const { problems, value } = validateEnrichment(entry, source);
      for (const problem of problems)
        report.problems.push(`${batch.name} ${entry.id}: ${problem}`);
      value.of = {
        reasons: source.reasons,
        reads: source.reads.map((r) => r.read),
        blue: ROLES.map((role) => source.blue[role]),
        red: ROLES.map((role) => source.red[role]),
        side: source.kazewa?.side ?? null,
      };
      if (!out[entry.id]) report.cases++;
      out[entry.id] = value;
      report.claims += value.claims.length;
    }
  }
  if (!report.cases)
    throw Error(`Aucun lot dans ${dir} : data/kazewa-enrichment.json n’est pas réécrit.`);
  const textOf = (c) =>
    JSON.stringify({
      reasons: c.reasons,
      reads: c.reads.map((r) => r.read),
      blue: ROLES.map((role) => c.blue[role]),
      red: ROLES.map((role) => c.red[role]),
      side: c.verdict.side,
    });
  const translated = new Set(Object.values(out).map((v) => JSON.stringify(v.of)));
  report.missing = memory.cases
    .filter((c) => (c.reasons.length || c.reads.length) && !translated.has(textOf(c)))
    .map((c) => c.id);
  fs.writeFileSync(
    path.join(root, "data", "kazewa-enrichment.json"),
    JSON.stringify(out, null, 1) + "\n",
  );
  return report;
}

function importCards() {
  const knowledge = JSON.parse(
    fs.readFileSync(path.join(root, "data", "knowledge.json"), "utf8"),
  );
  const out = {};
  const problems = [];
  for (const batch of readBatches(path.join(root, ".cache", "cards"))) {
    for (let card of batch.rows) {
      if (!knowledge.champions[card?.champion]) {
        problems.push(`${batch.name}: champion inconnu ${card?.champion}`);
        continue;
      }
      const sources = Number(card.sources) || 0;
      const identities = Array.isArray(card.identities_fr) ? card.identities_fr : [];
      // A champion he never commented gets a plain statement, not pipeline notes.
      const silent = sources === 0 && !identities.length;
      const tag = silent ? "Jamais commenté par Kazewa" : text(card.tag_fr);
      const job = silent
        ? `Kazewa n’a jamais commenté ${card.champion} dans les vidéos du corpus.`
        : text(card.job_fr).replace("Furia/IXQ", "Furia");
      if (silent) card = { ...card, draft_fr: "" };
      if (!tag || !job) problems.push(`${batch.name} ${card.champion}: tag ou rôle vide`);
      out[card.champion] = {
        sources,
        confidence: ["high", "medium", "low", "derived"].includes(card.confidence)
          ? card.confidence
          : "derived",
        tag,
        job,
        identities: identities
          .map((item) => ({
            identity: IDENTITY_FR[text(item?.identity)] ?? text(item?.identity),
            text: text(item?.text_fr),
          }))
          .filter((item) => item.identity && item.text),
        good: text(card.good_fr),
        bad: text(card.bad_fr),
        tempo: text(card.tempo_fr),
        draft: text(card.draft_fr),
      };
    }
  }
  if (!Object.keys(out).length)
    throw Error("Aucune fiche à importer : data/champion-cards.json n’est pas réécrit.");
  const missing = Object.keys(knowledge.champions).filter((name) => !out[name]);
  const sorted = Object.fromEntries(
    Object.keys(out)
      .sort((a, b) => a.localeCompare(b, "en"))
      .map((name) => [name, out[name]]),
  );
  fs.writeFileSync(
    path.join(root, "data", "champion-cards.json"),
    JSON.stringify(sorted, null, 1) + "\n",
  );
  return { cards: Object.keys(out).length, missing, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const what = process.argv[2] ?? "all";
  if (what === "all" || what === "cases") {
    const report = importCases();
    console.log(
      `cas enrichis: ${report.cases} | arguments: ${report.claims} | manquants: ${report.missing.length} | problèmes: ${report.problems.length}`,
    );
    for (const problem of report.problems.slice(0, 40)) console.log("  -", problem);
    if (report.missing.length) console.log("  manquants:", report.missing.join(" "));
  }
  if (what === "all" || what === "cards") {
    const report = importCards();
    console.log(
      `fiches champion: ${report.cards} | manquantes: ${report.missing.length} | problèmes: ${report.problems.length}`,
    );
    for (const problem of report.problems.slice(0, 40)) console.log("  -", problem);
    if (report.missing.length) console.log("  manquantes:", report.missing.join(", "));
  }
}
