/**
 * The draft system: what to pick next, and who is ahead in a finished draft.
 *
 * A team's cost is what it still lacks, given the other team (the needs of
 * rules.mjs), plus what its own picks do to each other (duos, good or bad), what
 * they do to the other team (counters), and how coherent its families are.
 * A pick is judged by the cost it leaves for its team, minus the cost it leaves
 * for the other team, after the other team's best reply: a two-step lookahead.
 * A pick also keeps value when it can still fill several open roles (flex).
 *
 * Every state-dependent term is zero when the state does not trigger it: no
 * all-in, no answer needed; no counter named, no counter counted; no open role,
 * no flex value. The weights below are the only numbers that are not in the knowledge base.
 */
import { LANES } from "../lanes.mjs";
import { teamVector } from "./profile.mjs";
import { RULES, violations } from "./rules.mjs";
import { buildLinks } from "./links.mjs";

const ROLES = ["top", "jng", "mid", "bot", "sup"];

// Weights of the terms that are not needs of the rules. Written here, not fitted.
export const WEIGHTS = Object.freeze({
  counter: 1, // one of their picks is bad against one of ours
  counterGood: 0.5, // one of ours is good against one of theirs
  combo: 1, // a bad duo in the team
  comboGood: 0.5, // a good duo in the team
  family: 0.5, // a member outside the dominant family of a team of three or more
  flex: 0.25, // each extra open role a pick can still fill
});

const NO_LINKS = buildLinks({});

/** The draft state: who has what, in which role, and what is still open. */
export function stateOf(picks, bans = []) {
  const taken = new Set([...bans].filter(Boolean));
  const side = (team) => {
    const members = [];
    for (const role of ROLES) {
      const name = team?.[role] ?? null;
      if (name) {
        members.push({ name, role });
        taken.add(name);
      }
    }
    return { members, names: members.map((m) => m.name), open: ROLES.filter((role) => !team?.[role]) };
  };
  const blue = side(picks?.blue);
  const red = side(picks?.red);
  return { blue, red, taken };
}

/**
 * What a team costs, given the other team. `own` and `enemy` are lists of
 * { name, role }. Returns the total and the amount of each term.
 */
export function costOf(own, enemy, { champions, links = NO_LINKS }) {
  const ownVector = teamVector(own.map((m) => m.name), champions);
  const enemyVector = teamVector(enemy.map((m) => m.name), champions);
  const rules = violations(ownVector, enemyVector);
  const parts = { ...rules.parts };
  let total = rules.total;

  let counters = 0;
  for (const x of own)
    for (const y of enemy) {
      const sign = links.counter(x.name, y.name);
      if (sign < 0) counters += WEIGHTS.counter;
      else if (sign > 0) counters -= WEIGHTS.counterGood;
    }
  let combos = 0;
  for (let i = 0; i < own.length; i += 1)
    for (let j = i + 1; j < own.length; j += 1) {
      const sign = links.combo(own[i].name, own[j].name);
      if (sign < 0) combos += WEIGHTS.combo;
      else if (sign > 0) combos -= WEIGHTS.comboGood;
    }
  let family = 0;
  if (own.length >= 3) {
    const count = new Map();
    for (const m of own) for (const f of links.families(m.name)) count.set(f, (count.get(f) ?? 0) + 1);
    const dominant = Math.max(0, ...count.values());
    family = WEIGHTS.family * (own.length - dominant);
  }
  parts.counters = counters;
  parts.combos = combos;
  parts.family = family;
  total += counters + combos + family;
  return { total, parts };
}

/** How much `me` is worse off than `them`: the cost of them minus the cost of me. */
export function standing(me, them, ctx) {
  return costOf(them, me, ctx).total - costOf(me, them, ctx).total;
}

/** The legal candidates for a side: free champions, of an open role of their lane table. */
function candidates(open, taken) {
  const out = [];
  for (const [name, roles] of Object.entries(LANES)) {
    if (taken.has(name)) continue;
    for (const role of roles) if (open.includes(role)) out.push({ name, role });
  }
  return out;
}

/** What one candidate changes for its team, term by term: the reasons of the pick. */
function reasonsFor(candidate, own, enemy, ctx) {
  const { links = NO_LINKS, champions } = ctx;
  const before = costOf(own, enemy, ctx);
  const after = costOf([...own, candidate], enemy, ctx);
  const reasons = [];
  for (const id of Object.keys(RULES)) {
    const saved = before.parts[id] * RULES[id].weight - after.parts[id] * RULES[id].weight;
    if (Math.abs(saved) > 1e-9) reasons.push({ rule: id, saved: round(saved) });
  }
  for (const x of own) {
    const sign = links.combo(candidate.name, x.name);
    if (sign) reasons.push({ rule: "combo", with: x.name, saved: round(sign < 0 ? -WEIGHTS.combo : WEIGHTS.comboGood) });
  }
  for (const y of enemy) {
    const sign = links.counter(candidate.name, y.name);
    if (sign) reasons.push({ rule: "counter", with: y.name, saved: round(sign < 0 ? -WEIGHTS.counter : WEIGHTS.counterGood) });
  }
  const famSaved = before.parts.family - after.parts.family;
  if (Math.abs(famSaved) > 1e-9) reasons.push({ rule: "family", saved: round(famSaved) });
  return reasons.filter((r) => r.saved !== 0 && champions[candidate.name]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The best pick for `side` in this state, best first, with its reasons.
 * `picks` is { blue: {top, jng, mid, bot, sup}, red: {...} }; `bans` a list of names.
 */
export function bestPick(picks, side, { champions, bans = [], links = NO_LINKS, limit = 5 } = {}) {
  const ctx = { champions, links };
  const state = stateOf(picks, bans);
  const mine = state[side];
  const theirs = state[side === "blue" ? "red" : "blue"];
  const options = candidates(mine.open, state.taken).map((c) => {
    const ownAfter = [...mine.members, c];
    const openAfter = mine.open.filter((role) => role !== c.role);
    const playable = (LANES[c.name] ?? []).filter((role) => openAfter.includes(role)).length;
    const flex = openAfter.length >= 2 ? WEIGHTS.flex * Math.max(0, playable - 1) : 0;
    let worst = Infinity;
    const replies = candidates(theirs.open, new Set([...state.taken, c.name]));
    if (!replies.length) worst = standing(ownAfter, theirs.members, ctx);
    for (const reply of replies) {
      const theirAfter = [...theirs.members, reply];
      worst = Math.min(worst, standing(ownAfter, theirAfter, ctx));
    }
    const reasons = reasonsFor(c, mine.members, theirs.members, ctx);
    if (flex) reasons.push({ rule: "flex", saved: round(flex) });
    return { champion: c.name, role: c.role, score: round(worst + flex), reasons };
  });
  // One entry per champion: its best role in this state.
  const best = new Map();
  for (const option of options) {
    const previous = best.get(option.champion);
    if (!previous || option.score > previous.score) best.set(option.champion, option);
  }
  const ranked = [...best.values()];
  ranked.sort((a, b) => b.score - a.score || a.champion.localeCompare(b.champion));
  return ranked.slice(0, limit);
}

/**
 * Who is ahead in a finished draft. Positive score: blue. Counted by the same
 * terms on both sides, so swapping the sides swaps the verdict.
 */
export function judgeDraft(picks, { champions, links = NO_LINKS }) {
  const state = stateOf(picks);
  const score = standing(state.blue.members, state.red.members, { champions, links });
  const side = score > 0 ? "blue" : score < 0 ? "red" : "even";
  return { side, score: round(score) };
}
