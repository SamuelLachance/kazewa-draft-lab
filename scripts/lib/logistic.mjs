/** L2 logistic regression without intercept. X rows are antisymmetric features. */
export function fitLogistic(
  X,
  y,
  { lambda = 1, weights = null, iterations = 400 } = {},
) {
  const n = X.length;
  const d = n ? X[0].length : 0;
  const w = new Float64Array(d);
  let step = 1;
  const loss = (v) => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let z = 0;
      const row = X[i];
      for (let j = 0; j < d; j++) z += row[j] * v[j];
      const m = Math.max(-30, Math.min(30, y[i] ? z : -z));
      total += (weights ? weights[i] : 1) * Math.log1p(Math.exp(-m));
    }
    let reg = 0;
    for (let j = 0; j < d; j++) reg += v[j] * v[j];
    return total + 0.5 * lambda * reg;
  };
  let current = loss(w);
  const g = new Float64Array(d);
  const trial = new Float64Array(d);
  for (let it = 0; it < iterations; it++) {
    g.fill(0);
    for (let i = 0; i < n; i++) {
      let z = 0;
      const row = X[i];
      for (let j = 0; j < d; j++) z += row[j] * w[j];
      const p = 1 / (1 + Math.exp(-z));
      const e = (p - (y[i] ? 1 : 0)) * (weights ? weights[i] : 1);
      for (let j = 0; j < d; j++) g[j] += e * row[j];
    }
    let norm = 0;
    for (let j = 0; j < d; j++) {
      g[j] += lambda * w[j];
      norm += g[j] * g[j];
    }
    if (norm < 1e-10) break;
    let improved = false;
    for (let k = 0; k < 30; k++) {
      for (let j = 0; j < d; j++) trial[j] = w[j] - step * g[j];
      const next = loss(trial);
      if (next < current - 1e-4 * step * norm) {
        w.set(trial);
        current = next;
        step *= 1.5;
        improved = true;
        break;
      }
      step *= 0.5;
    }
    if (!improved) break;
  }
  return Array.from(w);
}
