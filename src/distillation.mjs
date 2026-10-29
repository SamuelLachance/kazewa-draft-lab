import { analyzeDraft, ROLES } from "./engine.mjs";

// Fixed before evaluating this experiment. Features are signed blue minus red;
// no champion identity, team, patch, game identifier or outcome is encoded.
const FAMILIES = [
  "frontline",
  "damage",
  "reach",
  "identity",
  "protection",
  "tempo",
  "macro",
  "terrain",
  "synergy",
  "lane",
  "grid",
];
const AXES = [
  "frontline",
  "dps",
  "catch",
  "protection",
  "scaling",
  "objectives",
  "side",
];
const TRAITS = [
  "engage",
  "snowball_early",
  "anti_dash",
  "burst",
  "zone",
  "bridge",
];
export const FEATURE_NAMES = Object.freeze([
  ...FAMILIES.map((name) => `family.${name}`),
  ...AXES.map((name) => `axis.${name}`),
  ...TRAITS.map((name) => `trait.${name}`),
]);
export const DISTILLATION_CONFIG = Object.freeze({
  lambda: 1,
  decisionThreshold: 0,
  tieTolerance: 1e-10,
  maximumIterations: 80,
  tolerance: 1e-9,
  folds: 5,
  seed: "kazewa-distillation-v1",
});

export function extractStructuralFeatures(draft, knowledge) {
  const input = Object.fromEntries(
    ["blue", "red"].map((side) => [
      side,
      Object.fromEntries(ROLES.map((role) => [role, draft?.[side]?.[role]])),
    ]),
  );
  const result = analyzeDraft(input, knowledge);
  if (result.status !== "complete")
    return {
      status: result.status,
      values: null,
      baseline: { winner: null, score: null },
    };
  const values = FAMILIES.map((family) =>
    Number(result.familyScores?.[family] ?? 0),
  );
  for (const axis of AXES) {
    const row = result.axes.find((item) => item.id === axis);
    values.push(Number(row?.blue ?? 0) - Number(row?.red ?? 0));
  }
  for (const trait of TRAITS) {
    const aggregate = (side) =>
      ROLES.reduce(
        (total, role) =>
          total +
          Number(
            knowledge.champions[result.teams[side].champions[role]][trait] ?? 0,
          ),
        0,
      );
    values.push(aggregate("blue") - aggregate("red"));
  }
  if (values.some((value) => !Number.isFinite(value)))
    return {
      status: "invalid",
      values: null,
      baseline: { winner: null, score: null },
    };
  return {
    status: "complete",
    values,
    baseline: {
      winner: ["blue", "red"].includes(result.winner) ? result.winner : null,
      score: result.score,
    },
  };
}

const sigmoid = (value) =>
  value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
const softplus = (value) =>
  Math.max(0, value) + Math.log1p(Math.exp(-Math.abs(value)));
const dot = (a, b) =>
  a.reduce((sum, value, index) => sum + value * b[index], 0);

function solvePositiveSystem(matrix, vector) {
  // Cholesky: ridge makes the Hessian strictly positive definite.
  const n = vector.length,
    lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j <= i; j += 1) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!(value > 0) || !Number.isFinite(value))
          throw new Error("Non-positive or non-finite Hessian");
        lower[i][j] = Math.sqrt(value);
      } else lower[i][j] = value / lower[j][j];
    }
  const intermediate = Array(n).fill(0),
    result = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let value = vector[i];
    for (let j = 0; j < i; j += 1) value -= lower[i][j] * intermediate[j];
    intermediate[i] = value / lower[i][i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    let value = intermediate[i];
    for (let j = i + 1; j < n; j += 1) value -= lower[j][i] * result[j];
    result[i] = value / lower[i][i];
  }
  return result;
}

export function fitPreferenceModel(samples, options = {}) {
  const config = { ...DISTILLATION_CONFIG, ...options };
  if (!Array.isArray(samples) || samples.length === 0)
    throw new Error("At least one training example is required");
  if (!(Number.isFinite(config.lambda) && config.lambda > 0))
    throw new Error("A finite positive ridge penalty is required");
  if (
    !Number.isSafeInteger(config.maximumIterations) ||
    config.maximumIterations < 1 ||
    !Number.isFinite(config.tolerance) ||
    config.tolerance <= 0
  )
    throw new Error("Invalid optimizer settings");
  const dimension = FEATURE_NAMES.length;
  for (const sample of samples) {
    if (
      !Array.isArray(sample.values) ||
      sample.values.length !== dimension ||
      sample.values.some((value) => !Number.isFinite(value)) ||
      !["blue", "red"].includes(sample.label)
    )
      throw new Error("Invalid training features or preference label");
  }
  const augmented = samples.flatMap((sample) => [
    { values: [...sample.values], y: sample.label === "blue" ? 1 : 0 },
    {
      values: sample.values.map((value) => -value),
      y: sample.label === "blue" ? 0 : 1,
    },
  ]);
  const mean = Array(dimension).fill(0),
    scale = Array(dimension).fill(0);
  for (const sample of augmented)
    for (let j = 0; j < dimension; j += 1)
      mean[j] += sample.values[j] / augmented.length;
  // Explicit mirroring gives an exactly balanced training set and zero means.
  // Enforce the symmetry analytically instead of retaining round-off offsets.
  mean.fill(0);
  for (const sample of augmented)
    for (let j = 0; j < dimension; j += 1)
      scale[j] += sample.values[j] ** 2 / augmented.length;
  for (let j = 0; j < dimension; j += 1) {
    scale[j] = Math.sqrt(scale[j]) || 1;
    if (!Number.isFinite(scale[j]))
      throw new Error("Non-finite training scale");
  }
  const rows = augmented.map((sample) => ({
    x: sample.values.map(
      (value, index) => (value - mean[index]) / scale[index],
    ),
    y: sample.y,
  }));
  const objective = (weights) =>
    rows.reduce(
      (total, row) =>
        total + softplus(dot(weights, row.x)) - row.y * dot(weights, row.x),
      0,
    ) /
      rows.length +
    (config.lambda * dot(weights, weights)) / 2;
  let weights = Array(dimension).fill(0),
    iterations = 0,
    converged = false;
  for (; iterations < config.maximumIterations; iterations += 1) {
    const gradient = weights.map((value) => config.lambda * value);
    const hessian = Array.from({ length: dimension }, (_, i) =>
      Array.from({ length: dimension }, (_, j) =>
        i === j ? config.lambda : 0,
      ),
    );
    for (const row of rows) {
      const p = sigmoid(dot(weights, row.x));
      for (let i = 0; i < dimension; i += 1) {
        gradient[i] += ((p - row.y) * row.x[i]) / rows.length;
        for (let j = 0; j <= i; j += 1)
          hessian[i][j] += (p * (1 - p) * row.x[i] * row.x[j]) / rows.length;
      }
    }
    for (let i = 0; i < dimension; i += 1)
      for (let j = 0; j < i; j += 1) hessian[j][i] = hessian[i][j];
    if (Math.max(...gradient.map(Math.abs)) < config.tolerance) {
      converged = true;
      break;
    }
    const step = solvePositiveSystem(hessian, gradient),
      before = objective(weights);
    let fraction = 1,
      proposed;
    while (fraction >= 1 / 4096) {
      proposed = weights.map((value, index) => value - fraction * step[index]);
      if (objective(proposed) <= before) break;
      fraction /= 2;
    }
    if (fraction < 1 / 4096) break;
    weights = proposed;
  }
  if (weights.some((value) => !Number.isFinite(value)))
    throw new Error("Training produced non-finite coefficients");
  return {
    version: "1.0.0",
    kind: "ridge-logistic-structural-preference",
    featureNames: [...FEATURE_NAMES],
    lambda: config.lambda,
    intercept: 0,
    decisionThreshold: DISTILLATION_CONFIG.decisionThreshold,
    tieTolerance: DISTILLATION_CONFIG.tieTolerance,
    mean,
    scale,
    weights,
    trainingCases: samples.length,
    augmentedTrainingCases: augmented.length,
    augmentedClassCounts: { blue: samples.length, red: samples.length },
    iterations,
    converged,
    objective: objective(weights),
    interpretation:
      "Signed preference signal learned from Kazewa labels; neither a calibrated preference probability nor a match win probability.",
  };
}

export function scoreFeatureVector(values, model) {
  const dimension = FEATURE_NAMES.length;
  const valid =
    Array.isArray(values) &&
    values.length === dimension &&
    values.every(Number.isFinite) &&
    model?.intercept === 0 &&
    model.decisionThreshold === 0 &&
    Number.isFinite(model.tieTolerance) &&
    model.tieTolerance >= 0 &&
    ["weights", "mean", "scale"].every(
      (field) =>
        Array.isArray(model[field]) &&
        model[field].length === dimension &&
        model[field].every(Number.isFinite),
    ) &&
    model.mean.every((value) => value === 0) &&
    model.scale.every((value) => value > 0) &&
    Array.isArray(model.featureNames) &&
    model.featureNames.every((name, index) => name === FEATURE_NAMES[index]) &&
    model.featureNames.length === dimension;
  if (!valid)
    return { status: "invalid", winner: null, signal: null, contributions: [] };
  const contributions = values.map((value, index) => ({
    feature: FEATURE_NAMES[index],
    value,
    weight: model.weights[index],
    trainingScale: model.scale[index],
    contribution:
      (model.weights[index] * (value - model.mean[index])) / model.scale[index],
  }));
  const signal = contributions.reduce(
    (sum, item) => sum + item.contribution,
    0,
  );
  if (!Number.isFinite(signal))
    return { status: "invalid", winner: null, signal: null, contributions: [] };
  return {
    status: "complete",
    winner:
      Math.abs(signal) <= model.tieTolerance
        ? null
        : signal > 0
          ? "blue"
          : "red",
    signal,
    contributions: contributions.sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
    ),
  };
}

export function predictPreference(draft, knowledge, model) {
  const features = extractStructuralFeatures(draft, knowledge);
  if (features.status !== "complete")
    return {
      status: features.status,
      winner: null,
      signal: null,
      contributions: [],
    };
  return scoreFeatureVector(features.values, model);
}

export function draftFingerprint(record) {
  const a = ROLES.map((role) => record.blue?.[role] ?? "").join("|"),
    b = ROLES.map((role) => record.red?.[role] ?? "").join("|");
  return a < b ? `${a}//${b}` : `${b}//${a}`;
}

// Metadata is used only for split construction, never as model features.
export function buildLeakageGroups(records) {
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error("Unique cohort-prefixed record identifiers are required");
  const parents = records.map((_, index) => index),
    seen = new Map();
  const root = (index) =>
    parents[index] === index ? index : (parents[index] = root(parents[index]));
  records.forEach((record, index) => {
    const videos = [
      ...new Set([record.video, ...(record.duplicateVideos ?? [])]),
    ].filter(Boolean);
    if (!videos.length)
      throw new Error("A source video is required for grouped evaluation");
    for (const token of [
      ...videos.map((video) => `video:${video}`),
      `draft:${draftFingerprint(record)}`,
    ]) {
      if (seen.has(token)) parents[root(index)] = root(seen.get(token));
      else seen.set(token, index);
    }
  });
  const members = new Map();
  records.forEach((record, index) => {
    const group = root(index);
    if (!members.has(group)) members.set(group, []);
    members.get(group).push(record.id);
  });
  const groupById = new Map();
  for (const ids of members.values()) {
    const group = [...ids].sort()[0];
    for (const id of ids) groupById.set(id, group);
  }
  return groupById;
}

export function stableHash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function assignGroupFolds(
  records,
  groupById,
  requestedFolds = DISTILLATION_CONFIG.folds,
  seed = DISTILLATION_CONFIG.seed,
) {
  const groups = new Map();
  for (const record of records) {
    const group = groupById.get(record.id);
    if (!group) throw new Error("Record missing leakage group");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(record.id);
  }
  const folds = Math.min(requestedFolds, groups.size);
  if (!Number.isSafeInteger(folds) || folds < 2)
    throw new Error("At least two independent groups are required");
  const loads = Array(folds).fill(0),
    byGroup = new Map();
  for (const [group, ids] of [...groups].sort(
    (a, b) =>
      b[1].length - a[1].length ||
      stableHash(`${seed}:${a[0]}`) - stableHash(`${seed}:${b[0]}`) ||
      a[0].localeCompare(b[0]),
  )) {
    const fold = loads.indexOf(Math.min(...loads));
    byGroup.set(group, fold);
    loads[fold] += ids.length;
  }
  return {
    folds,
    byId: new Map(
      records.map((record) => [
        record.id,
        byGroup.get(groupById.get(record.id)),
      ]),
    ),
    byGroup,
    loads,
  };
}
