/**
 * Reference model: the draft process. For each lane, which side locked its
 * champion later (the counter-pick). One weight per lane, fitted on the
 * training folds. Without pick order it abstains (score 0).
 */
import { fitLogistic, ROLES } from "../harness.mjs";

const features = (later) =>
  ROLES.map((role) => (later[role] === "blue" ? 1 : later[role] === "red" ? -1 : 0));

export function fit(train) {
  const X = [];
  const y = [];
  for (const c of train) {
    if (!c.later) continue;
    const x = features(c.later);
    X.push(x);
    y.push(c.label === "blue");
    X.push(x.map((v) => -v));
    y.push(c.label !== "blue");
  }
  const w = fitLogistic(X, y, { lambda: 2 });
  return {
    weights: Object.fromEntries(ROLES.map((role, i) => [role, w[i]])),
    score(draft, context) {
      if (!context?.later) return 0;
      return features(context.later).reduce((n, v, j) => n + v * w[j], 0);
    },
  };
}
