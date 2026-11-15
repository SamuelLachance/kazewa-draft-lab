/**
 * Shared evaluation harness for models that predict the side Kazewa prefers
 * on a draft he has not judged.
 *
 * Protocol (fixed, do not tune): leave-one-group-out over data/kazewa-memory.json.
 * A group joins every case that shares a video or a professional series, so a
 * model never trains on another game of the series it is tested on.
 *
 * A model is a module exporting
 *   fit(train, resources, prepared) -> { score(draft, context) }
 * and optionally
 *   prepare(resources) -> anything label-free computed once (e.g. statistics
 *   from professional games). It never sees a verdict.
 *
 * `draft` is `{ blue: {top,jng,mid,bot,sup}, red: {...} }`. `context.later` is
 * either null or `{top,jng,mid,bot,sup}` giving, for each lane, the side that
 * locked its champion later (pick order). A positive score means the blue
 * composition is preferred. The harness antisymmetrises the score, so side
 * order cannot leak.
 *
 * `train` holds only cases outside the held-out group. Anything derived from
 * verdicts, reasons, champion reads or claims must be computed from `train`
 * inside `fit`. A test case reaches the model as compositions and pick order
 * only: no date, patch, team, result, reason or claim.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROLES = ["top", "jng", "mid", "bot", "sup"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flip = (side) => (side === "blue" ? "red" : "blue");
export const swap = (draft) => ({ blue: draft.red, red: draft.blue });
export const swapContext = (context) => ({
  ...context,
  later: context?.later
    ? Object.fromEntries(
        Object.entries(context.later).map(([role, side]) => [role, flip(side)]),
      )
    : null,
});

/** Deterministic split by group: about 30% of the groups are sealed. */
export const isSealedGroup = (group) => parseInt(group.slice(0, 4), 16) % 10 < 3;

export function loadCases({ split = "dev" } = {}) {
  const memory = JSON.parse(
    fs.readFileSync(path.join(root, "data", "kazewa-memory.json"), "utf8"),
  );
  return memory.cases
    .filter((c) => c.verdict.side !== "even")
    .filter((c) =>
      split === "all" ? true : split === "sealed" ? isSealedGroup(c.group) : !isSealedGroup(c.group),
    )
    .map((c) => ({
      id: c.id,
      group: c.group,
      blue: c.blue,
      red: c.red,
      later: c.later ?? null,
      label: c.verdict.side,
      confidence: c.verdict.confidence,
      timing: c.verdict.timing,
      reasons: c.reasons,
      reads: c.reads.map((r) => ({ champion: r.champion, side: r.side, read: r.read })),
      claims: c.claims ?? [],
    }));
}

export function loadResources() {
  const knowledge = JSON.parse(
    fs.readFileSync(path.join(root, "data", "knowledge.json"), "utf8"),
  );
  let proGames = null;
  return {
    knowledge,
    champions: Object.keys(knowledge.champions),
    /**
     * Professional games with a known winner, minus every game Kazewa judged.
     * Each: { id, league, year, date, patch, blue:{role:champion}, red:{...},
     * order:{blue:[5 picks in order],red:[...]}, bans, firstPick, winner }.
     */
    proGames() {
      if (proGames) return proGames;
      const file = path.join(root, ".cache", "oe-games.json");
      if (!fs.existsSync(file)) return (proGames = []);
      const memory = JSON.parse(
        fs.readFileSync(path.join(root, "data", "kazewa-memory.json"), "utf8"),
      );
      const judged = new Set(
        memory.cases.map((c) => c.match?.gameId).filter(Boolean),
      );
      proGames = JSON.parse(fs.readFileSync(file, "utf8")).filter(
        (g) => g.winner && !judged.has(g.id),
      );
      return proGames;
    },
  };
}

export const wilson = (k, n, z = 1.96) => {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
};

const credit = (r) =>
  r.score === 0 ? 0.5 : (r.score > 0 ? "blue" : "red") === r.label ? 1 : 0;
const rate = (list) => {
  const k = list.reduce((n, r) => n + credit(r), 0);
  const [low, high] = wilson(k, list.length);
  return {
    n: list.length,
    agreement: list.length ? k / list.length : null,
    low,
    high,
  };
};

/**
 * Leave-one-group-out. Ties count as half a success.
 * `useOrder: false` hides the pick order from the model (composition only).
 */
export async function evaluate(
  model,
  { cases = loadCases(), resources = loadResources(), quiet = false, useOrder = true, prepared } = {},
) {
  const fit = typeof model === "function" ? model : model.fit;
  const ready =
    prepared !== undefined
      ? prepared
      : typeof model?.prepare === "function"
        ? await model.prepare(resources)
        : undefined;
  const groups = [...new Set(cases.map((c) => c.group))].sort();
  const rows = [];
  for (const group of groups) {
    const train = cases.filter((c) => c.group !== group);
    const test = cases.filter((c) => c.group === group);
    const fitted = await fit(structuredClone(train), resources, ready);
    for (const c of test) {
      const draft = { blue: c.blue, red: c.red };
      const context = { later: useOrder ? c.later : null };
      const s =
        (fitted.score(draft, context) -
          fitted.score(swap(draft), swapContext(context))) /
        2;
      rows.push({
        id: c.id,
        group,
        label: c.label,
        timing: c.timing,
        confidence: c.confidence,
        hasOrder: Boolean(c.later),
        score: Number.isFinite(s) ? s : 0,
      });
    }
  }
  const sorted = [...rows].sort(
    (a, b) => Math.abs(b.score) - Math.abs(a.score),
  );
  const decided = rows.filter((r) => r.score !== 0);
  const report = {
    all: rate(rows),
    withOrder: rate(rows.filter((r) => r.hasOrder)),
    draftTiming: rate(rows.filter((r) => r.timing === "draft")),
    confident: rate(rows.filter((r) => r.confidence >= 2)),
    decidedOnly: rate(decided),
    coverage: rows.length ? decided.length / rows.length : 0,
    topHalfByMargin: rate(sorted.slice(0, Math.ceil(sorted.length / 2))),
    groups: groups.length,
    rows,
  };
  if (!quiet) {
    const pct = (r) =>
      r.n
        ? `${(r.agreement * 100).toFixed(1)}% (n=${r.n}, IC95 ${(r.low * 100).toFixed(0)}-${(r.high * 100).toFixed(0)})`
        : "n=0";
    console.log(
      `tous ${pct(report.all)} | avec ordre des picks ${pct(report.withOrder)} | phase de draft ${pct(report.draftTiming)} | conf>=2 ${pct(report.confident)} | moitie la plus nette ${pct(report.topHalfByMargin)} | tranches seulement ${pct(report.decidedOnly)} (couverture ${(report.coverage * 100).toFixed(0)}%)`,
    );
  }
  return report;
}

/**
 * Chance level of this harness for a given model: the labels are redrawn at
 * random and the whole leave-one-group-out is repeated. The spread is wider
 * than a binomial one (about 4 to 5 points here), so compare to it.
 */
export async function permutationTest(model, { cases = loadCases(), resources = loadResources(), runs = 30, useOrder = true, seed = 20261114 } = {}) {
  const prepared =
    typeof model?.prepare === "function" ? await model.prepare(resources) : undefined;
  const real = await evaluate(model, { cases, resources, quiet: true, useOrder, prepared });
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const values = [];
  for (let i = 0; i < runs; i++) {
    const shuffled = cases.map((c) => ({
      ...c,
      label: random() < 0.5 ? "blue" : "red",
      claims: [],
      reads: [],
      reasons: [],
    }));
    const r = await evaluate(model, { cases: shuffled, resources, quiet: true, useOrder, prepared });
    values.push(r.all.agreement);
  }
  values.sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const atLeast = values.filter((v) => v >= real.all.agreement).length;
  return {
    real: real.all.agreement,
    nullMean: mean,
    nullSd: sd,
    nullMax: values.at(-1),
    p: (atLeast + 1) / (runs + 1),
  };
}

export { fitLogistic } from "../scripts/lib/logistic.mjs";
