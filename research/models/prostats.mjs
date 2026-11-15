/**
 * Angle "prostats": a draft win model fitted on professional games only.
 *
 * `prepare` (label-free) fits one sparse ridge logistic regression "blue wins"
 * on every professional game with four families of draft terms
 *   c  champion in a role                      (strength)
 *   m  champion A against champion B, same role (lane matchup)
 *   s  two champions of the same team           (duo synergy, 10 role pairs)
 *   x  champion A against an enemy in another role (cross-lane counter)
 * plus two nuisance terms that are dropped afterwards: one strength per
 * team-split (so a champion is not credited with the level of the teams that
 * pick it) and the blue-side advantage. The ridge of each family was chosen on
 * held-out professional games (winner log-loss), never on a Kazewa verdict.
 * Tables are global: a test draft carries no date, so nothing is looked up per
 * patch. `recency` only reweights the games once, towards the latest seasons.
 *
 * `fit` either uses the win model as is (its favourite side = the prediction),
 * or learns four weights, one per family, on the training verdicts.
 *
 * Unknown champions or pairs simply contribute 0, so any champion is accepted.
 * Composition only: the pick order in `context` is ignored.
 * No dependency, plain arithmetic: runs in a browser once the tables exist.
 */
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const PAIRS = [];
for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) PAIRS.push([ROLES[a], ROLES[b]]);
const FAMILIES = ["c", "m", "s", "x"];

/** Ridge per family, chosen on held-out professional games (label-free). */
const LAMBDA = { c: 20, m: 200, s: 600, x: 300, t: 1, b: 0 };

/** Sparse antisymmetric terms of a draft seen from blue: [key, sign]. */
function draftTerms(blue, red) {
  const out = [];
  for (const role of ROLES) {
    const A = blue[role];
    const B = red[role];
    if (A) out.push(["c|" + role + "|" + A, 1]);
    if (B) out.push(["c|" + role + "|" + B, -1]);
    if (A && B && A !== B)
      out.push(A < B ? ["m|" + role + "|" + A + "|" + B, 1] : ["m|" + role + "|" + B + "|" + A, -1]);
  }
  for (const [a, b] of PAIRS) {
    if (blue[a] && blue[b]) out.push(["s|" + a + "|" + blue[a] + "|" + b + "|" + blue[b], 1]);
    if (red[a] && red[b]) out.push(["s|" + a + "|" + red[a] + "|" + b + "|" + red[b], -1]);
    if (blue[a] && red[b]) out.push(["x|" + a + "|" + blue[a] + "|" + b + "|" + red[b], 1]);
    if (red[a] && blue[b]) out.push(["x|" + a + "|" + red[a] + "|" + b + "|" + blue[b], -1]);
  }
  return out;
}

/** L-BFGS on a weighted logistic loss with one ridge per column. */
function fitSparse(rows, lam, weights, iterations = 300, memory = 8) {
  const d = lam.length;
  const f = (w, g) => {
    g.fill(0);
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      const { idx, val, y } = rows[i];
      let z = 0;
      for (let k = 0; k < idx.length; k++) z += w[idx[k]] * val[k];
      const m = y * z;
      const wt = weights ? weights[i] : 1;
      total += wt * (m > 0 ? Math.log1p(Math.exp(-m)) : -m + Math.log1p(Math.exp(m)));
      const e = (-y * wt) / (1 + Math.exp(m));
      for (let k = 0; k < idx.length; k++) g[idx[k]] += e * val[k];
    }
    for (let j = 0; j < d; j++) {
      total += 0.5 * lam[j] * w[j] * w[j];
      g[j] += lam[j] * w[j];
    }
    return total;
  };
  const dot = (a, b) => {
    let s = 0;
    for (let j = 0; j < d; j++) s += a[j] * b[j];
    return s;
  };
  let w = new Float64Array(d);
  let g = new Float64Array(d);
  let fx = f(w, g);
  const S = [];
  const Y = [];
  const R = [];
  for (let it = 0; it < iterations; it++) {
    const q = Float64Array.from(g);
    const alpha = new Array(S.length);
    for (let k = S.length - 1; k >= 0; k--) {
      alpha[k] = R[k] * dot(S[k], q);
      for (let j = 0; j < d; j++) q[j] -= alpha[k] * Y[k][j];
    }
    const last = S.length - 1;
    const gamma = S.length ? dot(S[last], Y[last]) / dot(Y[last], Y[last]) : 1 / Math.max(1, Math.sqrt(dot(g, g)));
    for (let j = 0; j < d; j++) q[j] *= gamma;
    for (let k = 0; k < S.length; k++) {
      const beta = R[k] * dot(Y[k], q);
      for (let j = 0; j < d; j++) q[j] += S[k][j] * (alpha[k] - beta);
    }
    const slope = -dot(g, q);
    if (slope > -1e-12) break;
    let step = 1;
    const wn = new Float64Array(d);
    const gn = new Float64Array(d);
    let fn = 0;
    let ok = false;
    for (let ls = 0; ls < 25; ls++) {
      for (let j = 0; j < d; j++) wn[j] = w[j] - step * q[j];
      fn = f(wn, gn);
      if (fn <= fx + 1e-4 * step * slope) {
        ok = true;
        break;
      }
      step *= 0.5;
    }
    if (!ok) break;
    const s = new Float64Array(d);
    const yv = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      s[j] = wn[j] - w[j];
      yv[j] = gn[j] - g[j];
    }
    const sy = dot(s, yv);
    if (sy > 1e-12) {
      S.push(s);
      Y.push(yv);
      R.push(1 / sy);
      if (S.length > memory) {
        S.shift();
        Y.shift();
        R.shift();
      }
    }
    const gain = (fx - fn) / Math.max(1, Math.abs(fx));
    w = wn;
    g = gn;
    fx = fn;
    if (gain < 1e-7) break;
  }
  return w;
}

/**
 * Fits the win model. Returns `{ table: Map(term -> log-odds), scale }` where
 * `scale[family]` is the spread of that family's sum over professional drafts.
 * `halfLifeDays`: null = every game counts the same; otherwise a game counts
 * 0.5 ** (age / halfLife), age measured from the latest game of the data.
 */
export function buildTables(games, { halfLifeDays = null, teamControl = true } = {}) {
  const index = new Map();
  const lam = [];
  const id = (key) => {
    let i = index.get(key);
    if (i === undefined) {
      i = index.size;
      index.set(key, i);
      lam.push(LAMBDA[key[0]]);
    }
    return i;
  };
  const rows = [];
  const stamp = (g) => Date.parse(String(g.date).slice(0, 10)) || 0;
  let latest = 0;
  for (const g of games) latest = Math.max(latest, stamp(g));
  const weights = halfLifeDays ? new Float64Array(games.length) : null;
  games.forEach((g, n) => {
    const idx = [];
    const val = [];
    for (const [key, sign] of draftTerms(g.blue, g.red)) {
      idx.push(id(key));
      val.push(sign);
    }
    if (teamControl && g.teams?.blue && g.teams?.red) {
      idx.push(id("t|" + g.teams.blue + "|" + g.year + "|" + g.split));
      val.push(1);
      idx.push(id("t|" + g.teams.red + "|" + g.year + "|" + g.split));
      val.push(-1);
    }
    idx.push(id("b|side"));
    val.push(1);
    rows.push({ idx: Int32Array.from(idx), val: Float32Array.from(val), y: g.winner === "blue" ? 1 : -1 });
    if (weights) weights[n] = 0.5 ** ((latest - stamp(g)) / 86400000 / halfLifeDays);
  });
  const w = fitSparse(rows, Float64Array.from(lam), weights);
  const table = new Map();
  for (const [key, i] of index) if (FAMILIES.includes(key[0]) && w[i] !== 0) table.set(key, w[i]);
  const tables = { table, scale: { c: 1, m: 1, s: 1, x: 1 } };
  const sums = { c: 0, m: 0, s: 0, x: 0 };
  for (const g of games) {
    const part = components(tables, g);
    for (const k of FAMILIES) sums[k] += part[k] * part[k];
  }
  for (const k of FAMILIES) tables.scale[k] = Math.sqrt(sums[k] / Math.max(1, games.length)) || 1;
  return tables;
}

/** Log-odds of "blue wins" split by family, for a draft `{ blue, red }`. */
export function components(tables, draft) {
  const part = { c: 0, m: 0, s: 0, x: 0 };
  for (const [key, sign] of draftTerms(draft.blue, draft.red)) {
    const w = tables.table.get(key);
    if (w) part[key[0]] += sign * w;
  }
  return part;
}

/** Tiny ridge logistic without intercept (Newton), for the four family weights. */
function fitWeights(X, y, lambda) {
  const d = X[0].length;
  const w = new Array(d).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = w.map((v) => lambda * v);
    const H = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => (a === b ? lambda : 0)));
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (let j = 0; j < d; j++) z += X[i][j] * w[j];
      const p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < d; a++) {
        g[a] += (p - y[i]) * X[i][a];
        for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * X[i][a] * X[i][b];
      }
    }
    // Solve H * step = g by Gaussian elimination.
    const A = H.map((row, a) => [...row, g[a]]);
    for (let a = 0; a < d; a++) {
      let pivot = a;
      for (let r = a + 1; r < d; r++) if (Math.abs(A[r][a]) > Math.abs(A[pivot][a])) pivot = r;
      [A[a], A[pivot]] = [A[pivot], A[a]];
      for (let r = a + 1; r < d; r++) {
        const k = A[r][a] / A[a][a];
        for (let c = a; c <= d; c++) A[r][c] -= k * A[a][c];
      }
    }
    const step = new Array(d).fill(0);
    for (let a = d - 1; a >= 0; a--) {
      let v = A[a][d];
      for (let c = a + 1; c < d; c++) v -= A[a][c] * step[c];
      step[a] = v / A[a][a];
    }
    let moved = 0;
    for (let j = 0; j < d; j++) {
      w[j] -= step[j];
      moved += step[j] * step[j];
    }
    if (moved < 1e-18) break;
  }
  return w;
}

/**
 * Model factory.
 *   recency:     false = time-agnostic tables, true = half-life of 18 months.
 *   calibrate:   false = the win model decides alone; true = four weights
 *                (one per family) learned on the training verdicts.
 *   teamControl: false = raw tables, champions keep the credit of their teams.
 */
export function make({ recency = false, calibrate = false, teamControl = true, lambda = 2 } = {}) {
  return {
    prepare(resources) {
      return buildTables(resources.proGames(), { halfLifeDays: recency ? 548 : null, teamControl });
    },
    fit(train, resources, prepared) {
      const tables = prepared;
      const vector = (draft) => {
        const part = components(tables, draft);
        return FAMILIES.map((k) => part[k] / tables.scale[k]);
      };
      let weights = FAMILIES.map((k) => tables.scale[k]); // = plain sum of the log-odds
      if (calibrate && train.length) {
        const X = [];
        const y = [];
        for (const c of train) {
          const x = vector(c);
          X.push(x);
          y.push(c.label === "blue" ? 1 : 0);
          X.push(x.map((v) => -v));
          y.push(c.label === "blue" ? 0 : 1);
        }
        weights = fitWeights(X, y, lambda);
      }
      return {
        weights: Object.fromEntries(FAMILIES.map((k, i) => [k, weights[i]])),
        score(draft) {
          return vector(draft).reduce((n, v, j) => n + v * weights[j], 0);
        },
      };
    },
  };
}

// Delivered variant: the highest of the six evaluated, and still inside the
// chance band (see research/notes/prostats.md). No signal is claimed.
const chosen = make({ recency: true, calibrate: false });
export const prepare = chosen.prepare;
export const fit = chosen.fit;
