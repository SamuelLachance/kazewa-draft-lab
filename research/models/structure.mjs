/**
 * Angle "structure": does the shape of the two compositions predict the side
 * Kazewa prefers? Composition only, the pick order is never read.
 *
 * Features (all label-free functions of the ten champions and their roles):
 *   flags   18 profile flags of knowledge.json, summed per team
 *   inter   team-level interactions: catch vs immobile, engage vs disengage,
 *           frontline with sustained damage, scaling with protection, range...
 *   engine  team aggregates published by the site calculator (frontline depth,
 *           exposure, win conditions, identities)
 *   signal  ids of the structural rules the site calculator fires, signed by
 *           the side the rule fired on (`subject`). Its tuned weights, its
 *           READING signs and its score are ignored.
 *   named   rules written from a named statement of a given video (pairs,
 *           lane counters, reading laws). Kept out of the delivered model:
 *           they were authored from the very videos that are being tested.
 *
 * Every weight, scale and neighbour is computed from `train` inside `fit`.
 * Dependency-free: plain arithmetic, runs in the browser.
 */
import { analyzeDraft } from "../../src/engine.mjs";
import { fitLogistic } from "../../scripts/lib/logistic.mjs";

const ROLES = ["top", "jng", "mid", "bot", "sup"];
const FLAGS = [
  "catch", "engage", "follow_up", "immobile", "dashs", "anti_dash",
  "frontline", "peel", "disengage", "scaling", "snowball_early", "bridge",
  "dps", "burst", "global", "split", "poke", "zone",
];
const IDENTITIES = [
  "catch", "engage / wombo", "poke protégé", "protection du carry",
  "side lane / global", "contrôle des objectifs", "snowball early",
];
const isNamed = (id) =>
  id.startsWith("named_") ||
  ["hook_into_milio", "yone_into_aatrox", "sion_into_aatrox", "renekton_taliyah"].includes(id);

/**
 * Variants evaluated during the challenge (see research/notes/structure.md).
 * The delivered one is DEFAULT_VARIANT. The environment switch only exists so
 * the other variants can be reproduced from the command line.
 */
const VARIANTS = {
  "lin-inter": { kind: "linear", blocks: ["inter"] },
  "lin-struct": { kind: "linear", blocks: ["flags", "inter", "engine"] },
  "lin-signals": { kind: "linear", blocks: ["signal"] },
  "lin-all": { kind: "linear", blocks: ["flags", "inter", "engine", "signal"] },
  "knn-team": { kind: "knn-team" },
  "knn-diff": { kind: "knn-diff", blocks: ["flags", "inter", "engine", "signal"] },
  "lin-named": { kind: "linear", blocks: ["signal", "named"] },
};
const DEFAULT_VARIANT = "lin-inter";
const LAMBDA = 100; // strong ridge: about the Fisher information of one scaled feature
const K = 15;
const MIN_SUPPORT = 8;

const variantName = () =>
  globalThis.process?.env?.STRUCTURE_VARIANT || DEFAULT_VARIANT;

function teamSummary(team, champions) {
  const list = ROLES.map((role) => ({ ...(champions[team[role]] ?? {}), role }));
  const total = (key, rows = list) =>
    rows.reduce((n, p) => n + (Number(p[key]) || 0), 0);
  const t = Object.fromEntries(FLAGS.map((flag) => [flag, total(flag)]));
  t.dpsCore = total("dps", list.filter((p) => p.role !== "sup"));
  t.exposed = total("immobile", list.filter((p) => !(Number(p.frontline) > 0)));
  t.protection = t.peel + t.disengage;
  t.access = t.catch + t.engage;
  return t;
}

const interactions = (t, o) => ({
  catch_vs_immobile: t.access * o.exposed,
  engage_vs_disengage: t.engage * o.protection,
  frontline_with_dps: Math.min(t.frontline, t.dpsCore),
  scaling_with_protection: t.scaling * t.protection,
  scaling_with_frontline: t.scaling * t.frontline,
  poke_vs_reach: t.poke * o.access,
  poke_with_protection: t.poke * t.protection,
  dash_vs_antidash: t.dashs * o.anti_dash,
  early_vs_scaling: t.snowball_early * o.scaling,
  split_with_global: t.split * t.global,
  burst_vs_frontline: t.burst * o.frontline,
  dps_vs_frontline: t.dpsCore * o.frontline,
  catch_with_followup: t.access * t.follow_up,
  immobile_with_protection: t.exposed * t.protection,
});

const cache = new Map();
/** Antisymmetric features by block, plus the two raw team vectors. */
function describe(draft, knowledge) {
  const key = ROLES.map((r) => draft.blue[r]).join("|") + "/" + ROLES.map((r) => draft.red[r]).join("|");
  const known = cache.get(key);
  if (known) return known;
  const blue = teamSummary(draft.blue, knowledge.champions);
  const red = teamSummary(draft.red, knowledge.champions);
  const blocks = { flags: {}, inter: {}, engine: {}, signal: {}, named: {} };
  for (const flag of FLAGS) blocks.flags[flag] = blue[flag] - red[flag];
  const ib = interactions(blue, red);
  const ir = interactions(red, blue);
  for (const name of Object.keys(ib)) blocks.inter[name] = ib[name] - ir[name];
  const analysis = analyzeDraft(draft, knowledge);
  if (analysis.status === "complete") {
    const b = analysis.teams.blue;
    const r = analysis.teams.red;
    for (const name of ["frontlineDepth", "dps", "immobileCarries", "exposure", "winConditions"])
      blocks.engine[name] = b[name] - r[name];
    blocks.engine.effectiveFrontline = Number(b.effectiveFrontline) - Number(r.effectiveFrontline);
    for (const identity of IDENTITIES)
      blocks.engine["identity:" + identity] =
        Number(b.identities.includes(identity)) - Number(r.identities.includes(identity));
    for (const signal of analysis.signals) {
      const block = isNamed(signal.id) ? blocks.named : blocks.signal;
      block[signal.id] = (block[signal.id] ?? 0) + (signal.subject === "blue" ? 1 : -1);
    }
  }
  const described = {
    blocks,
    teams: { blue: FLAGS.map((f) => blue[f]), red: FLAGS.map((f) => red[f]) },
  };
  cache.set(key, described);
  return described;
}

const flatten = (described, blockNames) => {
  const out = {};
  for (const block of blockNames)
    for (const [name, value] of Object.entries(described.blocks[block]))
      if (value) out[block + ":" + name] = value;
  return out;
};

/** Feature index and scales from the training rows only. */
function buildSpace(rows) {
  const support = new Map();
  const square = new Map();
  for (const row of rows)
    for (const [name, value] of Object.entries(row)) {
      support.set(name, (support.get(name) ?? 0) + 1);
      square.set(name, (square.get(name) ?? 0) + value * value);
    }
  const names = [...support.keys()].filter((n) => support.get(n) >= MIN_SUPPORT).sort();
  // Antisymmetric features have zero mean once both orientations are counted.
  const scale = names.map((n) => Math.sqrt(square.get(n) / rows.length) || 1);
  const vector = (row) => names.map((n, j) => (row[n] ?? 0) / scale[j]);
  return { names, vector };
}

function fitLinear(train, knowledge, blocks) {
  const rows = train.map((c) => flatten(describe(c, knowledge), blocks));
  const space = buildSpace(rows);
  const X = [];
  const y = [];
  rows.forEach((row, i) => {
    const x = space.vector(row);
    X.push(x);
    y.push(train[i].label === "blue");
    X.push(x.map((v) => -v));
    y.push(train[i].label !== "blue");
  });
  const w = space.names.length ? fitLogistic(X, y, { lambda: LAMBDA }) : [];
  return {
    weights: Object.fromEntries(space.names.map((n, j) => [n, w[j]])),
    score(draft) {
      const x = space.vector(flatten(describe(draft, knowledge), blocks));
      return x.reduce((n, v, j) => n + v * w[j], 0);
    },
  };
}

/** Nearest earlier drafts by cosine in the antisymmetric feature space. */
function fitKnnDiff(train, knowledge, blocks) {
  const rows = train.map((c) => flatten(describe(c, knowledge), blocks));
  const space = buildSpace(rows);
  const unit = (x) => {
    const norm = Math.sqrt(x.reduce((n, v) => n + v * v, 0)) || 1;
    return x.map((v) => v / norm);
  };
  const points = rows.map((row, i) => ({
    x: unit(space.vector(row)),
    sign: train[i].label === "blue" ? 1 : -1,
  }));
  return {
    score(draft) {
      const x = unit(space.vector(flatten(describe(draft, knowledge), blocks)));
      // A mirrored earlier draft is the same draft with the opposite label,
      // so |cos| ranks the neighbours and the sign of cos orients the vote.
      const votes = points
        .map((p) => p.sign * p.x.reduce((n, v, j) => n + v * x[j], 0))
        .sort((a, b) => Math.abs(b) - Math.abs(a))
        .slice(0, K);
      return votes.reduce((n, v) => n + v, 0);
    },
  };
}

/** Nearest earlier drafts as a pair of team shapes (18 flags per team). */
function fitKnnTeam(train, knowledge) {
  const described = train.map((c) => describe(c, knowledge));
  const d = FLAGS.length;
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  const all = described.flatMap((e) => [e.teams.blue, e.teams.red]);
  for (const t of all) for (let j = 0; j < d; j++) mean[j] += t[j] / all.length;
  for (const t of all) for (let j = 0; j < d; j++) sd[j] += (t[j] - mean[j]) ** 2 / all.length;
  const z = (t) => t.map((v, j) => (v - mean[j]) / (Math.sqrt(sd[j]) || 1));
  const points = described.map((e, i) => ({
    blue: z(e.teams.blue),
    red: z(e.teams.red),
    sign: train[i].label === "blue" ? 1 : -1,
  }));
  const dist = (a, b) => a.reduce((n, v, j) => n + (v - b[j]) ** 2, 0);
  return {
    score(draft) {
      const e = describe(draft, knowledge);
      const blue = z(e.teams.blue);
      const red = z(e.teams.red);
      const neighbours = [];
      for (const p of points) {
        neighbours.push({ d: dist(blue, p.blue) + dist(red, p.red), sign: p.sign });
        neighbours.push({ d: dist(blue, p.red) + dist(red, p.blue), sign: -p.sign });
      }
      neighbours.sort((a, b) => a.d - b.d);
      return neighbours.slice(0, K).reduce((n, p) => n + p.sign / (1 + p.d), 0);
    },
  };
}

export function fit(train, resources) {
  const variant = VARIANTS[variantName()];
  if (!variant) throw Error("unknown variant " + variantName());
  const knowledge = resources.knowledge;
  if (variant.kind === "knn-team") return fitKnnTeam(train, knowledge);
  if (variant.kind === "knn-diff") return fitKnnDiff(train, knowledge, variant.blocks);
  return fitLinear(train, knowledge, variant.blocks);
}
