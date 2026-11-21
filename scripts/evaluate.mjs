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
 * Shanei's grid is a second opinion, not a reading of Kazewa: it is measured
 * here against his verdict and against the result of the game, so the site
 * can say what it is worth.
 *
 * Needs no corpus and no network: it runs in CI from the committed data. The
 * one figure that needs the match index (.cache/oe-games.json), Shanei's grid
 * against the result of every professional game, is recomputed when the index
 * is there and carried over from the last report when it is not.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeDraft, normalizeChampion, ROLES } from "../src/engine.mjs";
import { applicableArguments, indexMemory } from "../src/memory.mjs";
import { cardReading, cardRelations } from "../src/relations.mjs";
import { indexMethod, shaneiReading } from "../src/method.mjs";
import { evaluateDraft, theoryContext } from "../src/theory.mjs";
import { playedGames, resultKey, shardOf } from "../src/results.mjs";
import { argumentLean, chooseReading, judgeDraft } from "../src/verdict.mjs";
import { fitLogistic } from "./lib/logistic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));
/**
 * The professional games already played with a draft, read from the committed
 * results files exactly as the site reads them. Null when the files are absent.
 */
export function loadResults(dir = path.join(root, "data", "pro-results")) {
  if (!fs.existsSync(path.join(dir, "index.json"))) return null;
  const shards = new Map();
  return (draft) => {
    const found = resultKey(draft);
    if (!found) return null;
    const name = shardOf(found.key);
    if (!shards.has(name)) {
      const file = path.join(dir, `${name}.json`);
      shards.set(name, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
    }
    return playedGames(draft, shards.get(name));
  };
}
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
        label: c.verdict.side,
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

/** What Shanei's grid is made of: its data and its code. */
export const gridFingerprint = () =>
  contentHash(
    ["data/method.json", "src/method.mjs", "data/knowledge.json"]
      .map((relative) => fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n"))
      .join("\n"),
  );

/**
 * Shanei's grid against the result of every professional game of the match
 * index, academies left out: how often the composition it finds healthier is
 * the one that won. Null when the index is not on this machine.
 */
export function shaneiOnProGames(method, knowledge, file = path.join(root, ".cache", "oe-games.json"), from = "2021-01-01") {
  if (!method || !fs.existsSync(file)) return null;
  const index = indexMethod(method);
  const academy = new Set(["LAS", "LCKC", "WSCI", "ASCI"]);
  const name = (value) => (typeof value === "string" ? normalizeChampion(value, knowledge) : null);
  let games = 0;
  let leaning = 0;
  let agree = 0;
  let compositions = 0;
  let faultless = 0;
  let last = null;
  for (const game of JSON.parse(fs.readFileSync(file, "utf8"))) {
    if (!game.date || game.date < from || academy.has(game.league)) continue;
    if (game.winner !== "blue" && game.winner !== "red") continue;
    const draft = {
      blue: Object.fromEntries(ROLES.map((role) => [role, name(game.blue?.[role])])),
      red: Object.fromEntries(ROLES.map((role) => [role, name(game.red?.[role])])),
    };
    if (ROLES.some((role) => !draft.blue[role] || !draft.red[role])) continue;
    const reading = shaneiReading(draft, index);
    if (!reading) continue;
    games++;
    if (!last || game.date > last) last = game.date;
    for (const side of ["blue", "red"]) {
      compositions++;
      if (!reading[side].items.some((item) => item.kind === "fault")) faultless++;
    }
    if (reading.side === "even") continue;
    leaning++;
    if (reading.side === game.winner) agree++;
  }
  return {
    ...rate(agree, leaning),
    grid: gridFingerprint(),
    games,
    from,
    to: last ? last.slice(0, 10) : null,
    faultless: compositions ? faultless / compositions : null,
    note: "Every professional game of the match index since 'from', academies left out. 'n' counts the games where the grid finds one composition healthier; 'faultless' is the share of professional compositions the grid faults in nothing. 'grid' is the fingerprint of the grid (data/method.json, src/method.mjs, data/knowledge.json) the figure was measured with: where the match index is absent the figure is kept only while the grid has not changed.",
  };
}

// Five hundred drafts drawn from the whole catalogue with a fixed generator, so
// that every run draws the same ones (the same draws as tests/verdict.test.mjs).
// It counts how often the site has no estimate at all: nothing is fitted.
function randomDraftCoverage(options, count = 500) {
  const names = Object.keys(options.knowledge.champions);
  let state = 20261114;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const byBasis = {};
  for (let i = 0; i < count; i += 1) {
    const pool = [...names];
    const pick = () => pool.splice(Math.floor(random() * pool.length), 1)[0];
    const team = () => ({ top: pick(), jng: pick(), mid: pick(), bot: pick(), sup: pick() });
    const draft = { blue: team(), red: team() };
    const result = judgeDraft(draft, options);
    const basis = result.status === "complete" ? result.lean.basis : result.status;
    byBasis[basis] = (byBasis[basis] ?? 0) + 1;
  }
  const withoutEstimate = byBasis.balance ?? 0;
  return { n: count, withoutEstimate, share: withoutEstimate / count, byBasis };
}

export function buildReport(
  memory,
  knowledge,
  tuning,
  { now = new Date(), site = null, cards = null, holdout = null, played = null, method = null, proGames = null } = {},
) {
  const cases = memory.cases;
  const decided = cases.filter((c) => c.verdict.side !== "even");

  /* 1. Judged drafts: the lookup returns his verdict in both orientations. */
  const weights = fitProcess(cases);
  const index = indexMemory(memory);
  const lookup = { knowledge, memory: index };
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

  /* 3. Pick order: a reading that was tried and set aside. It is still measured
     here, next to a rule with no model, so the decision stays checkable. */
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
  // Always naming the side the other groups prefer most often, on the same drafts.
  const majorityOutside = (group) => {
    const others = decided.filter((c) => c.group !== group);
    const blue = others.filter((c) => c.verdict.side === "blue").length;
    return blue * 2 === others.length ? null : blue * 2 > others.length ? "blue" : "red";
  };
  const saidSideRows = saidDecided.map((row) => {
    const majority = majorityOutside(row.group);
    return {
      group: row.group,
      credit: majority === null ? 0.5 : majority === row.label ? 1 : 0,
      model: row.credit,
    };
  });
  const saidBetter = saidSideRows.filter((r) => r.model > r.credit).length;
  const saidWorse = saidSideRows.filter((r) => r.model < r.credit).length;
  const argumentsReport = site
    ? {
        ...grouped(saidDecided),
        groups: new Set(saidDecided.map((row) => row.group)).size,
        sideOnly: grouped(saidSideRows),
        overSideOnly: {
          argumentsRightRuleWrong: saidBetter,
          ruleRightArgumentsWrong: saidWorse,
          p: signTest(saidBetter, saidWorse),
          note: "Drafts where his arguments and the always-same-side rule disagree. Exact sign test.",
        },
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

  /* 3c. Every draft gets a verdict: the readings in the order the site uses them. */
  const relations = cards ? cardRelations(cards) : null;
  // The procedure of the two coaches (src/theory.mjs): read only, never fitted.
  const theoryCtx = method ? theoryContext({ knowledge, index: indexMethod(method) }) : null;
  const heldOutVideos = new Set(holdout?.videos ?? []);
  const saidById = new Map(said.map((row) => [row.id, row]));
  const perDraft = decided.map((c) => {
    const draft = { blue: c.blue, red: c.red };
    const calculator = analyzeDraft(draft, knowledge);
    const theory = theoryCtx ? evaluateDraft(draft, theoryCtx).side : "even";
    const cardSide = relations ? cardReading(draft, relations).side : "even";
    // The result of the game, read the way the site reads it: every game
    // played with these two rosters, and a side only when they all agree.
    const wonBy = played
      ? played(draft)?.side
      : c.winnerSource === "match_data"
        ? c.winner
        : null;
    return {
      group: c.group,
      label: c.verdict.side,
      timing: c.verdict.timing,
      resultSide: wonBy === "blue" || wonBy === "red" ? wonBy : null,
      // The champion cards were written without this draft's videos.
      unseenByCards:
        heldOutVideos.size > 0 &&
        c.sources.length > 0 &&
        c.sources.every((source) => heldOutVideos.has(source.video)),
      argumentSide: saidById.get(c.id)?.side ?? null,
      cardSide: cardSide === "even" ? null : cardSide,
      theorySide: theory === "even" ? null : theory,
      // On a draft it was tuned on, the calculator's answer proves nothing:
      // it is left out, and the draft counts as undecided at that step.
      calculatorSide:
        !isTuned(c) && calculator.status === "complete" && calculator.winner !== "even"
          ? calculator.winner
          : null,
    };
  });
  // `withResult`: the draft is a game already played and its result is known.
  // A draft that no reading separates gets no estimate: it is counted apart,
  // and is not credited with half a point for a coin toss.
  const cascade = (drafts, withResult = false) => {
    const byReading = {};
    const all = [];
    const unanswered = [];
    for (const d of drafts) {
      const reading = chooseReading({ ...d, resultSide: withResult ? d.resultSide : null });
      if (reading.basis === "balance") {
        unanswered.push({ group: d.group });
        continue;
      }
      const row = {
        group: d.group,
        credit: reading.side === d.label ? 1 : 0,
      };
      (byReading[reading.basis] ??= []).push(row);
      all.push(row);
    }
    return {
      all: grouped(all),
      byReading: Object.fromEntries(
        Object.entries(byReading).map(([basis, rows]) => [basis, grouped(rows)]),
      ),
      unanswered: {
        n: unanswered.length,
        groups: new Set(unanswered.map((row) => row.group)).size,
      },
      coverage: drafts.length ? all.length / drafts.length : null,
    };
  };
  // The cards were written from most of his videos. Only the drafts of the
  // videos kept out of them say what the cards are worth on a new draft.
  const cardCredit = (d) => ({ group: d.group, credit: d.cardSide === d.label ? 1 : 0 });
  const fresh = perDraft.filter((d) => d.unseenByCards);
  const cardsReport =
    relations && heldOutVideos.size
      ? {
          heldOut: grouped(fresh.filter((d) => d.cardSide).map(cardCredit)),
          writtenFrom: grouped(
            perDraft.filter((d) => !d.unseenByCards && d.cardSide).map(cardCredit),
          ),
          heldOutVideos: heldOutVideos.size,
          note: "'heldOut' counts drafts from videos the cards were written without; 'writtenFrom' counts drafts from videos the cards summarise. Only 'heldOut' says what the card reading is worth on a new draft.",
        }
      : null;
  /* 3d. A game already played: the side that won, against his verdict. No
     fitting, so no fold: the only question is how often he prefers the winner. */
  const resultRows = perDraft
    .filter((d) => d.resultSide)
    .map((d) => ({ ...d, credit: d.resultSide === d.label ? 1 : 0 }));
  const resultBoth = resultRows.filter((d) => d.argumentSide);
  const resultOpposed = resultBoth.filter((d) => d.argumentSide !== d.resultSide);
  const matchResult = resultRows.length
    ? {
        ...grouped(resultRows),
        groups: new Set(resultRows.map((d) => d.group)).size,
        coverage: resultRows.length / decided.length,
        draftTiming: grouped(resultRows.filter((d) => d.timing === "draft")),
        afterTheGame: grouped(resultRows.filter((d) => d.timing !== "draft")),
        heldOut: grouped(resultRows.filter((d) => d.unseenByCards)),
        withArguments: {
          sameSide: grouped(resultBoth.filter((d) => d.argumentSide === d.resultSide)),
          oppositeSides: {
            n: resultOpposed.length,
            resultRight: resultOpposed.filter((d) => d.credit === 1).length,
          },
        },
        note: "For a draft that is a professional game already played, the side that won is compared with his verdict. Nothing is fitted. 'draftTiming' keeps the verdicts he states in the draft phase of his video, before he watches the game; the videos known to be recorded with the result are marked by hand in data/memory-overrides.json and counted as late. 'afterTheGame' are review and late opinions, which can know the result. 'everyDraft.played' runs over every held-out draft: where no result is found the other readings answer, and byReading says how many used the result. 'withArguments' sets this reading next to his arguments from other groups on the drafts where both speak. It says nothing about a draft that has not been played.",
      }
    : null;
  /* 3d. Random drafts: how often the site has no estimate at all. */
  const randomDrafts = site && method
    ? randomDraftCoverage({
        knowledge,
        memory: indexMemory(site),
        relations,
        method: indexMethod(method),
      })
    : null;
  const everyDraft = site
    ? {
        // Honest headline: drafts no reading has seen (arguments from other
        // groups, cards written without these videos).
        heldOut: { ...cascade(fresh), groups: new Set(fresh.map((d) => d.group)).size },
        allJudgedOptimistic: cascade(perDraft).all,
        allJudged: cascade(perDraft),
        // Same held-out drafts, when the game was played and its result is known.
        played: matchResult
          ? { heldOut: { ...cascade(fresh, true), groups: new Set(fresh.map((d) => d.group)).size } }
          : null,
        note: "Each judged draft is given the estimate the site would give it if he had not judged it: his arguments from other groups first, then his champion cards. When neither separates the two compositions the draft gets no estimate: it is counted in 'unanswered', and 'coverage' is the share of drafts that get one. 'heldOut' uses only drafts from videos the cards were written without: no reading judges a draft it has seen. 'allJudgedOptimistic' uses every judged draft and is inflated: on most of them the cards summarise the very video being tested. The decision grid of the two coaches is a second opinion and is measured apart (reliability.theory). 'played' is a measure, not the estimate: it answers each draft with the result of its game first, to measure how often that side is his verdict. The site never shows that answer as the estimate.",
      }
    : null;

  /* 3e. Shanei's grid: the composition it finds healthier, against Kazewa's
     verdict and against the result. Nothing is fitted, and no video of Kazewa
     went into it: every judged draft counts. */
  const methodIndex = method ? indexMethod(method) : null;
  const gridRows = methodIndex
    ? decided
        .map((c) => {
          const reading = shaneiReading({ blue: c.blue, red: c.red }, methodIndex);
          if (!reading || reading.side === "even") return null;
          return {
            group: c.group,
            timing: c.verdict.timing,
            credit: reading.side === c.verdict.side ? 1 : 0,
            won: c.winner ? (reading.side === c.winner ? 1 : 0) : null,
          };
        })
        .filter(Boolean)
    : [];
  const shaneiGrid = methodIndex
    ? {
        ...grouped(gridRows),
        coverage: decided.length ? gridRows.length / decided.length : 0,
        draftTiming: grouped(gridRows.filter((row) => row.timing === "draft")),
        winner: grouped(gridRows.filter((row) => row.won !== null).map((row) => ({ group: row.group, credit: row.won }))),
        proGames,
        usedForTheVerdict: false,
        note: "Shanei's grid (src/method.mjs) reads the family of each composition and what he would fault in it, and names the healthier one. Agreement is with Kazewa's verdict on the drafts he judged; 'winner' is with the result of those games; 'proGames' with the result of every professional game. All three stand at a coin flip: the grid describes how a composition is built, it does not say who wins nor what Kazewa thinks. The site shows it as a second opinion and does not use it for the estimated verdict.",
      }
    : null;

  /* 3f. The procedure of the two coaches, against his verdict. Nothing is
     fitted: the rubric is applied as it stands. */
  const theoryRows = perDraft
    .filter((d) => d.theorySide)
    .map((d) => ({ group: d.group, credit: d.theorySide === d.label ? 1 : 0, confidence: d.theoryConfidence ?? null }));
  const theoryMeasure = theoryRows.length
    ? {
        ...grouped(theoryRows),
        coverage: theoryRows.length / decided.length,
        note: "The draft procedure of the two coaches (src/theory.mjs): identity, structural holes, grid of axes, bonuses, timing and verdict of Kazewa's decision rubric, with Shanei's construction checks. Nothing is fitted; it reads no professional game. Agreement is with his verdict on the drafts where it leans to a side.",
      }
    : null;

  /* 4. Context: how often the real winner matches his verdict. */
  const known = decided.filter((c) => c.winner);
  const follows = known.filter((c) => c.winner === c.verdict.side).length;

  const neverSeen = { ...grouped(calc.untuned), abstained: calc.abstained };
  const evaluation = {
    version: "2.5.0",
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
        "Leave-one-group-out. A group joins every draft that shares a video or a professional series. Intervals redraw whole groups. The pick-order measure gives a tie half a point; the estimate readings give no answer on a tie, and a draft that no reading separates is counted apart as unanswered.",
      groups: new Set(decided.map((c) => c.group)).size,
      pickOrder: {
        ...pickOrder,
        groups: cv.groups,
        chance,
        sideOnly,
        overSideOnly: {
          modelRightRuleWrong: better,
          ruleRightModelWrong: worse,
          p: signTest(better, worse),
          note: "Drafts where the pick-order model and the always-same-side rule disagree. Exact sign test.",
        },
        weights,
        usedByTheSite: false,
        note: "Set aside. Only input: for each lane, the side that locked its champion later. Fitted on the other groups, scored on the held-out group. 'chance' redraws the verdicts as coin flips; 'sideOnly' always answers the side the other groups prefer most often. On 195 drafts this reading stood at 61.5%; with 268 it does no better than 'sideOnly', and when it agrees with his arguments the result is no better than his arguments alone (see arguments.withPickOrder).",
      },
      arguments: argumentsReport,
      championCards: cardsReport,
      matchResult,
      everyDraft,
      randomDrafts,
      shaneiGrid,
      theory: theoryMeasure,
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
      "A reading can look real on two hundred drafts and vanish on three hundred: the pick order did. The arguments figure rests on two hundred drafts too and has not been confirmed on new videos.",
      "The champion cards follow his verdict far more often on the videos they were written from than on the videos kept out of them. Only the second figure is shown. The same gap is to be expected for any knowledge taken from his videos.",
      "The arguments figure counts what he said in other videos. Teams that keep drafting the same pairs and that he keeps preferring can inflate it; on teams and patches he has not commented it may be lower.",
      "Review and late opinions can know the result of the game. They are kept, with their timing shown.",
      "The result reading only exists for a game already played, and it is measured on the games he chose to comment. On a game he would not have commented, or commented differently, it may be lower. It is not an opinion on the draft: it says which team won.",
      "A new video can contradict a tendency. The memory is updated by rebuilding it from the corpus.",
    ],
    sourceHashes: {
      memory: hash("data/kazewa-memory.json"),
      knowledge: hash("data/knowledge.json"),
      engine: hash("src/engine.mjs"),
    },
  };
  const shipped = {
    version: "2.5.0",
    measuredAt: now.toISOString(),
    note: "Measured agreement of each reading the site uses for a draft he did not judge. Nothing is fitted: a game already played gives a fact, which never sets the estimate; the estimate counts his arguments, then his champion cards, and is absent when neither separates the two compositions.",
    reliability: {
      // A game already played: how often the team he preferred is the one that won.
      result: matchResult
        ? {
            agreement: matchResult.agreement,
            n: matchResult.n,
            low: matchResult.low,
            high: matchResult.high,
            draftTiming: {
              agreement: matchResult.draftTiming.agreement,
              n: matchResult.draftTiming.n,
              low: matchResult.draftTiming.low,
              high: matchResult.draftTiming.high,
            },
          }
        : null,
      arguments: argumentsReport
        ? {
            agreement: argumentsReport.agreement,
            n: argumentsReport.n,
            low: argumentsReport.low,
            high: argumentsReport.high,
            coverage: argumentsReport.coverage,
            // Always naming the same side, on the same drafts: the bar to clear.
            sideOnly: { agreement: argumentsReport.sideOnly.agreement },
          }
        : null,
      // Measured on drafts from videos the cards were written without.
      cards: cardsReport?.heldOut ?? null,
      principles: { agreement: neverSeen.agreement, n: neverSeen.n, low: neverSeen.low, high: neverSeen.high },
      everyDraft: everyDraft ? everyDraft.heldOut.all : null,
      everyDraftPlayed: everyDraft?.played ? everyDraft.played.heldOut.all : null,
      theory: theoryMeasure
        ? { agreement: theoryMeasure.agreement, n: theoryMeasure.n, low: theoryMeasure.low, high: theoryMeasure.high }
        : null,
      // Shanei's grid: a second opinion, not a reading of Kazewa's verdict.
      shanei: shaneiGrid
        ? {
            agreement: shaneiGrid.agreement,
            n: shaneiGrid.n,
            low: shaneiGrid.low,
            high: shaneiGrid.high,
            winner: shaneiGrid.proGames
              ? { agreement: shaneiGrid.proGames.agreement, n: shaneiGrid.proGames.n }
              : { agreement: shaneiGrid.winner.agreement, n: shaneiGrid.winner.n },
          }
        : null,
    },
  };
  return { evaluation, model: shipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const memory = read("kazewa-memory.json");
  const knowledge = read("knowledge.json");
  const method = fs.existsSync(path.join(root, "data", "method.json")) ? read("method.json") : null;
  const previous = fs.existsSync(path.join(root, "data", "evaluation.json")) ? read("evaluation.json") : null;
  // Measured here when the match index is on this machine. Otherwise the last
  // measure is kept, but only if it was made with this very grid.
  const grid = method ? gridFingerprint() : null;
  const kept = previous?.unseen?.shaneiGrid?.proGames ?? null;
  const proGames = shaneiOnProGames(method, knowledge) ?? (grid && kept?.grid === grid ? kept : null);
  const dropped = Boolean(method && kept && !proGames);
  const { evaluation, model } = buildReport(
    memory,
    knowledge,
    read("calculator-tuning-set.json"),
    {
      site: read("memory-site.json"),
      cards: read("champion-cards.json"),
      holdout: read("card-holdout.json"),
      played: loadResults(),
      method,
      proGames,
    },
  );
  if (dropped)
    console.log("Grille de Shanei : la mesure sur les parties pro datait d’une autre grille et l’index des matchs est absent ; elle est retirée du rapport. Relance avec .cache/oe-games.json pour la refaire.");
  fs.writeFileSync(path.join(root, "data", "model.json"), JSON.stringify(model, null, 1) + "\n");
  fs.writeFileSync(path.join(root, "data", "evaluation.json"), JSON.stringify(evaluation, null, 1) + "\n");
  const pct = (r) => `${(r.agreement * 100).toFixed(1)} % (${r.agree}/${r.n}, IC95 ${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)})`;
  const u = evaluation.unseen;
  console.log(`Mémoire : ${evaluation.memory.decided} drafts jugées, verdict restitué ${pct(evaluation.memory.selfRecall)}`);
  console.log(`Draft inédite, ordre des picks : ${pct(u.pickOrder)} sur ${u.pickOrder.groups} groupes ; hasard ${(u.pickOrder.chance.mean * 100).toFixed(1)} ± ${(u.pickOrder.chance.sd * 100).toFixed(1)}, p=${u.pickOrder.chance.p.toFixed(3)}`);
  console.log(`Toujours « ${u.pickOrder.sideOnly.side} » : ${pct(u.pickOrder.sideOnly)} ; écart avec le modèle : ${u.pickOrder.overSideOnly.modelRightRuleWrong} contre ${u.pickOrder.overSideOnly.ruleRightModelWrong}, p=${u.pickOrder.overSideOnly.p.toFixed(3)}`);
  if (u.arguments) {
    console.log(`Ses arguments contre « toujours le même côté » sur les mêmes drafts : ${pct(u.arguments.sideOnly)} ; écart ${u.arguments.overSideOnly.argumentsRightRuleWrong} contre ${u.arguments.overSideOnly.ruleRightArgumentsWrong}, p=${u.arguments.overSideOnly.p.toFixed(3)}`);
    console.log(`Draft inédite, ses arguments venus d’autres vidéos : ${pct(u.arguments)} ; couverture ${(u.arguments.coverage * 100).toFixed(0)} % ; d’accord avec l’ordre des picks : ${pct(u.arguments.withPickOrder.sameSide)} ; opposés : arguments justes ${u.arguments.withPickOrder.oppositeSides.argumentsRight}/${u.arguments.withPickOrder.oppositeSides.n}`);
  }
  if (u.everyDraft) {
    const line = (c) => Object.entries(c.byReading).map(([k, r]) => `${k} ${r.agree}/${r.n}`).join(" · ");
    console.log(`Estimation sur les drafts jamais vues par aucune lecture : ${pct(u.everyDraft.heldOut.all)} | ${line(u.everyDraft.heldOut)} | sans estimation ${u.everyDraft.heldOut.unanswered.n} sur ${u.everyDraft.heldOut.all.n + u.everyDraft.heldOut.unanswered.n}`);
    console.log(`Sur toutes les drafts jugées (gonflé par les fiches) : ${pct(u.everyDraft.allJudgedOptimistic)}`);
    if (u.randomDrafts)
      console.log(`Drafts tirées au hasard, sans aucune estimation : ${u.randomDrafts.withoutEstimate} sur ${u.randomDrafts.n} (${(u.randomDrafts.share * 100).toFixed(1)} %)`);
    if (u.championCards)
      console.log(`Fiches champion : vidéos jamais vues ${pct(u.championCards.heldOut)} ; vidéos qui ont servi à les écrire ${pct(u.championCards.writtenFrom)}`);
  }
  if (u.matchResult) {
    const m = u.matchResult;
    console.log(`Partie déjà jouée, le vainqueur : ${pct(m)} ; avis donnés pendant la draft ${pct(m.draftTiming)} ; après coup ${pct(m.afterTheGame)} ; vidéos tenues à l’écart ${pct(m.heldOut)}`);
    console.log(`  face à ses arguments : même côté ${pct(m.withArguments.sameSide)} ; opposés : résultat juste ${m.withArguments.oppositeSides.resultRight}/${m.withArguments.oppositeSides.n}`);
    if (u.everyDraft?.played)
      console.log(`Toute draft d’une partie déjà jouée, vidéos tenues à l’écart : ${pct(u.everyDraft.played.heldOut.all)}`);
  }
  if (u.shaneiGrid) {
    const g = u.shaneiGrid;
    console.log(`Grille de Shanei (second avis) : même côté que le verdict de Kazewa ${pct(g)} ; que le vainqueur de ces parties ${pct(g.winner)}${g.proGames ? ` ; que le vainqueur sur ${g.proGames.n} parties pro ${(g.proGames.agreement * 100).toFixed(1)} %` : ""}`);
  }
  console.log(`Calculateur structurel : réglé sur ${pct(u.structuralCalculator.tunedOn)} ; jamais vues ${pct(u.structuralCalculator.neverSeen)}`);
  console.log(`Ordre des picks (lecture écartée), poids par lane : ${JSON.stringify(u.pickOrder.weights)}`);
}
