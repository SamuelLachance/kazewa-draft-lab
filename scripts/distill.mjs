import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  assignGroupFolds,
  buildLeakageGroups,
  DISTILLATION_CONFIG,
  extractStructuralFeatures,
  FEATURE_NAMES,
  fitPreferenceModel,
  scoreFeatureVector,
  stableHash,
} from "../src/distillation.mjs";
import { DEFAULT_GATE, evaluateGate, summarize } from "./evaluate.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, file), "utf8"));
const knowledge = read("data/knowledge.json"),
  benchmark = read("data/benchmark.json");
const clean = benchmark.cases.map((record) => ({
  ...record,
  sourceId: record.id,
  id: `clean:${record.id}`,
  cohort: "clean",
}));
const raw = (benchmark.exploratoryRaw?.cases ?? []).map((record) => ({
  ...record,
  sourceId: record.id,
  id: `raw:${record.id}`,
  cohort: "raw",
}));
const all = [...clean, ...raw];
const groupById = buildLeakageGroups(all);
const folds = assignGroupFolds(clean, groupById);
const prepared = new Map(
  all.map((record) => [
    record.id,
    extractStructuralFeatures(
      { blue: record.blue, red: record.red },
      knowledge,
    ),
  ]),
);
if (all.some((record) => prepared.get(record.id).status !== "complete"))
  throw new Error("Benchmark contains unsupported structural features");
const train = (records) =>
  fitPreferenceModel(
    records.map((record) => ({
      values: prepared.get(record.id).values,
      label: record.expected,
    })),
  );
const predict = (records, model, fold = null) =>
  records.map((record) => {
    const output = scoreFeatureVector(prepared.get(record.id).values, model);
    return {
      id: record.sourceId,
      cohort: record.cohort,
      video: record.video,
      group: groupById.get(record.id),
      fold,
      primaryEligible: record.primaryEligible,
      expected: record.expected,
      predicted: output.winner,
      signal: output.signal,
      status: output.status,
      baseline: prepared.get(record.id).baseline.winner,
    };
  });
const baseline = (records) =>
  records.map((record) => ({
    id: record.sourceId,
    video: record.video,
    expected: record.expected,
    predicted: prepared.get(record.id).baseline.winner,
  }));
const outOfFold = [],
  foldReports = [],
  foldModels = [];
const curves = [0.25, 0.5, 0.75, 1].map((fraction) => ({
  fraction,
  rows: [],
  folds: [],
}));

for (let fold = 0; fold < folds.folds; fold += 1) {
  const training = clean.filter((record) => folds.byId.get(record.id) !== fold),
    heldout = clean.filter((record) => folds.byId.get(record.id) === fold);
  const trainGroups = new Set(
      training.map((record) => groupById.get(record.id)),
    ),
    testGroups = new Set(heldout.map((record) => groupById.get(record.id)));
  if ([...testGroups].some((group) => trainGroups.has(group)))
    throw new Error("Training/test group leakage detected");
  const model = train(training),
    rows = predict(heldout, model, fold);
  foldModels.push(model);
  outOfFold.push(...rows);
  foldReports.push({
    fold,
    trainingCases: training.length,
    trainingGroups: trainGroups.size,
    heldoutCases: heldout.length,
    heldoutGroups: testGroups.size,
    heldoutVideos: [...new Set(heldout.map((record) => record.video))].sort(),
    summary: summarize(rows),
    converged: model.converged,
    iterations: model.iterations,
  });
  const orderedGroups = [...trainGroups].sort(
    (a, b) =>
      stableHash(`${DISTILLATION_CONFIG.seed}:curve:${a}`) -
        stableHash(`${DISTILLATION_CONFIG.seed}:curve:${b}`) ||
      a.localeCompare(b),
  );
  for (const curve of curves) {
    const chosen = new Set(
      orderedGroups.slice(
        0,
        Math.max(1, Math.ceil(orderedGroups.length * curve.fraction)),
      ),
    );
    const subset = training.filter((record) =>
      chosen.has(groupById.get(record.id)),
    );
    const curveModel = curve.fraction === 1 ? model : train(subset);
    const curveRows = predict(heldout, curveModel, fold);
    curve.rows.push(...curveRows);
    curve.folds.push({
      fold,
      trainingCases: subset.length,
      trainingGroups: chosen.size,
      summary: summarize(curveRows),
    });
  }
}

const model = train(clean),
  trainingRows = predict(clean, model);
const primaryOOF = outOfFold.filter((row) => row.primaryEligible);
const cleanGroups = new Set(clean.map((record) => groupById.get(record.id)));
const rawTransfer = raw.filter(
  (record) => !cleanGroups.has(groupById.get(record.id)),
);
const rawTransferRows = predict(rawTransfer, model);
const cleanSummary = summarize(outOfFold),
  primarySummary = summarize(primaryOOF);
const pairedRows = outOfFold.filter(
  (row) =>
    ["blue", "red"].includes(row.predicted) &&
    ["blue", "red"].includes(row.baseline),
);
const pairedComparison = {
  commonDecidedCases: pairedRows.length,
  distilledCorrect: pairedRows.filter((row) => row.predicted === row.expected)
    .length,
  heuristicCorrect: pairedRows.filter((row) => row.baseline === row.expected)
    .length,
  bothCorrect: pairedRows.filter(
    (row) => row.predicted === row.expected && row.baseline === row.expected,
  ).length,
  bothIncorrect: pairedRows.filter(
    (row) => row.predicted !== row.expected && row.baseline !== row.expected,
  ).length,
  distilledOnlyCorrect: pairedRows.filter(
    (row) => row.predicted === row.expected && row.baseline !== row.expected,
  ).length,
  heuristicOnlyCorrect: pairedRows.filter(
    (row) => row.predicted !== row.expected && row.baseline === row.expected,
  ).length,
  caveat:
    "Agreement rates at different coverage are not directly equivalent; this paired comparison uses only cases on which both models decide. It does not establish a statistically reliable improvement.",
};
const coefficientStability = FEATURE_NAMES.map((name, index) => {
  const values = foldModels.map((item) => item.weights[index]);
  const average =
    values.reduce((total, value) => total + value, 0) / values.length;
  return {
    feature: name,
    coefficient: model.weights[index],
    trainingScale: model.scale[index],
    coefficientPerOriginalUnit: model.weights[index] / model.scale[index],
    foldMean: average,
    foldStandardDeviation: Math.sqrt(
      values.reduce((total, value) => total + (value - average) ** 2, 0) /
        values.length,
    ),
    foldMin: Math.min(...values),
    foldMax: Math.max(...values),
    positiveFolds: values.filter((value) => value > 1e-9).length,
    negativeFolds: values.filter((value) => value < -1e-9).length,
    zeroFolds: values.filter((value) => Math.abs(value) <= 1e-9).length,
  };
}).sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

const limitations = [
  "Only 62 clean historical cases are available; many labels include draft order, meta or player reasoning unavailable from compositions. The primary context-screened cohort has only five cases.",
  "Group cross-validation prevents direct same-video and exact-draft leakage into training. It does not remove source overlap: the fixed features, taxonomy and expert rules were distilled from overlapping videos.",
  "Regularization, 24 structural features, decision threshold and fold seed were fixed before scoring this experiment. This is a retrospective supervised experiment, not an untouched prospective test.",
  "The logistic function is used only to optimize a preference classifier. Exported scores and coefficients are not calibrated win probabilities.",
  "Case-level Wilson intervals do not account for correlation within groups. Fold variation and group counts are reported separately.",
  "The full-data model is fitted to all clean labels; its training agreement is optimistic. Only grouped out-of-fold results estimate generalization within this historical corpus.",
  "The exploratory full-review cohort is never used for training. Transfer results exclude every connected video/fingerprint group touching a clean training example, but annotations can still contain hindsight.",
  "Correlated structural features make individual coefficient signs unstable and unsuitable for causal interpretation.",
];
const report = {
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  status: "experimental_distillation_not_main_engine",
  modelVersion: knowledge.version,
  design:
    "Fixed-lambda ridge logistic preference classifier; five-fold connected video/draft-group out-of-fold evaluation on clean labels only.",
  configuration: {
    ...DISTILLATION_CONFIG,
    featureCount: FEATURE_NAMES.length,
    mirrorAugmentation: true,
    classBalancing:
      "Each training draft is paired with its side-reversed opposite label; augmented classes exactly balanced.",
    scaling:
      "RMS fitted only on each training fold; mirrored zero means; no intercept.",
    thresholdMeaning:
      "Zero signed preference signal; exact numerical ties abstain. No threshold was selected using benchmark performance.",
    rawLabelsUsedForTraining: false,
  },
  sources: {
    cleanCases: clean.length,
    cleanVideos: new Set(clean.map((record) => record.video)).size,
    cleanConnectedGroups: cleanGroups.size,
    allMetadataGroups: new Set(groupById.values()).size,
    rawCases: raw.length,
    rawEligibleForTransfer: rawTransfer.length,
    rawExcludedDueToTrainingVideoOrDraftGroup: raw.length - rawTransfer.length,
  },
  sourceHashes: Object.fromEntries(
    [
      "src/engine.mjs",
      "src/distillation.mjs",
      "scripts/distill.mjs",
      "data/knowledge.json",
      "data/benchmark.json",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(projectRoot, file)))
        .digest("hex"),
    ]),
  ),
  baseline: {
    clean: summarize(baseline(clean)),
    primary: summarize(
      baseline(clean.filter((record) => record.primaryEligible)),
    ),
    rawTransfer: summarize(baseline(rawTransfer)),
  },
  fittedTraining: summarize(trainingRows),
  outOfFold: cleanSummary,
  primaryOutOfFold: primarySummary,
  pairedComparison,
  // This cannot update the existing product gate. Even passing here would not
  // replace prospective fidelity validation or authorize swapping the engine.
  experimentalAcceptance: {
    cleanDiagnostic: evaluateGate(cleanSummary, DEFAULT_GATE),
    primary: evaluateGate(primarySummary, DEFAULT_GATE),
    replacesMainFidelityGate: false,
  },
  folds: foldReports,
  learningCurve: curves.map((curve) => ({
    trainingGroupFraction: curve.fraction,
    summary: summarize(curve.rows),
    meanTrainingCases:
      curve.folds.reduce((total, item) => total + item.trainingCases, 0) /
      curve.folds.length,
    minimumTrainingCases: Math.min(
      ...curve.folds.map((item) => item.trainingCases),
    ),
    maximumTrainingCases: Math.max(
      ...curve.folds.map((item) => item.trainingCases),
    ),
    folds: curve.folds,
  })),
  coefficientStability,
  rawTransfer: {
    trainedOn: "clean labels only; full-data model",
    excludesOverlappingConnectedGroups: true,
    summary: summarize(rawTransferRows),
    cases: rawTransferRows,
  },
  model,
  cases: outOfFold.sort((a, b) => a.id.localeCompare(b.id)),
  trainingCases: trainingRows,
  limitations,
};
fs.writeFileSync(
  path.join(projectRoot, "data", "distillation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const percent = (value) =>
  value === null ? "non mesurable" : `${(value * 100).toFixed(1)} %`;
console.log(
  `Distillation : ${report.outOfFold.correct}/${report.outOfFold.decided} accords hors groupe (${percent(report.outOfFold.agreement)}), couverture ${percent(report.outOfFold.coverage)}, ${report.sources.cleanConnectedGroups} groupes.`,
);
console.log(
  `Baseline : ${report.baseline.clean.correct}/${report.baseline.clean.decided} (${percent(report.baseline.clean.agreement)}), couverture ${percent(report.baseline.clean.coverage)}.`,
);
console.log(
  `Entraînement : ${report.fittedTraining.correct}/${report.fittedTraining.decided} (${percent(report.fittedTraining.agreement)}). Primaire hors groupe : ${report.primaryOutOfFold.correct}/${report.primaryOutOfFold.decided}.`,
);
console.log(
  `Transfert exploratoire sans groupe commun : ${report.rawTransfer.summary.correct}/${report.rawTransfer.summary.decided} (${percent(report.rawTransfer.summary.agreement)}), ${report.rawTransfer.summary.eligible} cas.`,
);
console.log(
  `Fidélité du prototype expérimental : ${report.experimentalAcceptance.primary.passed ? "seuil rétrospectif atteint; validation prospective nécessaire" : "non validée"}. Moteur principal inchangé.`,
);
