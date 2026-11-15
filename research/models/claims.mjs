/**
 * Angle "claims": transfer of Kazewa's own arguments.
 *
 * From the training cases only, every structured claim
 * `{ tag, favours, champions, role, transferable }` is turned into evidence
 * about the champions it names, relative to where they sit in that draft:
 *   - single : the champion sits on the side the claim favours (+) or on the
 *              other side (-)                      -> champion sentiment
 *   - ally   : two named champions on the same side -> synergy (+) when the
 *              claim favours their side, anti-synergy (-) otherwise
 *   - cross  : one named champion on each side      -> "A beats B"
 *   - verdict: the side holding the champion is the side he prefers
 *   - lanes  : his `pick_order` arguments, per lane: does the argument favour
 *              the side that locked later in that lane?
 * A test draft is scored by the arguments that apply to it: same champions,
 * same ally / enemy relation.
 *
 * Sparsity and shrinkage:
 *   - the unit of evidence is the group (video / series), not the claim: a
 *     combo repeated over the five games of one series counts once (the sum
 *     inside a group is clamped to [-1, 1]);
 *   - an entry is net / (groups + k): one isolated mention is worth 1/(1+k),
 *     contradictory mentions cancel, an unseen pair is 0 (the model abstains);
 *   - the weights of the components are not chosen by hand: they are fitted
 *     inside `fit` by a small ridge logistic on out-of-group component values
 *     (each training case is scored with the tables minus its own group), so a
 *     component that does not transfer gets a weight near zero.
 *
 * Two heads are fitted: composition only (used when the pick order is hidden)
 * and composition + pick order (used when `context.later` is given).
 *
 * Dependency-free: plain arithmetic on tables built in `fit`.
 */
const ROLES = ["top", "jng", "mid", "bot", "sup"];

export const DEFAULT_CONFIG = {
  transferableOnly: true, // keep only the claims he / the extraction marked transferable
  skipTags: ["players_team"], // arguments about the players, not about the draft
  k: 1, // shrinkage pseudo-count, in groups
  // composition head. Delivered: synergies + matchups + verdict history.
  // "single" (champion sentiment from claims) is available but left out: his
  // opinion of a champion taken alone barely repeats from one series to the next.
  components: ["ally", "cross", "verdict"],
  orderComponents: ["later"], // extra features of the pick-order head
  stack: true, // fit component weights on out-of-group values (false: fixed weights)
  fixedWeights: { single: 0.5, ally: 1, cross: 1, verdict: 0.5 },
  lambda: 1, // ridge of the stacking logistic
};

/* ---------- evidence tables ---------- */

class Table {
  constructor(k) {
    this.k = k;
    this.raw = new Map(); // key -> Map(group -> signed sum)
    this.entries = new Map(); // key -> { net, n, byGroup }
  }
  add(key, group, value) {
    let groups = this.raw.get(key);
    if (!groups) this.raw.set(key, (groups = new Map()));
    groups.set(group, (groups.get(group) ?? 0) + value);
  }
  seal() {
    for (const [key, groups] of this.raw) {
      const byGroup = new Map();
      let net = 0;
      for (const [group, sum] of groups) {
        const e = Math.max(-1, Math.min(1, sum));
        byGroup.set(group, e);
        net += e;
      }
      this.entries.set(key, { net, n: byGroup.size, byGroup });
    }
    this.raw = null;
    return this;
  }
  /** Shrunk estimate; `exclude` removes the evidence of one group. */
  get(key, exclude) {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    let { net, n } = entry;
    if (exclude !== undefined && entry.byGroup.has(exclude)) {
      net -= entry.byGroup.get(exclude);
      n -= 1;
    }
    return n > 0 ? net / (n + this.k) : 0;
  }
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function buildTables(train, config) {
  const t = {
    single: new Table(config.k),
    ally: new Table(config.k),
    cross: new Table(config.k),
    verdict: new Table(config.k),
    lanes: new Table(config.k),
    singleOrder: new Table(config.k),
  };
  const skip = new Set(config.skipTags);
  for (const c of train) {
    const where = new Map();
    for (const role of ROLES) {
      where.set(c.blue[role], { side: "blue", role });
      where.set(c.red[role], { side: "red", role });
    }
    for (const [champion, at] of where)
      t.verdict.add(champion, c.group, at.side === c.label ? 1 : -1);

    for (const claim of c.claims ?? []) {
      if (claim.favours !== "blue" && claim.favours !== "red") continue;
      // His pick-order arguments, per lane: do they favour the later pick?
      if (claim.tag === "pick_order" && c.later && ROLES.includes(claim.role)) {
        const later = c.later[claim.role];
        if (later === "blue" || later === "red")
          t.lanes.add(claim.role, c.group, later === claim.favours ? 1 : -1);
      }
      if (skip.has(claim.tag)) continue;
      if (config.transferableOnly && !claim.transferable) continue;
      const named = [...new Set(claim.champions ?? [])].filter((x) => where.has(x));
      if (!named.length) continue;
      const fav = named.filter((x) => where.get(x).side === claim.favours);
      const foe = named.filter((x) => where.get(x).side !== claim.favours);
      const share = 1 / named.length;
      for (const x of fav) t.single.add(x, c.group, share);
      for (const x of foe) t.single.add(x, c.group, -share);
      if (c.later) {
        for (const x of named) {
          const at = where.get(x);
          const later = c.later[at.role];
          if (later !== "blue" && later !== "red") continue;
          const status = later === at.side ? "L" : "E";
          t.singleOrder.add(`${x}|${status}`, c.group, at.side === claim.favours ? share : -share);
        }
      }
      for (let i = 0; i < fav.length; i++)
        for (let j = i + 1; j < fav.length; j++) t.ally.add(pairKey(fav[i], fav[j]), c.group, 1);
      for (let i = 0; i < foe.length; i++)
        for (let j = i + 1; j < foe.length; j++) t.ally.add(pairKey(foe[i], foe[j]), c.group, -1);
      // cross: stored once per unordered pair, positive when the first name wins
      for (const a of fav)
        for (const b of foe) t.cross.add(pairKey(a, b), c.group, a < b ? 1 : -1);
    }
  }
  for (const table of Object.values(t)) table.seal();
  return t;
}

/* ---------- component values of a draft (all antisymmetric in blue/red) ---------- */

const laterSign = (later, role) =>
  later?.[role] === "blue" ? 1 : later?.[role] === "red" ? -1 : 0;

const COMPONENTS = {
  single(t, draft, later, ex) {
    let s = 0;
    for (const role of ROLES) s += t.single.get(draft.blue[role], ex) - t.single.get(draft.red[role], ex);
    return s;
  },
  verdict(t, draft, later, ex) {
    let s = 0;
    for (const role of ROLES) s += t.verdict.get(draft.blue[role], ex) - t.verdict.get(draft.red[role], ex);
    return s;
  },
  ally(t, draft, later, ex) {
    let s = 0;
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        s += t.ally.get(pairKey(draft.blue[ROLES[i]], draft.blue[ROLES[j]]), ex);
        s -= t.ally.get(pairKey(draft.red[ROLES[i]], draft.red[ROLES[j]]), ex);
      }
    return s;
  },
  cross(t, draft, later, ex) {
    let s = 0;
    for (const rb of ROLES)
      for (const rr of ROLES) {
        const a = draft.blue[rb];
        const b = draft.red[rr];
        if (a === b) continue;
        const v = t.cross.get(pairKey(a, b), ex);
        s += a < b ? v : -v;
      }
    return s;
  },
  // pick-order components: zero when the pick order is not given
  lanes(t, draft, later, ex) {
    let s = 0;
    for (const role of ROLES) s += laterSign(later, role) * t.lanes.get(role, ex);
    return s;
  },
  singleOrder(t, draft, later, ex) {
    let s = 0;
    for (const role of ROLES) {
      const l = laterSign(later, role);
      if (!l) continue;
      s += t.singleOrder.get(`${draft.blue[role]}|${l > 0 ? "L" : "E"}`, ex);
      s -= t.singleOrder.get(`${draft.red[role]}|${l < 0 ? "L" : "E"}`, ex);
    }
    return s;
  },
};
const LATER = ROLES.map((role) => (t, draft, later) => laterSign(later, role));

/* ---------- ridge logistic without intercept (Newton), features antisymmetric ---------- */

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

function fitLogistic(X, y, lambda) {
  const d = X[0]?.length ?? 0;
  const w = new Array(d).fill(0);
  for (let it = 0; it < 40; it++) {
    const g = w.map((v) => lambda * v);
    const H = w.map((_, a) => w.map((__, b) => (a === b ? lambda : 0)));
    for (let i = 0; i < X.length; i++) {
      const row = X[i];
      let z = 0;
      for (let a = 0; a < d; a++) z += row[a] * w[a];
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const e = p - (y[i] ? 1 : 0);
      const s = p * (1 - p);
      for (let a = 0; a < d; a++) {
        g[a] += e * row[a];
        for (let b = 0; b < d; b++) H[a][b] += s * row[a] * row[b];
      }
    }
    const step = solve(H, g);
    let move = 0;
    for (let a = 0; a < d; a++) {
      w[a] -= step[a];
      move = Math.max(move, Math.abs(step[a]));
    }
    if (move < 1e-9) break;
  }
  return w;
}

/* ---------- model ---------- */

export function makeModel(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  function fit(train) {
    const tables = buildTables(train, config);

    // A head = list of feature functions + scale + weights.
    const makeHead = (names, withLater, cases) => {
      let features;
      if (config.stack || !names.some((n) => n in config.fixedWeights)) {
        features = names.map((name) => COMPONENTS[name]);
      } else {
        // fixed weights: the composition components collapse into one feature
        const fixed = names.filter((n) => n in config.fixedWeights);
        const rest = names.filter((n) => !(n in config.fixedWeights));
        features = [
          (t, d, l, ex) =>
            fixed.reduce((s, n) => s + config.fixedWeights[n] * COMPONENTS[n](t, d, l, ex), 0),
          ...rest.map((name) => COMPONENTS[name]),
        ];
      }
      if (withLater) features = [...features, ...LATER];
      if (!config.stack && features.length === 1) {
        return { features, scale: [1], w: [1] };
      }
      // out-of-group values of every feature on the training cases
      const X = cases.map((c) =>
        features.map((f) => f(tables, { blue: c.blue, red: c.red }, c.later, c.group)),
      );
      const scale = features.map((_, j) => {
        const ms = X.reduce((s, row) => s + row[j] * row[j], 0) / Math.max(1, X.length);
        return ms > 0 ? 1 / Math.sqrt(ms) : 0;
      });
      for (const row of X) for (let j = 0; j < row.length; j++) row[j] *= scale[j];
      const w = fitLogistic(X, cases.map((c) => c.label === "blue"), config.lambda);
      return { features, scale, w };
    };

    const orderNames = config.orderComponents.filter((n) => n !== "later");
    const compHead = makeHead(config.components, false, train);
    const orderHead = makeHead(
      [...config.components, ...orderNames],
      config.orderComponents.includes("later"),
      train.filter((c) => c.later),
    );
    const run = (head, draft, later) =>
      head.features.reduce(
        (s, f, j) => s + head.w[j] * head.scale[j] * f(tables, draft, later, undefined),
        0,
      );
    return {
      tables,
      heads: { composition: compHead, order: orderHead },
      score(draft, context) {
        return context?.later
          ? run(orderHead, draft, context.later)
          : run(compHead, draft, null);
      },
    };
  }
  return { fit, config };
}

export const { fit } = makeModel();
