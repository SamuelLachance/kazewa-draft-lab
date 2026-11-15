/**
 * Draft process, second pass. Same raw material as process.mjs (for each lane,
 * the side that locked its champion later), but:
 *
 *  - lanes are pooled in three blocks instead of five weights:
 *      solo lanes (top + mid), jungle, bot lane (bot + sup);
 *  - optional interactions of the counter-pick with label-free facts:
 *      confirmed  the later champion beats the blind one in professional games
 *      vulnerable the blind-picked champion is an immobile carry (immobile = 2)
 *      safe       the blind-picked champion is a true tank (frontline = 2)
 *      flex       the blind-picked champion is often played in another role,
 *                 so the "answer" was given without knowing the lane
 *      majority   which side answered three lanes or more
 *  - when the pick order is unknown, it can be imputed from professional
 *    games: how often each champion of the lane is the later pick.
 *
 * Everything that touches a verdict is fitted in `fit` on the training fold.
 * `prepare` only reads professional games (no verdict) and champion profiles.
 *
 * The delivered configuration is CONFIG below. The other configurations that
 * were evaluated are listed in research/notes/process.md.
 */
import { fitLogistic, ROLES } from "../harness.mjs";

const CONFIG = {
  base: "groups", // "groups" (solo, jungle, bot lane), "lanes" (one per lane) or "count" (one weight)
  extras: [], // any of: confirmed, vulnerable, safe, flex, majority
  impute: true, // score drafts without pick order from pro-game pick habits
  lambdaBase: 2,
  lambdaExtra: 20,
};

const FIRST_SLOTS = [1, 4, 5, 8, 9];
const SECOND_SLOTS = [2, 3, 6, 7, 10];
const GROUP_OF = { top: 0, jng: 1, mid: 0, bot: 2, sup: 2 };
const other = (side) => (side === "blue" ? "red" : "blue");

/** Label-free tables from professional games. */
export function prepare(resources) {
  const matchup = new Map(); // role:A>B -> [games, wins of A's team]
  const laterPair = new Map(); // role:A>B -> [games, A locked later]
  const slot = new Map(); // role:A -> [games, sum of pick slots]
  const inRole = new Map(); // role:A -> games
  const total = new Map(); // A -> games
  const bump = (map, key, a, b) => {
    const s = map.get(key);
    if (s) {
      s[0] += a;
      s[1] += b;
    } else map.set(key, [a, b]);
  };
  for (const g of resources.proGames()) {
    const first = g.firstPick ?? "blue";
    const slots = {};
    let complete = true;
    for (const side of ["blue", "red"])
      for (const role of ROLES) {
        const champion = g[side][role];
        bump(inRole, role + ":" + champion, 1, 0);
        bump(total, champion, 1, 0);
        const index = (g.order?.[side] ?? []).indexOf(champion);
        if (index < 0) complete = false;
        else slots[side + role] = (side === first ? FIRST_SLOTS : SECOND_SLOTS)[index];
      }
    for (const role of ROLES) {
      const b = g.blue[role];
      const r = g.red[role];
      bump(matchup, role + ":" + b + ">" + r, 1, g.winner === "blue" ? 1 : 0);
      bump(matchup, role + ":" + r + ">" + b, 1, g.winner === "red" ? 1 : 0);
      if (!complete) continue;
      const blueLater = slots["blue" + role] > slots["red" + role] ? 1 : 0;
      bump(laterPair, role + ":" + b + ">" + r, 1, blueLater);
      bump(laterPair, role + ":" + r + ">" + b, 1, 1 - blueLater);
      bump(slot, role + ":" + b, 1, slots["blue" + role]);
      bump(slot, role + ":" + r, 1, slots["red" + role]);
    }
  }
  return { matchup, laterPair, slot, inRole, total, profiles: resources.knowledge.champions };
}

function tools(tables, config) {
  const { matchup, laterPair, slot, inRole, total, profiles } = tables;
  /** Smoothed win-rate edge of champion a against b in this role (pro games). */
  const edge = (role, a, b) => {
    const s = matchup.get(role + ":" + a + ">" + b);
    return s ? (s[1] + 10) / (s[0] + 20) - 0.5 : 0;
  };
  const meanSlot = (role, a) => {
    const s = slot.get(role + ":" + a);
    return s ? (s[1] + 5.5 * 5) / (s[0] + 5) : 5.5;
  };
  /** Probability that champion a was locked after b in this role. */
  const laterProbability = (role, a, b) => {
    const d = meanSlot(role, a) - meanSlot(role, b);
    const prior = 1 / (1 + Math.exp(-d / 1.5));
    const s = laterPair.get(role + ":" + a + ">" + b);
    return s ? (s[1] + 4 * prior) / (s[0] + 4) : prior;
  };
  const flex = (role, a) =>
    1 - ((inRole.get(role + ":" + a)?.[0] ?? 0) + 1) / ((total.get(a)?.[0] ?? 0) + 1);

  const baseSize = config.base === "groups" ? 3 : config.base === "count" ? 1 : 5;
  const additive = config.extras.filter((name) => name !== "majority");
  const size = baseSize + config.extras.length;
  const scale = Math.sqrt(config.lambdaBase / config.lambdaExtra);

  /** Contribution of one lane when `side` is the later pick (blue-positive). */
  const laneVector = (draft, role, side, weight, x) => {
    const sign = (side === "blue" ? 1 : -1) * weight;
    const late = draft[side][role];
    const blind = draft[other(side)][role];
    x[config.base === "groups" ? GROUP_OF[role] : config.base === "count" ? 0 : ROLES.indexOf(role)] += sign;
    additive.forEach((name, k) => {
      let on = 0;
      if (name === "confirmed") on = edge(role, late, blind) > 0.01 ? 1 : 0;
      else if (name === "vulnerable") on = (profiles[blind]?.immobile ?? 0) >= 2 ? 1 : 0;
      else if (name === "safe") on = (profiles[blind]?.frontline ?? 0) >= 2 ? 1 : 0;
      else if (name === "flex") on = flex(role, blind) > 0.15 ? 1 : 0;
      x[baseSize + k] += sign * on * scale;
    });
  };

  /** Antisymmetric feature vector, or null when nothing is known. */
  const features = (draft, later) => {
    if (!later && !config.impute) return null;
    const x = new Array(size).fill(0);
    let balance = 0;
    for (const role of ROLES) {
      if (later?.[role] === "blue" || later?.[role] === "red") {
        laneVector(draft, role, later[role], 1, x);
        balance += later[role] === "blue" ? 1 : -1;
      } else if (config.impute) {
        const p = laterProbability(role, draft.blue[role], draft.red[role]);
        laneVector(draft, role, "blue", p, x);
        laneVector(draft, role, "red", 1 - p, x);
        balance += 2 * p - 1;
      }
    }
    if (config.extras.includes("majority"))
      x[size - 1] = Math.max(-1, Math.min(1, balance)) * scale;
    return x;
  };
  return { features, size };
}

export function fit(train, resources, prepared) {
  const tables = prepared ?? prepare(resources);
  const { features, size } = tools(tables, CONFIG);
  const X = [];
  const y = [];
  for (const c of train) {
    if (!c.later) continue; // weights are learned from real pick orders only
    const x = features({ blue: c.blue, red: c.red }, c.later);
    X.push(x);
    y.push(c.label === "blue");
    X.push(x.map((v) => -v));
    y.push(c.label !== "blue");
  }
  const w = X.length ? fitLogistic(X, y, { lambda: CONFIG.lambdaBase }) : new Array(size).fill(0);
  return {
    weights: w,
    score(draft, context) {
      const x = features(draft, context?.later ?? null);
      return x ? x.reduce((n, v, j) => n + v * w[j], 0) : 0;
    },
  };
}
