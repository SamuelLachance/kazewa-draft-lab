/**
 * Measures what the site can honestly claim, then freezes the model it ships.
 *
 *   data/kazewa-memory.json  ->  data/model.json + data/evaluation.json
 *
 * Two different questions, never mixed:
 *  - a draft Kazewa judged: the site returns his verdict (checked here, 100% by
 *    construction, it is a lookup);
 *  - a draft he did not judge: agreement is measured leave-one-group-out, so a
 *    model is always scored on series and videos it never trained on.
 *
 * Needs no corpus and no network: it runs in CI from the committed data.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeDraft, ROLES } from "../src/engine.mjs";
import { applicableArguments, indexMemory } from "../src/memory.mjs";
import { argumentLean, judgeDraft } from "../src/verdict.mjs";
import { fitLogistic } from "./lib/logistic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));
// Hashes ignore line endings, so a Windows checkout and CI agree.
export const contentHash = (text) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
const hash = (relative) =>
  contentHash(fs.readFileSync(path.join(root, relative), "utf8"));

/** Binomial interval. It ignores that drafts of one group are not independent. */
export const wilson = (k, n, z = 1.96) => {
  if (!n) return { low: 0, high: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: (c - m) / d, high: (c + m) / d };
};
export const rate = (agree, n) => ({
  n,
  agree,
  agreement: n ? agree / n : null,
  ...wilson(agree, n),
});

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 95% interval that respects the groups: whole groups are redrawn with
 * replacement, because the drafts of one video stand or fall together.
 */
export function groupInterval(rows, { draws = 2000, seed = 20261114 } = {}) {
  const byGroup = new Map();
  for (const row of rows) {
    const g = byGroup.get(row.group) ?? { n: 0, credit: 0 };
    g.n++;
    g.credit += row.credit;
    byGroup.set(row.group, g);
  }
  const groups = [...byGroup.values()];
  if (!groups.length) return { low: 0, high: 0 };
  const random = generator(seed);
  const values = [];
  for (let i = 0; i < draws; i++) {
    let n = 0;
    let credit = 0;
    for (let j = 0; j < groups.length; j++) {
      const g = groups[Math.floor(random() * groups.length)];
      n += g.n;
      credit += g.credit;
    }
    values.push(credit / n);
  }
  values.sort((a, b) => a - b);
  return {
    low: values[Math.floor(draws * 0.025)],
    high: values[Math.ceil(draws * 0.975) - 1],
  };
}
const grouped = (rows) => {
  const agree = rows.reduce((total, row) => total + row.credit, 0);
  return {
    n: rows.length,
    agree,
    agreement: rows.length ? agree / rows.length : null,
    ...groupInterval(rows),
    interval: "group bootstrap",
  };
};

/* ---------------- pick-order model ---------------- */
const orderFeatures = (later) =>
  ROLES.map((role) => (later[role] === "blue" ? 1 : -1));
export const PROCESS_LAMBDA = 2;

export function fitProcess(cases) {
  const X = [];
  const y = [];
  for (const c of cases) {
    if (!c.later || c.verdict.side === "even") continue;
    const x = orderFeatures(c.later);
    X.push(x);
    y.push(c.verdict.side === "blue");
    // The mirrored draft is the same judgement seen from the other side.
    X.push(x.map((v) => -v));
    y.push(c.verdict.side !== "blue");
  }
  const w = fitLogistic(X, y, { lambda: PROCESS_LAMBDA });
  return Object.fromEntries(
    ROLES.map((role, i) => [role, Math.round(w[i] * 10000) / 10000]),
  );
}

const processScore = (weights, later) =>
  orderFeatures(later).reduce((n, v, i) => n + v * weights[ROLES[i]], 0);
const usableCases = (cases) =>
  cases.filter((c) => c.later && c.verdict.side !== "even");

/**
 * Leave-one-group-out. Each held-out draft gets two answers fitted on the
 * other groups only: the pick-order model, and the side those other groups
 * prefer most often (a rule with no model, the bar to clear).
 */
export function crossValidate(cases, labelOf = (c) => c.verdict.side) {
  const usable = usableCases(cases);
  const groups = [...new Set(usable.map((c) => c.group))];
  const rows = [];
  for (const group of groups) {
    const train = usable
      .filter((c) => c.group !== group)
      .map((c) => ({ ...c, verdict: { side: labelOf(c) } }));
    const weights = fitProcess(train);
    const blue = train.filter((c) => c.verdict.side === "blue").length;
    const majority = blue * 2 === train.length ? null : blue * 2 > train.length ? "blue" : "red";
    for (const c of usable.filter((x) => x.group === group)) {
      const label = labelOf(c);
      const s = processScore(weights, c.later);
      rows.push({
        id: c.id,
        group,
        side: s === 0 ? null : s > 0 ? "blue" : "red",
        credit: s === 0 ? 0.5 : (s > 0 ? "blue" : "red") === label ? 1 : 0,
        sideCredit: majority === null ? 0.5 : majority === label ? 1 : 0,
        majority,
      });
    }
  }
  return { rows, groups: groups.length };
}

/**
 * His own arguments, with no fitting at all. For each judged draft, only the
 * arguments he gave in OTHER groups are kept; the side most of them favour is
 * compared with his verdict. `site` is the memory as the site loads it, so
 * the measure uses exactly the arguments a visitor sees.
 */
export function crossValidateArguments(cases, site) {
  const shown = new Map((site?.cases ?? []).map((c) => [c.id, c]));
  const usable = cases
    .filter((c) => shown.has(c.id))
    .map((c) => ({ ...shown.get(c.id), group: c.group }));
  const groups = [...new Set(usable.map((c) => c.group))];
  const rows = [];
  for (const group of groups) {
    const index = indexMemory({ cases: usable.filter((c) => c.group !== group) });
    for (const c of usable.filter((x) => x.group === group)) {
      if (c.verdict.side === "even") continue;
      const lean = argumentLean(
        applicableArguments({ blue: c.blue, red: c.red }, index, { limit: Infinity }),
      );
      rows.push({
        id: c.id,
        group,
        side: lean.side === "even" ? null : lean.side,
        credit: lean.side === "even" ? null : lean.side === c.verdict.side ? 1 : 0,
      });
    }
  }
  return rows;
}

/** Kept for the tests: agreement of the pick-order model alone. */
export function crossValidateProcess(cases, labelOf) {
  const { rows, groups } = crossValidate(cases, labelOf);
  return { agree: rows.reduce((n, r) => n + r.credit, 0), n: rows.length, groups };
}

/** Chance level of the same procedure: verdicts redrawn as coin flips, everything refitted. */
export function chanceLevel(cases, runs = 200, seed = 20261114) {
  const random = generator(seed);
  const real = crossValidateProcess(cases);
  const values = [];
  for (let i = 0; i < runs; i++) {
    const labels = new Map(cases.map((c) => [c.id, random() < 0.5 ? "blue" : "red"]));
    const r = crossValidateProcess(cases, (c) => labels.get(c.id));
    values.push(r.agree / r.n);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
  );
  const observed = real.agree / real.n;
  return {
    runs,
    mean,
    sd,
    p: (values.filter((v) => v >= observed).length + 1) / (runs + 1),
  };
}

/** Exact two-sided sign test on the drafts where two answers differ. */
export function signTest(better, worse) {
  const n = better + worse;
  if (!n) return 1;
  const k = Math.min(better, worse);
  let tail = 0;
  let term = 0.5 ** n;
  for (let i = 0; i <= k; i++) {
    tail += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}

export function buildReport(memory, knowledge, tuning, { now = new Date(), site = null } = {}) {
  const cases = memory.cases;
  const decided = cases.filter((c) => c.verdict.side !== "even");

  /* 1. Judged drafts: the lookup returns his verdict in both orientations. */
  const weights = fitProcess(cases);
  const index = indexMemory(memory);
  const lookup = { knowledge, memory: index, model: { process: { weights } } };
  let recalled = 0;
  for (const c of decided) {
    const straight = judgeDraft({ blue: c.blue, red: c.red }, lookup);
    const mirrored = judgeDraft({ blue: c.red, red: c.blue }, lookup);
    const other = c.verdict.side === "blue" ? "red" : "blue";
    if (
      straight.source === "memory" &&
      straight.winner === c.verdict.side &&
      mirrored.source === "memory" &&
      mirrored.winner === other
    )
      recalled++;
  }

  /* 2. Structural calculator on drafts it was not tuned on. */
  const tunedFingerprints = new Set(tuning?.fingerprints ?? []);
  const tunedGames = new Set(tuning?.sourceGames ?? []);
  const isTuned = (c) =>
    tunedFingerprints.has(c.fingerprint) ||
    (c.evidence ?? []).some((e) => tunedGames.has(String(e.source).split("#")[1]));
  const calc = { tuned: [0, 0], untuned: [], abstained: 0 };
  for (const c of decided) {
    const result = analyzeDraft({ blue: c.blue, red: c.red }, knowledge);
    const silent = result.status !== "complete" || result.winner === "even";
    if (isTuned(c)) {
      if (silent) continue;
      calc.tuned[1]++;
      if (result.winner === c.verdict.side) calc.tuned[0]++;
    } else if (silent) calc.abstained++;
    else
      calc.untuned.push({
        group: c.group,
        credit: result.winner === c.verdict.side ? 1 : 0,
      });
  }

  /* 3. Pick-order model on held-out groups, next to a rule with no model. */
  const cv = crossValidate(cases);
  const chance = chanceLevel(cases);
  const pickOrder = grouped(cv.rows);
  const sideRows = cv.rows.map((row) => ({ group: row.group, credit: row.sideCredit }));
  const majoritySides = cv.rows.map((row) => row.majority);
  const sideOnly = {
    ...grouped(sideRows),
    side: majoritySides.filter((s) => s === "red").length * 2 >= majoritySides.length ? "red" : "blue",
  };
  const better = cv.rows.filter((r) => r.credit > r.sideCredit).length;
  const worse = cv.rows.filter((r) => r.credit < r.sideCredit).length;

  /* 3b. His arguments from other groups, alone and next to the pick order. */
  const said = site ? crossValidateArguments(cases, site) : [];
  const saidDecided = said.filter((row) => row.side);
  const orderById = new Map(cv.rows.map((row) => [row.id, row]));
  const together = saidDecided
    .map((row) => ({ said: row, order: orderById.get(row.id) }))
    .filter((pair) => pair.order?.side);
  const agreeing = together.filter((pair) => pair.said.side === pair.order.side);
  const opposed = together.filter((pair) => pair.said.side !== pair.order.side);
  const argumentsReport = site
    ? {
        ...grouped(saidDecided),
        coverage: said.length ? saidDecided.length / said.length : 0,
        judged: said.length,
        withPickOrder: {
          sameSide: grouped(agreeing.map((pair) => pair.said)),
          oppositeSides: {
            n: opposed.length,
            argumentsRight: opposed.filter((pair) => pair.said.credit === 1).length,
          },
        },
        note: "No fitting. For each judged draft, the arguments he gave in other groups that still apply (same champions, same relation, same roles) are counted per side; the side with more is compared with his verdict. Drafts with no applicable argument or a tie are not counted (coverage).",
      }
    : null;

  /* 4. Context: how often the real winner matches his verdict. */
  const known = decided.filter((c) => c.winner);
  const follows = known.filter((c) => c.winner === c.verdict.side).length;

  const neverSeen = { ...grouped(calc.untuned), abstained: calc.abstained };
  const evaluation = {
    version: "2.1.0",
    evaluatedAt: now.toISOString(),
    memory: {
      cases: cases.length,
      decided: decided.length,
      undecided: cases.length - decided.length,
      rosterVerified: cases.filter((c) => c.rosterVerified).length,
      videos: new Set(cases.flatMap((c) => c.sources.map((s) => s.video))).size,
      byTiming: Object.fromEntries(
        ["draft", "review", "late"].map((t) => [
          t,
          decided.filter((c) => c.verdict.timing === t).length,
        ]),
      ),
      selfRecall: rate(recalled, decided.length),
      note: "A judged draft is answered by lookup. This 100% is a property of the lookup, not a measure of a model.",
    },
    unseen: {
      protocol:
        "Leave-one-group-out. A group joins every draft that shares a video or a professional series. Ties count as half. Intervals redraw whole groups.",
      groups: cv.groups,
      pickOrder: {
        ...pickOrder,
        chance,
        sideOnly,
        overSideOnly: {
          modelRightRuleWrong: better,
          ruleRightModelWrong: worse,
          p: signTest(better, worse),
          note: "Drafts where the pick-order model and the always-same-side rule disagree. Exact sign test.",
        },
        note: "Only input: for each lane, the side that locked its champion later. Fitted on the other groups, scored on the held-out group. 'chance' redraws the verdicts as coin flips; 'sideOnly' always answers the side the other groups prefer most often.",
      },
      arguments: argumentsReport,
      structuralCalculator: {
        tunedOn: rate(calc.tuned[0], calc.tuned[1]),
        neverSeen,
        note: "The calculator's weights were set against the 'tunedOn' drafts. Only 'neverSeen' says how it follows him elsewhere. It is the composition-only figure the site shows.",
      },
    },
    reference: {
      realWinnerMatchesVerdict: rate(follows, known.length),
      note: "Share of judged drafts where the team he preferred won the game. Many reviews were recorded knowing the result.",
    },
    limitations: [
      "His verdicts lean on pick order, bans, players, team form and the meta of the day. Ten champions do not carry that.",
      "The pick-order figure rests on fewer than two hundred drafts, it was measured on the corpus the idea came from, and part of it is the map side: the side that picks last is also the side he prefers most often.",
      "The arguments figure counts what he said in other videos. Teams that keep drafting the same pairs and that he keeps preferring can inflate it; on teams and patches he has not commented it may be lower.",
      "Review and late opinions can know the result of the game. They are kept, with their timing shown.",
      "A new video can contradict a tendency. The memory is updated by rebuilding it from the corpus.",
    ],
    sourceHashes: {
      memory: hash("data/kazewa-memory.json"),
      knowledge: hash("data/knowledge.json"),
      engine: hash("src/engine.mjs"),
    },
  };
  const shipped = {
    version: "2.1.0",
    trainedAt: now.toISOString(),
    process: {
      weights,
      lambda: PROCESS_LAMBDA,
      trainedOn: usableCases(cases).length,
      note: "Positive weight: the side that picks later in this lane is the side he tends to prefer. Only the sign of the total is used.",
    },
    reliability: {
      withOrder: {
        agreement: pickOrder.agreement,
        n: pickOrder.n,
        low: pickOrder.low,
        high: pickOrder.high,
        p: chance.p,
        sideOnly: { side: sideOnly.side, agreement: sideOnly.agreement },
      },
      arguments: argumentsReport
        ? {
            agreement: argumentsReport.agreement,
            n: argumentsReport.n,
            low: argumentsReport.low,
            high: argumentsReport.high,
            coverage: argumentsReport.coverage,
          }
        : null,
      both: argumentsReport
        ? {
            agreement: argumentsReport.withPickOrder.sameSide.agreement,
            n: argumentsReport.withPickOrder.sameSide.n,
            low: argumentsReport.withPickOrder.sameSide.low,
            high: argumentsReport.withPickOrder.sameSide.high,
          }
        : null,
      split: argumentsReport ? argumentsReport.withPickOrder.oppositeSides : null,
      withoutOrder: {
        agreement: neverSeen.agreement,
        n: neverSeen.n,
        note: "structural calculator on drafts it was not tuned on: no signal",
      },
    },
  };
  return { evaluation, model: shipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const memory = read("kazewa-memory.json");
  const { evaluation, model } = buildReport(
    memory,
    read("knowledge.json"),
    read("calculator-tuning-set.json"),
    { site: read("memory-site.json") },
  );
  fs.writeFileSync(path.join(root, "data", "model.json"), JSON.stringify(model, null, 1) + "\n");
  fs.writeFileSync(path.join(root, "data", "evaluation.json"), JSON.stringify(evaluation, null, 1) + "\n");
  const pct = (r) => `${(r.agreement * 100).toFixed(1)} % (${r.agree}/${r.n}, IC95 ${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)})`;
  const u = evaluation.unseen;
  console.log(`Mémoire : ${evaluation.memory.decided} drafts jugées, verdict restitué ${pct(evaluation.memory.selfRecall)}`);
  console.log(`Draft inédite, ordre des picks : ${pct(u.pickOrder)} sur ${u.groups} groupes ; hasard ${(u.pickOrder.chance.mean * 100).toFixed(1)} ± ${(u.pickOrder.chance.sd * 100).toFixed(1)}, p=${u.pickOrder.chance.p.toFixed(3)}`);
  console.log(`Toujours « ${u.pickOrder.sideOnly.side} » : ${pct(u.pickOrder.sideOnly)} ; écart avec le modèle : ${u.pickOrder.overSideOnly.modelRightRuleWrong} contre ${u.pickOrder.overSideOnly.ruleRightModelWrong}, p=${u.pickOrder.overSideOnly.p.toFixed(3)}`);
  if (u.arguments)
    console.log(`Draft inédite, ses arguments venus d’autres vidéos : ${pct(u.arguments)} ; couverture ${(u.arguments.coverage * 100).toFixed(0)} % ; d’accord avec l’ordre des picks : ${pct(u.arguments.withPickOrder.sameSide)} ; opposés : arguments justes ${u.arguments.withPickOrder.oppositeSides.argumentsRight}/${u.arguments.withPickOrder.oppositeSides.n}`);
  console.log(`Calculateur structurel : réglé sur ${pct(u.structuralCalculator.tunedOn)} ; jamais vues ${pct(u.structuralCalculator.neverSeen)}`);
  console.log(`Poids par lane : ${JSON.stringify(model.process.weights)}`);
}
