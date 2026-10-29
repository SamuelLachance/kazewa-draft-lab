import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assignGroupFolds,
  buildLeakageGroups,
  DISTILLATION_CONFIG,
  draftFingerprint,
  extractStructuralFeatures,
  FEATURE_NAMES,
  fitPreferenceModel,
  predictPreference,
  scoreFeatureVector,
} from "../src/distillation.mjs";

const knowledge = JSON.parse(
  fs.readFileSync(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);
const benchmark = JSON.parse(
  fs.readFileSync(new URL("../data/benchmark.json", import.meta.url), "utf8"),
);
const draft = { blue: benchmark.cases[0].blue, red: benchmark.cases[0].red };
const vector = (...values) =>
  Array.from(
    { length: FEATURE_NAMES.length },
    (_, index) => values[index] ?? 0,
  );
const toySamples = [
  { values: vector(2), label: "blue" },
  { values: vector(4), label: "blue" },
];

test("feature schema is fixed, small and contains only structural family/axis/trait aggregates", () => {
  assert.equal(FEATURE_NAMES.length, 24);
  assert.ok(
    FEATURE_NAMES.every((name) => /^(family|axis|trait)\.[a-z_]+$/.test(name)),
  );
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_NAMES.length);
  const feature = extractStructuralFeatures(draft, knowledge);
  assert.equal(feature.status, "complete");
  assert.equal(feature.values.length, FEATURE_NAMES.length);
  assert.ok(feature.values.every(Number.isFinite));
});

test("swapping compositions exactly negates every structural feature", () => {
  const a = extractStructuralFeatures(draft, knowledge),
    b = extractStructuralFeatures(
      { blue: draft.red, red: draft.blue },
      knowledge,
    );
  a.values.forEach((value, index) =>
    assert.ok(Math.abs(value + b.values[index]) < 1e-10, FEATURE_NAMES[index]),
  );
});

test("ridge training converges on separable structural data with balanced mirrored classes", () => {
  const model = fitPreferenceModel(toySamples);
  assert.equal(model.converged, true);
  assert.ok(Number.isFinite(model.objective));
  assert.ok(model.weights[0] > 0);
  assert.equal(model.intercept, 0);
  assert.deepEqual(model.augmentedClassCounts, { blue: 2, red: 2 });
  assert.equal(scoreFeatureVector(vector(3), model).winner, "blue");
  assert.equal(scoreFeatureVector(vector(-3), model).winner, "red");
});

test("scaling uses only mirrored training examples and preserves an exactly zero mean", () => {
  const model = fitPreferenceModel(toySamples);
  assert.ok(Math.abs(model.scale[0] - Math.sqrt(10)) < 1e-12);
  assert.equal(model.scale[1], 1);
  assert.ok(model.mean.every((value) => value === 0));
  scoreFeatureVector(vector(1000), model);
  assert.ok(Math.abs(model.scale[0] - Math.sqrt(10)) < 1e-12);
});

test("predictor ignores labels, outcomes, identifiers, teams and dates attached to drafts", () => {
  const features = extractStructuralFeatures(draft, knowledge);
  const model = fitPreferenceModel([
    {
      values: features.values,
      label: "blue",
      id: "DO_NOT_MEMORIZE",
      video: "DO_NOT_MEMORIZE",
    },
  ]);
  const original = predictPreference(draft, knowledge, model);
  const contaminated = predictPreference(
    {
      ...draft,
      expected: "red",
      actualWinner: "red",
      video: "DO_NOT_MEMORIZE",
      date: "2099-01-01",
      teams: ["A", "B"],
    },
    knowledge,
    model,
  );
  assert.deepEqual(contaminated, original);
  assert.equal(JSON.stringify(model).includes("DO_NOT_MEMORIZE"), false);
  assert.equal(Object.hasOwn(original, "probability"), false);
});

test("learned preference signal is antisymmetric and feature contributions sum to it", () => {
  const features = extractStructuralFeatures(draft, knowledge);
  const model = fitPreferenceModel([
    { values: features.values, label: "blue" },
  ]);
  const a = predictPreference(draft, knowledge, model),
    b = predictPreference(
      { blue: draft.red, red: draft.blue },
      knowledge,
      model,
    );
  assert.ok(Math.abs(a.signal + b.signal) < 1e-10);
  assert.equal(a.winner, "blue");
  assert.equal(b.winner, "red");
  assert.ok(
    Math.abs(
      a.contributions.reduce((total, item) => total + item.contribution, 0) -
        a.signal,
    ) < 1e-10,
  );
});

test("ties, unsupported drafts and malformed models abstain", () => {
  const model = fitPreferenceModel(toySamples);
  assert.equal(scoreFeatureVector(vector(), model).winner, null);
  assert.equal(
    predictPreference(
      { blue: { ...draft.blue, top: "?" }, red: draft.red },
      knowledge,
      model,
    ).winner,
    null,
  );
  assert.equal(
    predictPreference(
      { blue: { ...draft.blue, top: "Galio?" }, red: draft.red },
      knowledge,
      model,
    ).winner,
    null,
  );
  assert.equal(
    scoreFeatureVector(vector(1), { ...model, intercept: 1 }).winner,
    null,
  );
  assert.equal(
    scoreFeatureVector(vector(1), { ...model, mean: model.mean.map(() => 1) })
      .winner,
    null,
  );
  assert.equal(
    scoreFeatureVector(vector(1), { ...model, decisionThreshold: NaN }).winner,
    null,
  );
});

test("training rejects malformed inputs and nonpositive regularization", () => {
  assert.throws(() => fitPreferenceModel([]));
  assert.throws(() =>
    fitPreferenceModel([{ values: vector(NaN), label: "blue" }]),
  );
  assert.throws(() =>
    fitPreferenceModel([{ values: vector(1), label: "even" }]),
  );
  assert.throws(() => fitPreferenceModel(toySamples, { lambda: 0 }));
  assert.throws(() => fitPreferenceModel(toySamples, { lambda: Infinity }));
});

test("video and side-invariant draft groups connect transitively across clean and raw cohorts", () => {
  const other = {
    blue: { ...draft.blue, top: draft.blue.mid, mid: draft.blue.top },
    red: draft.red,
  };
  const records = [
    { id: "clean:a", video: "videoA", ...draft },
    { id: "clean:b", video: "videoB", ...other },
    { id: "raw:bridge", video: "videoA", blue: other.red, red: other.blue },
  ];
  const groups = buildLeakageGroups(records);
  assert.equal(new Set(groups.values()).size, 1);
  assert.equal(
    draftFingerprint(other),
    draftFingerprint({ blue: other.red, red: other.blue }),
  );
  assert.notEqual(draftFingerprint(draft), draftFingerprint(other));
});

test("duplicate source videos retained during benchmark deduplication remain grouped", () => {
  const other = {
    blue: { ...draft.blue, top: draft.blue.mid, mid: draft.blue.top },
    red: draft.red,
  };
  const groups = buildLeakageGroups([
    { id: "a", video: "videoA", ...draft },
    { id: "b", video: "videoB", duplicateVideos: ["videoA"], ...other },
  ]);
  assert.equal(groups.get("a"), groups.get("b"));
});

test("fold construction is deterministic, label independent and keeps complete groups together", () => {
  const records = Array.from({ length: 8 }, (_, index) => ({
    id: `case${index}`,
    video: `video${Math.floor(index / 2)}`,
    blue: Object.fromEntries(
      ["top", "jng", "mid", "bot", "sup"].map((role) => [
        role,
        `${index}A${role}`,
      ]),
    ),
    red: Object.fromEntries(
      ["top", "jng", "mid", "bot", "sup"].map((role) => [
        role,
        `${index}B${role}`,
      ]),
    ),
    expected: "blue",
  }));
  const groups = buildLeakageGroups(records);
  const first = assignGroupFolds(records, groups, 3),
    second = assignGroupFolds(
      records.map((record) => ({ ...record, expected: "red" })),
      groups,
      3,
    );
  assert.deepEqual([...first.byId], [...second.byId]);
  for (let index = 0; index < records.length; index += 2)
    assert.equal(
      first.byId.get(records[index].id),
      first.byId.get(records[index + 1].id),
    );
  assert.equal(
    first.loads.reduce((total, value) => total + value, 0),
    records.length,
  );
});

test("exported retrospective artifact records exactly one held-out prediction per clean case", () => {
  const report = JSON.parse(
    fs.readFileSync(
      new URL("../data/distillation.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(report.cases.length, benchmark.cases.length);
  assert.equal(
    new Set(report.cases.map((record) => record.id)).size,
    benchmark.cases.length,
  );
  const foldByVideo = new Map(),
    foldByGroup = new Map();
  for (const row of report.cases) {
    if (foldByVideo.has(row.video))
      assert.equal(row.fold, foldByVideo.get(row.video));
    if (foldByGroup.has(row.group))
      assert.equal(row.fold, foldByGroup.get(row.group));
    foldByVideo.set(row.video, row.fold);
    foldByGroup.set(row.group, row.fold);
  }
  assert.equal(report.configuration.lambda, DISTILLATION_CONFIG.lambda);
  assert.equal(report.configuration.rawLabelsUsedForTraining, false);
  assert.equal(report.experimentalAcceptance.replacesMainFidelityGate, false);
  assert.equal(report.experimentalAcceptance.primary.passed, false);
});
