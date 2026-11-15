/**
 * Precedent model: case-based reasoning on the drafts Kazewa already judged.
 *
 * Everything is learned from `train` inside `fit`. No external resource, no
 * dependency: plain arithmetic on tables, runnable in a browser.
 *
 * Composition components (all antisymmetric, positive = blue preferred):
 *   - "case":   every judged draft votes with its verdict, weighted by how much
 *               more the new draft resembles it in the same orientation than in
 *               the mirrored one. Similarity = sum of the rarity (idf) of the
 *               champions shared team for team (full weight in the same role,
 *               half off role), squared so that a precedent sharing several
 *               champions (duos, lane matchups) dominates one sharing a single.
 *   - "pairs":  champion-pair records. For each ally pair and each enemy pair
 *               present, the smoothed log-odds of the side he preferred.
 *   - "lanes":  same, restricted to the exact lane matchup (role, X vs Y).
 *   - "claims": his transferable arguments. An argument citing champions fires
 *               again when the same champions sit on the same relative sides;
 *               it votes with its smoothed pro/con record, weighted by the
 *               number of champions it ties together.
 *
 * Pick order ("stack"): a second vote, one weight per lane for "this side
 * locked later" (the reference process model), added to the composition vote
 * with a non-negative weight learned by leave-one-group-out inside `train`.
 * With vote "sign" the composition enters as one more vote in {-1, 0, +1}.
 * Without pick order the model answers with the composition vote alone.
 *
 * Verdict votes ("case", "pairs", "lanes") are weighted by his confidence
 * (1 to 3, divided by 2). "claims" does not use the verdicts at all.
 *
 * Delivered configuration: CONFIG at the bottom ("claims" + stacked pick
 * order). The other components are kept because they were evaluated; measured
 * leave-one-group-out agreement is in research/notes/precedent.md.
 */
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const sign = (c) => (c.label === "blue" ? 1 : -1);
const weightOf = (c) => (c.confidence || 1) / 2;
const team = (t) => ROLES.map((r) => t[r]);
const logOdds = (pro, con) => Math.log((pro + 1) / (con + 1));

/* ---------- case-level precedent ---------- */
function fitCase(train) {
  const df = new Map();
  for (const c of train)
    for (const name of new Set([...team(c.blue), ...team(c.red)]))
      df.set(name, (df.get(name) ?? 0) + 1);
  const n = train.length;
  const idf = (name) => Math.log((n + 1) / ((df.get(name) ?? 0) + 1));
  const sim = (a, b) => {
    let s = 0;
    for (const r of ROLES) {
      if (a[r] === b[r]) s += idf(a[r]);
      else for (const q of ROLES) if (b[q] === a[r]) s += 0.5 * idf(a[r]);
    }
    return s;
  };
  return (draft) => {
    let vote = 0;
    for (const c of train) {
      const same = sim(draft.blue, c.blue) + sim(draft.red, c.red);
      const flip = sim(draft.blue, c.red) + sim(draft.red, c.blue);
      vote += sign(c) * weightOf(c) * (same * same - flip * flip);
    }
    return vote;
  };
}

/* ---------- champion-pair records ---------- */
function fitPairs(train) {
  const ally = new Map(); // "A+B" (sorted) -> [preferred, not preferred]
  const enemy = new Map(); // "A>B" (A < B) -> [A's side preferred, B's side preferred]
  const bump = (map, key, slot, w) => {
    const s = map.get(key) ?? [0, 0];
    s[slot] += w;
    map.set(key, s);
  };
  for (const c of train) {
    const w = weightOf(c);
    const good = team(c[c.label]);
    const bad = team(c[c.label === "blue" ? "red" : "blue"]);
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        bump(ally, [good[i], good[j]].sort().join("+"), 0, w);
        bump(ally, [bad[i], bad[j]].sort().join("+"), 1, w);
      }
    for (const g of good)
      for (const b of bad)
        if (g < b) bump(enemy, g + ">" + b, 0, w);
        else bump(enemy, b + ">" + g, 1, w);
  }
  const allyOdds = (a, b) => {
    const s = ally.get(a < b ? a + "+" + b : b + "+" + a);
    return s ? logOdds(s[0], s[1]) : 0;
  };
  const enemyOdds = (a, b) => {
    const s = a < b ? enemy.get(a + ">" + b) : enemy.get(b + ">" + a);
    if (!s) return 0;
    return a < b ? logOdds(s[0], s[1]) : logOdds(s[1], s[0]);
  };
  return (draft) => {
    const blue = team(draft.blue);
    const red = team(draft.red);
    let vote = 0;
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        vote += allyOdds(blue[i], blue[j]) - allyOdds(red[i], red[j]);
    for (const b of blue) for (const r of red) vote += enemyOdds(b, r);
    return vote;
  };
}

/* ---------- exact lane matchups ---------- */
function fitLanes(train) {
  const lane = new Map(); // "role:A>B" -> weight of verdicts for A's side minus... kept as [pro, con]
  for (const c of train) {
    const w = weightOf(c);
    const foe = c.label === "blue" ? "red" : "blue";
    for (const r of ROLES) {
      const a = c[c.label][r];
      const b = c[foe][r];
      const key = a < b ? `${r}:${a}>${b}` : `${r}:${b}>${a}`;
      const s = lane.get(key) ?? [0, 0];
      s[a < b ? 0 : 1] += w;
      lane.set(key, s);
    }
  }
  return (draft) => {
    let vote = 0;
    for (const r of ROLES) {
      const a = draft.blue[r];
      const b = draft.red[r];
      const s = lane.get(a < b ? `${r}:${a}>${b}` : `${r}:${b}>${a}`);
      if (s) vote += a < b ? logOdds(s[0], s[1]) : logOdds(s[1], s[0]);
    }
    return vote;
  };
}

/* ---------- his transferable arguments ---------- */
function fitClaims(train, config = {}) {
  const sizes = config.claimSizes ?? "all"; // "all" | "single" | "multi" (ablations)
  const table = new Map(); // "A1,A2|B1" -> { a, b, pro, con } ; pro = cases arguing for the side holding A
  for (const c of train) {
    const blue = new Set(team(c.blue));
    const red = new Set(team(c.red));
    const perCase = new Map();
    for (const claim of c.claims ?? []) {
      if (!claim.transferable) continue;
      if (claim.favours !== "blue" && claim.favours !== "red") continue;
      const mine = claim.favours === "blue" ? blue : red;
      const theirs = claim.favours === "blue" ? red : blue;
      const names = [...new Set(claim.champions ?? [])];
      const f = names.filter((x) => mine.has(x)).sort();
      const o = names.filter((x) => theirs.has(x)).sort();
      const count = f.length + o.length;
      if (!count || (sizes === "single" && count > 1) || (sizes === "multi" && count < 2)) continue;
      const fk = f.join(",");
      const ok = o.join(",");
      const forward = fk >= ok;
      const key = forward ? fk + "|" + ok : ok + "|" + fk;
      const entry = perCase.get(key) ?? { a: forward ? f : o, b: forward ? o : f, net: 0 };
      entry.net += forward ? 1 : -1;
      perCase.set(key, entry);
    }
    for (const [key, e] of perCase) {
      if (!e.net) continue;
      const t = table.get(key) ?? { a: e.a, b: e.b, pro: 0, con: 0 };
      if (e.net > 0) t.pro += 1;
      else t.con += 1;
      table.set(key, t);
    }
  }
  const entries = [...table.values()];
  return (draft) => {
    const blue = new Set(team(draft.blue));
    const red = new Set(team(draft.red));
    const inside = (list, set) => list.every((x) => set.has(x));
    let vote = 0;
    for (const e of entries) {
      const size = e.a.length + e.b.length;
      if (inside(e.a, blue) && inside(e.b, red)) vote += size * logOdds(e.pro, e.con);
      else if (inside(e.a, red) && inside(e.b, blue)) vote -= size * logOdds(e.pro, e.con);
    }
    return vote;
  };
}

const COMPONENTS = { case: fitCase, pairs: fitPairs, lanes: fitLanes, claims: fitClaims };

/* ---------- L2 logistic regression without intercept (Newton) ---------- */
function logistic(X, y, lambda, frozen = []) {
  const d = X[0]?.length ?? 0;
  const live = [...Array(d).keys()].filter((j) => !frozen.includes(j));
  const w = new Array(d).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = live.map((j) => lambda * w[j]);
    const H = live.map((_, a) => live.map((_, b) => (a === b ? lambda : 0)));
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (const j of live) z += X[i][j] * w[j];
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const e = p - (y[i] ? 1 : 0);
      const v = p * (1 - p);
      for (let a = 0; a < live.length; a++) {
        const xa = X[i][live[a]];
        if (!xa) continue;
        g[a] += e * xa;
        for (let b = 0; b < live.length; b++) H[a][b] += v * xa * X[i][live[b]];
      }
    }
    // Solve H * step = g by Gaussian elimination.
    const n = live.length;
    const M = H.map((row, a) => [...row, g[a]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
      }
    }
    const step = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * step[k];
      step[r] = s / M[r][r];
    }
    let moved = 0;
    live.forEach((j, a) => {
      w[j] -= step[a];
      moved += step[a] * step[a];
    });
    if (moved < 1e-16) break;
  }
  return w;
}

const orderFeatures = (later) =>
  ROLES.map((r) => (later?.[r] === "blue" ? 1 : later?.[r] === "red" ? -1 : 0));

const rms = (values) =>
  Math.sqrt(values.reduce((n, v) => n + v * v, 0) / Math.max(1, values.length)) || 1;

/**
 * config.composition: list of component names ([] = none).
 * config.order: "none" | "only" | "stack".
 */
export function build(config) {
  const names = config.composition ?? [];
  const stack = config.order === "stack" && names.length > 0;
  return function fit(train) {
    const parts = names.map((name) => COMPONENTS[name](train, config));
    // Score of each training case as if it were unseen (its own group left out):
    // gives the honest size of each component, and the input of the stacking.
    const unseen = new Map();
    const scales = names.map(() => 1);
    if (stack || names.length > 1) {
      const raw = new Map();
      for (const group of new Set(train.map((c) => c.group))) {
        const rest = train.filter((c) => c.group !== group);
        const inner = names.map((name) => COMPONENTS[name](rest, config));
        for (const c of train) if (c.group === group) raw.set(c.id, inner.map((part) => part(c)));
      }
      names.forEach((_, k) => (scales[k] = rms([...raw.values()].map((v) => v[k]))));
      for (const [id, v] of raw) unseen.set(id, v.reduce((n, x, k) => n + x / scales[k], 0));
    }
    const total = stack ? rms([...unseen.values()]) : 1;
    // "sign": the composition enters the stacking as one more vote in {-1, 0, +1}, like a lane.
    const shape = config.vote === "sign" ? Math.sign : (v) => v;
    const composition = (draft) =>
      parts.reduce((n, part, k) => n + part(draft) / scales[k], 0) / total;
    if (config.order !== "stack" && config.order !== "only") return { score: (draft) => composition(draft) };

    const X = [];
    const y = [];
    for (const c of train) {
      const x = [...orderFeatures(c.later), stack ? shape(unseen.get(c.id) / total) : 0];
      X.push(x);
      y.push(c.label === "blue");
      X.push(x.map((v) => -v));
      y.push(c.label !== "blue");
    }
    let w = logistic(X, y, 2, stack ? [] : [5]);
    // The composition vote may only count in the direction of his verdicts; otherwise it is dropped.
    if (w[5] < 0) w = logistic(X, y, 2, [5]);
    return {
      weights: { ...Object.fromEntries(ROLES.map((r, j) => [r, w[j]])), composition: w[5] },
      score(draft, context) {
        const comp = composition(draft);
        if (!context?.later) return comp;
        const f = orderFeatures(context.later);
        return f.reduce((n, v, j) => n + v * w[j], 0) + w[5] * shape(comp);
      },
    };
  };
}

export const CONFIG = { composition: ["claims"], order: "stack", vote: "sign" };
export const fit = build(CONFIG);
