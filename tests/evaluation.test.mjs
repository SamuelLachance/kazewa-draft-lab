import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { analyzeDraft } from "../src/engine.mjs";
import {
  buildExploratoryRaw,
  canonicalPicks,
  deduplicateCases,
  evaluateBenchmark,
  evaluateGate,
  fingerprint,
  influenceTags,
  summarize,
  wilsonInterval,
} from "../scripts/evaluate.mjs";

const roles = ["top", "jng", "mid", "bot", "sup"];
const blue = Object.fromEntries(
  roles.map((role, index) => [role, `Champion${index}`]),
);
const red = Object.fromEntries(
  roles.map((role, index) => [role, `Champion${index + 5}`]),
);
const knowledge = {
  version: "test",
  champions: Object.fromEntries(
    [...Object.values(blue), ...Object.values(red)].map((champion) => [
      champion,
      { champion },
    ]),
  ),
};
const sample = (overrides) => ({
  id: "case",
  video: "videoA",
  sourceGame: "videoA_g1",
  sourceFile: "a.json",
  blue,
  red,
  expected: "blue",
  reconstructed: false,
  primaryEligible: true,
  influenceTags: [],
  ...overrides,
});

function corpusFixture(t, games, video = "review") {
  const temporaryParent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "kazewa-evaluation-test-"),
  );
  fs.mkdirSync(path.join(root, "verdicts"));
  fs.writeFileSync(
    path.join(root, "verdicts", `${video}.json`),
    JSON.stringify({ video, games }),
  );
  t.after(() => {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== temporaryParent ||
      !path.basename(resolved).startsWith("kazewa-evaluation-test-")
    )
      throw new Error("Unexpected fixture cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

const rawGame = (overrides) => ({
  game: 1,
  left_picks: blue,
  right_picks: red,
  verdict: { side: "left", confidence: 2, label: "A coherent composition" },
  reasons: ["A protected carry has the tools to win."],
  result: "left",
  ...overrides,
});
const cleanGame = (overrides) => ({
  file: "review_g1",
  left_picks: blue,
  right_picks: red,
  verdict: { side: "left", confidence: 2, label: "A coherent composition" },
  reasons: [],
  ...overrides,
});
const partial = (picks, visibleRoles) =>
  Object.fromEntries(
    roles.map((role) => [
      role,
      visibleRoles.includes(role) ? picks[role] : "?",
    ]),
  );

test("uncertain names remain excluded even when a canonical champion is recognizable", () => {
  assert.equal(canonicalPicks({ ...blue, top: "Champion0?" }, knowledge), null);
  assert.equal(canonicalPicks({ ...blue, top: "?" }, knowledge), null);
  assert.equal(canonicalPicks({ ...blue, top: "" }, knowledge), null);
});

test("draft fingerprint is side invariant while role assignments remain significant", () => {
  assert.equal(fingerprint(blue, red).value, fingerprint(red, blue).value);
  assert.notEqual(
    fingerprint(blue, red).value,
    fingerprint({ ...blue, top: blue.jng, jng: blue.top }, red).value,
  );
});

test("same game and reversed duplicates count once with correctly oriented labels", () => {
  const result = deduplicateCases([
    sample(),
    sample({
      id: "reverse",
      blue: red,
      red: blue,
      expected: "red",
      sourceFile: "b.json",
    }),
  ]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.duplicateRecordsRemoved, 1);
  assert.equal(result.conflicts.length, 0);
});

test("conflicting labels or compositions for a source game are excluded", () => {
  const labels = deduplicateCases([
    sample(),
    sample({ id: "badlabel", expected: "red" }),
  ]);
  assert.equal(labels.cases.length, 0);
  assert.equal(labels.conflicts[0].reason, "conflicting_labels");
  const comps = deduplicateCases([
    sample(),
    sample({ id: "badcomp", blue: { ...blue, top: blue.jng, jng: blue.top } }),
  ]);
  assert.equal(comps.cases.length, 0);
  assert.equal(comps.conflicts[0].reason, "conflicting_compositions");
});

test("actual outcomes are reoriented when preserving an opposite-side duplicate", () => {
  const result = deduplicateCases([
    sample(),
    sample({
      id: "reverse",
      blue: red,
      red: blue,
      expected: "red",
      actualWinner: "blue",
      keySourceFile: "key.json",
    }),
  ]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].actualWinner, "red");
  assert.equal(
    result.cases[0].actualWinnerOrientation,
    "selected_case_blue_red",
  );
});

test("conflicting actual outcomes abstain on outcome scoring without deleting a consistent preference", () => {
  const result = deduplicateCases([
    sample({ actualWinner: "blue", keySourceFile: "first-key.json" }),
    sample({
      id: "reverse",
      blue: red,
      red: blue,
      expected: "red",
      actualWinner: "blue",
      keySourceFile: "second-key.json",
    }),
  ]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].actualWinner, null);
  assert.equal(result.cases[0].actualWinnerConflict, true);
  assert.equal(
    result.outcomeConflicts[0].reason,
    "conflicting_actual_outcomes",
  );
  const report = evaluateBenchmark(
    { version: "test", cases: result.cases, limitations: [] },
    knowledge,
    () => ({ status: "complete", winner: "blue" }),
  );
  assert.equal(report.primary.correct, 1);
  assert.equal(report.actualMatchOutcome.available, 0);
  assert.equal(report.actualMatchOutcome.excludedConflictingOutcomes, 1);
});

test("multi-series raw game numbers map uniquely through reversed partial picks and distinct role assignments", (t) => {
  const secondBlue = { ...blue, top: blue.jng, jng: blue.top };
  const root = corpusFixture(t, [
    rawGame({ match: "Series A" }),
    rawGame({
      match: "Series B",
      left_picks: secondBlue,
      verdict: {
        side: "right",
        confidence: 2,
        label: "The other composition is stronger",
      },
      result: "right",
    }),
  ]);
  const clean = [
    cleanGame({
      file: "review_g7",
      left_picks: partial(red, ["top", "mid"]),
      right_picks: partial(blue, ["jng", "bot"]),
      verdict: {
        side: "right",
        confidence: 2,
        label: "The coherent side wins",
      },
    }),
    cleanGame({
      file: "review_g8",
      left_picks: secondBlue,
      verdict: { side: "right", confidence: 2, label: "The other side wins" },
    }),
  ];
  const result = buildExploratoryRaw(root, knowledge, clean, [
    { sourceGame: "review_g7", fingerprint: fingerprint(blue, red).value },
  ]);
  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.cases.map((record) => record.cleanMatch).sort(), [
    "review_g7",
    "review_g8",
  ]);
  assert.equal(
    result.cases.find((record) => record.cleanMatch === "review_g7").expected,
    "blue",
  );
  assert.equal(
    result.cases.find((record) => record.cleanMatch === "review_g8").expected,
    "red",
  );
  assert.equal(result.audit.overlapsCleanBenchmark, 1);
  assert.equal(result.audit.cleanMatchUnresolved, 0);
});

test("raw labels are excluded when a matched clean draft has no call or the opposite preference", (t) => {
  const root = corpusFixture(t, [rawGame(), rawGame({ game: 2 })]);
  const clean = [
    cleanGame({
      verdict: { side: "even", confidence: 0, label: "No stated preference" },
    }),
    cleanGame({
      file: "review_g2",
      verdict: { side: "right", confidence: 2, label: "Opposite preference" },
    }),
  ];
  const result = buildExploratoryRaw(root, knowledge, clean, []);
  assert.equal(result.cases.length, 0);
  assert.equal(
    result.audit.exclusionCounts.clean_draft_phase_has_no_preference,
    1,
  );
  assert.equal(
    result.audit.exclusionCounts.raw_label_conflicts_with_clean_draft_phase,
    1,
  );
});

test("multiple compatible clean sources are ambiguous even when one contains more known picks", (t) => {
  const root = corpusFixture(t, [rawGame({ match: "Series A" })]);
  const clean = [
    cleanGame({
      file: "review_g7",
      left_picks: partial(blue, ["top", "jng"]),
      right_picks: partial(red, ["top", "mid"]),
    }),
    cleanGame({
      file: "review_g8",
      left_picks: partial(blue, ["top", "jng", "mid"]),
      right_picks: partial(red, ["top", "mid", "bot"]),
    }),
  ];
  const result = buildExploratoryRaw(root, knowledge, clean, []);
  assert.equal(result.cases.length, 0);
  assert.equal(
    result.audit.exclusionCounts.ambiguous_multi_series_clean_match,
    1,
  );
});

test("known pick conflicts and explicit late opinions are excluded before exploratory scoring", (t) => {
  const root = corpusFixture(t, [
    rawGame(),
    rawGame({ game: 2, late_opinion: true }),
  ]);
  const clean = [
    cleanGame({ left_picks: { ...blue, top: blue.jng, jng: blue.top } }),
  ];
  const result = buildExploratoryRaw(root, knowledge, clean, []);
  assert.equal(result.cases.length, 0);
  assert.equal(
    result.audit.exclusionCounts
      .clean_known_picks_conflict_or_mapping_unresolved,
    1,
  );
  assert.equal(
    result.audit.exclusionCounts.explicit_late_or_result_aware_opinion,
    1,
  );
});

test("noncomposition context is screened transparently without tagging a generic matchup", () => {
  assert.deepEqual(
    influenceTags({ reasons: ["Poppy answers the dashes and protects Jinx."] }),
    [],
  );
  assert.deepEqual(
    influenceTags({ reasons: ["Blind Gnar into Zeus on the current patch."] }),
    ["draft_process", "historical_meta", "player_or_team_strength"],
  );
  assert.deepEqual(
    influenceTags({
      reasons: ["A protected carry scales."],
      verdict: { late_opinion: true },
    }),
    ["late_or_result_aware"],
  );
});

test("abstentions lower coverage and are not counted as correct or incorrect decisions", () => {
  const summary = summarize([
    { video: "a", expected: "blue", predicted: "blue" },
    { video: "a", expected: "red", predicted: null },
    { video: "b", expected: "red", predicted: "blue" },
  ]);
  assert.equal(summary.agreement, 0.5);
  assert.equal(summary.coverage, 2 / 3);
  assert.equal(summary.incorrect, 1);
  assert.equal(summary.confusionMatrix.counts.red.abstain, 1);
  assert.equal(summary.videos, 2);
  const noCalls = summarize([
    { video: "a", expected: "blue", predicted: null },
  ]);
  assert.equal(noCalls.agreement, null);
  assert.equal(noCalls.agreementInterval95, null);
});

test("gate enforces sample size, independent video count, agreement and coverage", () => {
  const result = evaluateGate({
    eligible: 49,
    videos: 9,
    agreement: 0.84,
    coverage: 0.79,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, [
    "insufficient_cases",
    "insufficient_videos",
    "insufficient_coverage",
    "insufficient_agreement",
  ]);
  assert.equal(
    evaluateGate({ eligible: 50, videos: 10, agreement: 0.85, coverage: 0.8 })
      .passed,
    true,
  );
});

test("gate fails closed for malformed counts, ratios, summaries and thresholds", () => {
  const valid = { eligible: 50, videos: 10, agreement: 0.85, coverage: 0.8 };
  for (const field of Object.keys(valid)) {
    for (const invalid of [
      undefined,
      null,
      NaN,
      Infinity,
      -Infinity,
      -1,
      "100",
    ])
      assert.equal(
        evaluateGate({ ...valid, [field]: invalid }).passed,
        false,
        `${field}=${String(invalid)}`,
      );
  }
  assert.equal(evaluateGate({ ...valid, eligible: 50.5 }).passed, false);
  assert.equal(evaluateGate({ ...valid, videos: 10.5 }).passed, false);
  assert.equal(evaluateGate({ ...valid, agreement: 1.01 }).passed, false);
  assert.equal(evaluateGate({ ...valid, coverage: 1.01 }).passed, false);
  assert.equal(evaluateGate(undefined).passed, false);
  assert.equal(evaluateGate(null).passed, false);
  assert.equal(
    evaluateGate(valid, {
      minimumCases: 50,
      minimumVideos: 10,
      minimumCoverage: NaN,
      minimumAgreement: 0.85,
    }).passed,
    false,
  );
  assert.equal(evaluateGate(valid, null).passed, false);
});

test("evaluation never passes expected labels, outcomes, reasons, dates or team identities to the predictor", () => {
  let calls = 0;
  const cases = [
    sample({
      actualWinner: "red",
      reasons: ["secret label rationale"],
      date: "2026-01-01",
      teamName: "Real Team",
    }),
  ];
  const report = evaluateBenchmark(
    { version: "test", cases, limitations: [] },
    knowledge,
    (input) => {
      calls += 1;
      assert.deepEqual(Object.keys(input).sort(), ["blue", "red"]);
      assert.deepEqual(Object.keys(input.blue).sort(), [...roles].sort());
      return {
        status: "complete",
        winner: "blue",
        score: 4,
        confidence: "moyenne",
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(report.primary.agreement, 1);
  assert.equal(report.actualMatchOutcome.accuracy, 0);
});

test("incomplete and even predictions always abstain in the benchmark", () => {
  const benchmark = { version: "test", cases: [sample()], limitations: [] };
  const even = evaluateBenchmark(benchmark, knowledge, () => ({
    status: "complete",
    winner: "even",
  }));
  const partial = evaluateBenchmark(benchmark, knowledge, () => ({
    status: "incomplete",
    winner: "blue",
  }));
  assert.equal(even.primary.decided, 0);
  assert.equal(partial.primary.decided, 0);
});

test("exploratory full-review examples cannot contribute to the fidelity gate", () => {
  const benchmark = {
    version: "test",
    cases: [sample()],
    limitations: [],
    exploratoryRaw: {
      name: "raw",
      cases: Array.from({ length: 100 }, (_, index) =>
        sample({ id: `raw${index}`, video: `video${index}` }),
      ),
      audit: {},
      limitations: [],
    },
  };
  const report = evaluateBenchmark(benchmark, knowledge, () => ({
    status: "complete",
    winner: "blue",
  }));
  assert.equal(report.primary.eligible, 1);
  assert.equal(report.gate.passed, false);
  assert.equal(report.exploratoryRaw.summary.eligible, 100);
  assert.equal(report.exploratoryRaw.contributesToFidelityGate, false);
});

test("shipped scorer agrees with Kazewa on at least 70 percent of decided drafts", async () => {
  const realKnowledge = JSON.parse(
    await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
  );
  const benchmark = JSON.parse(
    await readFile(new URL("../data/benchmark.json", import.meta.url), "utf8"),
  );
  const report = evaluateBenchmark(benchmark, realKnowledge, analyzeDraft);
  assert.ok(report.broader.decided >= 57);
  assert.ok(report.broader.coverage >= 0.8);
  assert.ok(report.broader.agreement >= 0.7);
  assert.equal(report.gate.passed, false);
  for (const record of benchmark.cases) {
    const forward = analyzeDraft(
      { blue: { ...record.blue }, red: { ...record.red } },
      realKnowledge,
    );
    const backward = analyzeDraft(
      { blue: { ...record.red }, red: { ...record.blue } },
      realKnowledge,
    );
    assert.equal(forward.score + backward.score, 0);
    assert.equal(forward.margin, backward.margin);
    const opposite =
      forward.winner === "even"
        ? "even"
        : forward.winner === "blue"
          ? "red"
          : "blue";
    assert.equal(backward.winner, opposite);
  }
  const outside = analyzeDraft(
    {
      blue: { top: "Sion", jng: "Maokai", mid: "Azir", bot: "Jinx", sup: "Lulu" },
      red: { top: "Jayce", jng: "Nidalee", mid: "LeBlanc", bot: "Jhin", sup: "Pyke" },
    },
    realKnowledge,
  );
  assert.equal(outside.status, "complete");
  assert.equal(outside.winner, "blue");
  assert.ok(outside.signals.some((signal) => signal.id === "dps_missing"));
});

test("Wilson interval is bounded and does not invent a zero-sample estimate", () => {
  assert.equal(wilsonInterval(0, 0), null);
  const interval = wilsonInterval(85, 100);
  assert.ok(interval.low < 0.85 && interval.high > 0.85);
  assert.ok(interval.low >= 0 && interval.high <= 1);
});
