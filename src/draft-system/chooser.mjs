/**
 * The draft system: what to pick next, and who is ahead in a finished draft.
 *
 * A team's cost is what it still lacks, given the other team (the needs of
 * rules.mjs), plus five terms that depend on the state of the draft:
 *   - counters, whatever the role: a champion of one team against a champion of
 *     the other team;
 *   - flexibility: an enemy champion still able to take several roles costs us
 *     the worst of the roles we leave empty;
 *   - duos, good or bad, inside the team;
 *   - families: a team of three or more with members outside its dominant family.
 *
 * A pick is judged by the cost it leaves for its team, minus the cost it leaves
 * for the other team, after the other team's best reply: a two-step lookahead,
 * so that the pick is never worse than the reply the other side can make to it.
 * Our own flexible picks keep value while they can still fill open roles.
 *
 * Every state-dependent term is zero when the state does not trigger it. The
 * weights below are the only numbers that are not in the knowledge base.
 */
import { LANES } from "../lanes.mjs";
import { teamVector } from "./profile.mjs";
import { RULES, violations } from "./rules.mjs";
import { buildLinks } from "./links.mjs";

const ROLES = ["top", "jng", "mid", "bot", "sup"];

// Weights of the terms that are not needs of the rules. Written here, not fitted.
export const WEIGHTS = Object.freeze({
  counter: 6, // one of their champions is bad against one of ours: whatever the role, a counter is a counter
  counterGood: 6, // one of ours is good against one of theirs, whatever the role (as much as a counter received)
  combo: 1, // a bad duo in the team
  comboGood: 0.5, // a good duo in the team
  family: 0.5, // a member outside the dominant family of a team of three or more
  flex: 0.25, // each extra open role one of our picks can still fill
  flexThreat: 1, // the weight of the worst role an enemy flex can take against us
  unanswered: 0.5, // a role an enemy flex can take, where we have no champion yet
  blindFamily: 1.5, // blind pick: each family the champion can join
  blindRole: 0.5, // blind pick: each extra open role the champion can fill
  blindThin: 2, // blind pick: a champion of fewer than two families does not open the draft
  // The answer comes first: each counter of an enemy champion is worth more than one need of its team.
  answer: 6,
  // The needs of the rules weigh this much at the first pick, and all of them at the last: they are filled late in the draft.
  needsEarly: 0.2,
  lock: 1, // after the blind pick: a champion of the locked family
  leave: 1, // after the blind pick: a champion outside the locked family (an answer can still win)
});

const LANE_CHAMPIONS = Object.keys(LANES);

/**
 * The family a team locks into once its blind pick is down: the family of its
 * members that answers the other team best (members in it, and enemy members it
 * has a counter for). Null while the team has no pick: the blind phase.
 */
function lockFamilyOf(mine, theirs, taken, links) {
  if (!mine.members.length) return null;
  const ours = new Map();
  for (const m of mine.members) for (const f of links.families(m.name)) ours.set(f, (ours.get(f) ?? 0) + 1);
  let best = null;
  for (const family of [...ours.keys()].sort()) {
    const answers = theirs.members.filter((e) =>
      LANE_CHAMPIONS.some((c) => !taken.has(c) && links.families(c).has(family) && links.counter(c, e.name) > 0),
    ).length;
    const score = 2 * ours.get(family) + answers;
    if (!best || score > best.score) best = { family, score };
  }
  return best ? best.family : null;
}

/** The family term of one candidate: the blind pick's flexibility, or the locked family. */
function familyTerm(candidate, mine, lockFamily, links, blindPhase) {
  if (blindPhase) {
    const families = links.families(candidate.name).size;
    const roles = (LANES[candidate.name] ?? []).filter((role) => mine.open.includes(role)).length;
    const thin = families < 2 ? WEIGHTS.blindThin : 0;
    const saved = round(WEIGHTS.blindFamily * families + WEIGHTS.blindRole * Math.max(0, roles - 1) - thin);
    return { saved, reason: { rule: "blind", saved } };
  }
  if (!lockFamily) return { saved: 0, reason: null };
  const inside = links.families(candidate.name).has(lockFamily);
  const saved = inside ? WEIGHTS.lock : -WEIGHTS.leave;
  return { saved, reason: { rule: "lock", with: lockFamily, saved } };
}

const NO_LINKS = buildLinks({});

/**
 * The draft state. `flexRoles` maps a champion to the roles it could still take
 * when it was picked without a role. A member of an uncertain pick carries
 * `flex`: the roles it can still take among the open ones.
 */
export function stateOf(picks, bans = [], flexRoles = {}) {
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
    const open = ROLES.filter((role) => !team?.[role]);
    for (const member of members) {
      const roles = flexRoles[member.name];
      if (!roles || roles.length < 2) continue;
      const possible = roles.filter((role) => open.includes(role) || role === member.role);
      if (possible.length >= 2) member.flex = possible;
    }
    return { members, names: members.map((m) => m.name), open };
  };
  const blue = side(picks?.blue);
  const red = side(picks?.red);
  return { blue, red, taken };
}

/** The cost of one counter in a lane: positive when `a` is bad against `b`. */
function counterCost(links, a, b) {
  const sign = links.counter(a, b);
  if (sign < 0) return WEIGHTS.counter;
  if (sign > 0) return -WEIGHTS.counterGood;
  return 0;
}

/** What an uncertain enemy flex costs `own`: its worst role, where we have no answer. */
function exposureOf(own, flexMember, ctx) {
  const { links = NO_LINKS } = ctx;
  let worst = -Infinity;
  for (const role of flexMember.flex) {
    // A role we fill is answered by the counters of its champion, which the sum above already counts, whatever the role.
    const cost = own.some((m) => m.role === role) ? 0 : WEIGHTS.unanswered;
    worst = Math.max(worst, cost);
  }
  return WEIGHTS.flexThreat * worst;
}

/**
 * What a team costs, given the other team. `own` and `enemy` are lists of
 * { name, role, flex? }. Returns the total and the amount of each term.
 */
export function costOf(own, enemy, { champions, links = NO_LINKS, needsScale = 1 }) {
  const ownVector = teamVector(own.map((m) => m.name), champions);
  const enemyVector = teamVector(enemy.map((m) => m.name), champions);
  const rules = violations(ownVector, enemyVector);
  const parts = { ...rules.parts };
  let total = rules.total * needsScale;

  // Counters are not lane bound: a champion counters another through its kit (an ultimate stolen,
  // a fight it wins), whichever role the other one plays.
  let counters = 0;
  for (const x of own) for (const y of enemy) counters += counterCost(links, x.name, y.name);
  let exposure = 0;
  for (const e of enemy) if (e.flex) exposure += exposureOf(own, e, { links });
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
  parts.flexThreat = exposure;
  parts.combos = combos;
  parts.family = family;
  total += counters + exposure + combos + family;
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

/** The reasons of one candidate: what its pick changes for its team, term by term. */
function reasonsFor(candidate, own, enemy, ctx) {
  const { links = NO_LINKS, champions, needsScale = 1 } = ctx;
  const before = costOf(own, enemy, ctx);
  const after = costOf([...own, candidate], enemy, ctx);
  const reasons = [];
  for (const id of Object.keys(RULES)) {
    const saved = (before.parts[id] - after.parts[id]) * RULES[id].weight * needsScale;
    if (Math.abs(saved) > 1e-9) reasons.push({ rule: id, saved: round(saved) });
  }
  for (const y of enemy) {
    const sign = links.counter(candidate.name, y.name);
    if (sign) reasons.push({ rule: "counter", with: y.name, saved: round(sign * WEIGHTS.answer) });
  }
  for (const x of own) {
    const sign = links.combo(candidate.name, x.name);
    if (sign) reasons.push({ rule: "combo", with: x.name, saved: round(sign < 0 ? -WEIGHTS.combo : WEIGHTS.comboGood) });
  }
  for (const e of enemy) {
    if (!e.flex) continue;
    const saved = exposureOf(own, e, ctx) - exposureOf([...own, candidate], e, ctx);
    if (Math.abs(saved) > 1e-9) reasons.push({ rule: "flexThreat", with: e.name, saved: round(saved) });
  }
  const famSaved = before.parts.family - after.parts.family;
  if (Math.abs(famSaved) > 1e-9) reasons.push({ rule: "family", saved: round(famSaved) });
  return reasons.filter((r) => r.saved !== 0 && champions[candidate.name]);
}

/** The weight of the needs at this point of the draft: low at the first pick, full once ten picks are made. */
function needsScaleOf(picks) {
  const made = ROLES.reduce((n, role) => n + (picks?.blue?.[role] ? 1 : 0) + (picks?.red?.[role] ? 1 : 0), 0);
  const fraction = Math.min(1, made / 10);
  return WEIGHTS.needsEarly + (1 - WEIGHTS.needsEarly) * fraction;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The best pick for `side` in this state, best first, with its reasons.
 * `picks` is { blue: {top, jng, mid, bot, sup}, red: {...} }; `bans` a list of
 * names; `flexRoles` the roles a champion could still take, for the uncertain picks.
 */
export function bestPick(picks, side, { champions, bans = [], links = NO_LINKS, flexRoles = {}, limit = 5 } = {}) {
  const ctx = { champions, links, needsScale: needsScaleOf(picks) };
  const state = stateOf(picks, bans, flexRoles);
  const mine = state[side];
  const theirs = state[side === "blue" ? "red" : "blue"];
  const lockFamily = lockFamilyOf(mine, theirs, state.taken, links);
  // The blind pick is chosen on its flexibility alone: the needs of an empty draft weigh nothing.
  const blindPhase = !mine.members.length && !theirs.members.length;
  const options = candidates(mine.open, state.taken).map((c) => {
    const ownAfter = [...mine.members, { name: c.name, role: c.role }];
    const openAfter = mine.open.filter((role) => role !== c.role);
    const playable = (LANES[c.name] ?? []).filter((role) => openAfter.includes(role)).length;
    const flex = openAfter.length >= 2 ? WEIGHTS.flex * Math.max(0, playable - 1) : 0;
    let worst = Infinity;
    const taken = new Set([...state.taken, c.name]);
    const replies = candidates(theirs.open, taken);
    if (!replies.length) worst = standing(ownAfter, theirs.members, ctx);
    for (const reply of replies) {
      // Their reply is uncertain when it can still take several of their open roles.
      const roles = (LANES[reply.name] ?? []).filter((r) => theirs.open.includes(r));
      const member = roles.length >= 2 ? { name: reply.name, role: reply.role, flex: roles } : { name: reply.name, role: reply.role };
      worst = Math.min(worst, standing(ownAfter, [...theirs.members, member], ctx));
    }
    const reasons = reasonsFor({ name: c.name, role: c.role }, mine.members, theirs.members, ctx);
    const family = familyTerm(c, mine, lockFamily, links, blindPhase);
    if (family.reason) reasons.push(family.reason);
    if (flex) reasons.push({ rule: "flex", saved: round(flex) });
    // Each counter of an enemy champion, whatever its role, comes on top of the needs.
    const answer = WEIGHTS.answer * theirs.members.reduce((sum, y) => sum + Math.sign(links.counter(c.name, y.name)), 0);
    // An empty draft has no needs: the blind pick is chosen on its families and roles alone.
    const score = blindPhase
      ? family.saved + 0.1 * flex
      : worst + flex + family.saved + answer;
    return { champion: c.name, role: c.role, score: round(score), reasons };
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
export function judgeDraft(picks, { champions, links = NO_LINKS, flexRoles = {} }) {
  const state = stateOf(picks, [], flexRoles);
  const score = standing(state.blue.members, state.red.members, { champions, links });
  const side = score > 0 ? "blue" : score < 0 ? "red" : "even";
  return { side, score: round(score) };
}
