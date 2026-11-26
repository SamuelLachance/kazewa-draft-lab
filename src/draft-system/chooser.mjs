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
 * The pick is then judged on the team it can still become: the team is completed role by role
 * from the best options of each role, and the completed team is scored by the same costs and by Shanei's
 * composition checker (src/method.mjs compositionStatus). A pick that breaks a rule of the checker, or leaves one
 * no free champion can mend, is ranked after every other pick.
 *
 * Every state-dependent term is zero when the state does not trigger it. The
 * weights below are the only numbers that are not in the knowledge base.
 */
import { LANES } from "../lanes.mjs";
import { teamVector } from "./profile.mjs";
import { RULES, violations } from "./rules.mjs";
import { buildLinks } from "./links.mjs";
import { compositionStatus } from "../method.mjs";

const ROLES = ["top", "jng", "mid", "bot", "sup"];
const BLOCK = ["jng", "mid", "bot", "sup"];

// Weights of the terms that are not needs of the rules. Written here, not fitted.
export const WEIGHTS = Object.freeze({
  counter: 6, // one of their champions is bad against one of ours: whatever the role, a counter is a counter
  counterGood: 6, // one of ours is good against one of theirs, whatever the role (as much as a counter received)
  combo: 1, // a bad duo in the team
  comboGood: 1, // a good duo in the team, from his champion cards
  comboDocumented: 20, // a duo documented as a combo (his rule of topic combo): as much as a counter exchanged (a counter is counted on both sides)
  comboPull: 12, // a pick that leaves a documented duo of its champion open to the team
  comboMissing: 6, // a team of three or more with no documented duo: Shanei wants one in every draft
  immobileStack: 8, // each immobile champion beyond the first: two stack without counterplay (kp-67)
  blockTank: 8, // a team of three with no real tank in the block of four (sp-74, sr-0)
  antiSynergy: 8, // a poke or disengage block mixed with an engage or catch block (sf-6)
  blockFamily: 6, // a block of four that belongs to no family: two of its members share none (sf-1)
  fullDamage: 8, // a full AD or a full AP composition: the enemy stacks one resistance (sr-5, sp-75)
  family: 2, // a member outside the dominant family of a team of three or more (sf-5: one theme per composition)
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
  // Shanei's composition checker, read on the team a pick leaves: a rule it breaks, a piece it still lacks,
  // and a documented duo in the team (the draft is built on one). Each is a cost or a gain of the pick.
  shaneiBad: 10,
  breach: 100, // a pick that leaves a rule of Shanei broken, or that no free champion can mend: ranked after every other pick
  shaneiTodo: 1,
  shaneiDuo: 16,
  // The completion: the team a pick can still lead to, judged on the whole team (see completionValue).
  plan: 1,
  missingRole: 15, // a role the completion cannot fill with a champion of the pool
});

// The shortlist the completion is run for, and how many champions per role it draws its picks from.
const SHORTLIST = 30;
const POOL_PER_ROLE = 3;
// The replies the worst case of a pick runs: the strongest of them, besides those that punish the pick.
const REPLIES = 20;

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
      else if (sign > 0) combos -= links.strong(own[i].name, own[j].name) ? WEIGHTS.comboDocumented : WEIGHTS.comboGood;
    }
  // Shanei's structural checks, read from the knowledge base: at most one immobile champion, a real tank
  // in the block of four, and no mix of the poke or disengage families with the engage or catch ones.
  const immobiles = own.filter((m) => (champions[m.name]?.immobile ?? 0) >= 2).length;
  const immobileStack = WEIGHTS.immobileStack * Math.max(0, immobiles - 1);
  const blockTank = own.length >= 3 && !own.some((m) => BLOCK.includes(m.role) && links.info(m.name)?.tank) ? WEIGHTS.blockTank : 0;
  const damageTypes = new Set(own.map((m) => links.info(m.name)?.damage).filter(Boolean));
  // With four of one damage type, the fifth is of the other: Shanei's last pick (sp-75).
  const fullDamage = own.length >= 4 && damageTypes.size === 1 ? WEIGHTS.fullDamage : 0;
  const isEngage = (name) => [...links.families(name)].some((f) => f.startsWith("all-in"));
  const isPoke = (name) => !isEngage(name) && (links.families(name).has("poke") || links.families(name).has("disengage"));
  const mixed = own.length >= 3 && own.filter((m) => isEngage(m.name)).length >= 2 && own.filter((m) => isPoke(m.name)).length >= 2 ? WEIGHTS.antiSynergy : 0;
  // The block of four belongs to a family: two of its members share one (sf-1).
  const blockPicks = own.filter((m) => BLOCK.includes(m.role));
  const blockCount = new Map();
  for (const m of blockPicks) for (const f of links.families(m.name)) blockCount.set(f, (blockCount.get(f) ?? 0) + 1);
  const blockFamily = blockPicks.length >= 3 && Math.max(0, ...blockCount.values()) < 2 ? WEIGHTS.blockFamily : 0;
  parts.immobileStack = immobileStack;
  parts.blockTank = blockTank;
  parts.antiSynergy = mixed;
  parts.blockFamily = blockFamily;
  parts.fullDamage = fullDamage;
  total += (immobileStack + blockTank + mixed + blockFamily + fullDamage) * needsScale;
  // Shanei: one documented duo at least in every draft. A team of three with none is still short of it.
  let documentedDuo = false;
  for (let i = 0; i < own.length; i += 1)
    for (let j = i + 1; j < own.length; j += 1)
      if (links.strong(own[i].name, own[j].name)) documentedDuo = true;
  const duoMissing = own.length >= 3 && !documentedDuo ? WEIGHTS.comboMissing : 0;
  parts.comboMissing = duoMissing;
  total += duoMissing * needsScale;
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

/** A team as the checker reads it: role to name. */
const asTeam = (members) => Object.fromEntries(members.map((m) => [m.role, m.name]));

/**
 * Shanei's checker on a team: the rules it breaks (bad), the pieces it still lacks (todo), and whether it holds
 * a documented duo. A team of one has nothing to check yet.
 */
function checkTerm(own, enemy, { champions, links = NO_LINKS }) {
  if (!links.index || own.length < 2) return { total: 0, bad: [] };
  const status = compositionStatus(asTeam(own), asTeam(enemy), links.index, { profiles: champions });
  const items = status?.items ?? [];
  const bad = items.filter((item) => item.state === "bad").map((item) => item.rule);
  const todo = items.filter((item) => item.state === "todo").length;
  let duo = false;
  for (let i = 0; i < own.length && !duo; i += 1)
    for (let j = i + 1; j < own.length && !duo; j += 1) duo = links.strong(own[i].name, own[j].name);
  const total = -(WEIGHTS.shaneiBad * bad.length + WEIGHTS.shaneiTodo * todo) + (duo ? WEIGHTS.shaneiDuo : 0);
  return { total: round(total), bad };
}

/** The value of a whole team against the other: costs and Shanei's checker, the higher the better. */
function valueOf(team, enemy, ctx) {
  return -costOf(team, enemy, ctx).total + checkTerm(team, enemy, ctx).total;
}

/**
 * The value of the team a pick leads to: the team is completed role by role, each time with the best of a
 * small pool (the best options of each role, and the documented duos of the team's members). A pick is
 * judged on what its team can become, not on the reply of the moment: this is what makes a duo be built.
 */
function completionValue({ team, open, used, enemy, pool, links, ctx }) {
  let current = team;
  let roles = open;
  while (roles.length) {
    const extra = [];
    for (const m of current)
      for (const p of links.partners(m.name))
        if (!used.has(p)) for (const role of LANES[p] ?? []) if (roles.includes(role)) extra.push({ name: p, role });
    let best = null;
    for (const entry of [...pool, ...extra]) {
      if (used.has(entry.name) || !roles.includes(entry.role)) continue;
      const value = valueOf([...current, entry], enemy, ctx);
      if (!best || value > best.value) best = { entry, value };
    }
    if (!best) return valueOf(current, enemy, ctx) - WEIGHTS.missingRole * roles.length;
    current = [...current, best.entry];
    used.add(best.entry.name);
    roles = roles.filter((role) => role !== best.entry.role);
  }
  return valueOf(current, enemy, ctx);
}

/** How much `me` is worse off than `them`: the cost of them minus the cost of me. */
export function standing(me, them, ctx) {
  // Shanei's checker counts both ways: a reply that leaves our team a broken rule (sp-48: a stealable ultimate
  // beside their Sylas) weighs as a cost, and so does a broken rule of theirs.
  return costOf(them, me, ctx).total - costOf(me, them, ctx).total + checkTerm(me, them, ctx).total - checkTerm(them, me, ctx).total;
}

/**
 * The legal candidates for a side: free champions, in an open role of their lane table.
 * A champion whose lane roles are all taken is not refused: the system guesses where it
 * plays, and offers it in each open role; its best role is the guess.
 */
function candidates(open, taken) {
  const out = [];
  for (const [name, roles] of Object.entries(LANES)) {
    if (taken.has(name)) continue;
    const lanes = roles.filter((role) => open.includes(role));
    for (const role of lanes.length ? lanes : open) out.push({ name, role });
  }
  return out;
}

/**
 * The structural rules of Shanei that a pick must leave satisfiable: a pick that makes one of them
 * impossible to meet, with the champions still free, is ranked after the others (see WEIGHTS.breach).
 */
function structuralOk(c, mine, taken, links, champions, enemy = []) {
  const team = [...mine.members, { name: c.name, role: c.role }];
  const openAfter = mine.open.filter((r) => r !== c.role);
  const info = (name) => links.info(name);
  const free = (name) => name !== c.name && !taken.has(name);
  // The last role of the team needs a free champion that leaves no rule of Shanei's checker broken: the checker
  // reads the whole team only once it is complete, so this looks one pick ahead (sf-1, sp-74, sp-48…).
  if (openAfter.length === 1 && links.index) {
    const last = openAfter[0];
    const mended = LANE_CHAMPIONS.some((name) => {
      if (!free(name) || !(LANES[name] ?? []).includes(last)) return false;
      const status = compositionStatus(asTeam(team.concat([{ name, role: last }])), asTeam(enemy), links.index, { profiles: champions });
      return !(status?.items ?? []).some((item) => item.state === "bad");
    });
    if (!mended) return false;
  }
  // At most one immobile champion: two stack without counterplay (kp-67).
  if (team.filter((m) => (champions[m.name]?.immobile ?? 0) >= 2).length > 1) return false;
  // Four of one damage type: the last pick has to be the other type (sp-75, sr-5).
  const damage = team.map((m) => info(m.name)?.damage).filter(Boolean);
  if (team.length >= 4 && damage.length === team.length && new Set(damage).size === 1) {
    const other = damage[0] === "ad" ? "ap" : "ad";
    if (!openAfter.length || !LANE_CHAMPIONS.some((name) => free(name) && info(name)?.damage === other)) return false;
  }
  // A poke or disengage block never mixes with an engage or catch block (sf-6).
  const engage = team.filter((m) => [...links.families(m.name)].some((f) => f.startsWith("all-in"))).length;
  const poke = team.filter((m) => ![...links.families(m.name)].some((f) => f.startsWith("all-in")) && (links.families(m.name).has("poke") || links.families(m.name).has("disengage"))).length;
  if ((engage >= 2 && poke >= 1) || (poke >= 2 && engage >= 1)) return false;
  // A real tank in the block of four, while a block role is open (sp-74): a tank that is still free.
  if (team.length >= 3 && !team.some((m) => BLOCK.includes(m.role) && info(m.name)?.tank)) {
    if (!openAfter.some((r) => BLOCK.includes(r))) return false;
    if (!LANE_CHAMPIONS.some((name) => free(name) && info(name)?.tank)) return false;
  }
  // The block of four belongs to a family (sf-1): once three of its members share none, the last block role needs
  // a free champion that shares one of their families.
  const block = team.filter((m) => BLOCK.includes(m.role));
  if (block.length === 3) {
    const count = new Map();
    for (const m of block) for (const f of links.families(m.name)) count.set(f, (count.get(f) ?? 0) + 1);
    if (Math.max(0, ...count.values()) < 2) {
      const families = new Set(count.keys());
      const lastRoles = openAfter.filter((r) => BLOCK.includes(r));
      if (!lastRoles.length) return false;
      const fits = (name) => (LANES[name] ?? []).some((r) => lastRoles.includes(r)) && [...links.families(name)].some((f) => families.has(f));
      if (!LANE_CHAMPIONS.some((name) => free(name) && fits(name))) return false;
    }
  }
  return true;
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
    if (sign) reasons.push({ rule: "combo", with: x.name, saved: round(sign < 0 ? -WEIGHTS.combo : links.strong(candidate.name, x.name) ? WEIGHTS.comboDocumented : WEIGHTS.comboGood) });
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
export function bestPick(picks, side, { champions, bans = [], links = NO_LINKS, flexRoles = {}, limit = 5, role = null } = {}) {
  const ctx = { champions, links, needsScale: needsScaleOf(picks) };
  const state = stateOf(picks, bans, flexRoles);
  const mine = state[side];
  const theirs = state[side === "blue" ? "red" : "blue"];
  const lockFamily = lockFamilyOf(mine, theirs, state.taken, links);
  // The blind pick is chosen on its flexibility alone: the needs of an empty draft weigh nothing.
  const blindPhase = !mine.members.length && !theirs.members.length;
  // A flexible member (picked without a role) can give its role to a free one of its own: the role it holds
  // counts as open for a pick, and the pick moves the member to the free role.
  const movable = new Map();
  for (const m of mine.members)
    for (const r of m.flex ?? []) if (r !== m.role && mine.open.includes(r) && !movable.has(m.role)) movable.set(m.role, { member: m, to: r });
  const legal = candidates([...mine.open, ...movable.keys()], state.taken).filter((c) => !role || c.role === role);
  // The replies of the other side: each champion it could take next, once, with the role it would play. Ranked by
  // how much each would help that side now; the worst case of a pick runs the strongest of them and those that punish it.
  const replyEntries = [...new Map(candidates(theirs.open, state.taken).map((reply) => [reply.name, reply])).values()].map((reply) => {
    // Their reply is uncertain when it can still take several of their open roles.
    const roles = (LANES[reply.name] ?? []).filter((r) => theirs.open.includes(r));
    const member = roles.length >= 2 ? { name: reply.name, role: reply.role, flex: roles } : { name: reply.name, role: reply.role };
    return { name: reply.name, member, proxy: standing([...theirs.members, member], mine.members, ctx) };
  });
  replyEntries.sort((a, b) => b.proxy - a.proxy || a.name.localeCompare(b.name));
  const strongest = new Set(replyEntries.slice(0, REPLIES).map((e) => e.name));
  const options = legal
    .map((c) => {
    const move = mine.open.includes(c.role) ? null : movable.get(c.role);
    const ownAfter = move
      ? [...mine.members.map((m) => (m === move.member ? { ...m, role: move.to } : m)), { name: c.name, role: c.role }]
      : [...mine.members, { name: c.name, role: c.role }];
    const openAfter = move ? mine.open.filter((r) => r !== move.to) : mine.open.filter((role) => role !== c.role);
    const playable = (LANES[c.name] ?? []).filter((role) => openAfter.includes(role)).length;
    const flex = openAfter.length >= 2 ? WEIGHTS.flex * Math.max(0, playable - 1) : 0;
    let worst = Infinity;
    const taken = new Set([...state.taken, c.name]);
    // The worst reply: the replies of the strongest kind, and every reply that punishes this champion.
    const replies = replyEntries.filter((e) => e.name !== c.name && (strongest.has(e.name) || links.counter(c.name, e.name) < 0));
    if (!replies.length) worst = standing(ownAfter, theirs.members, ctx);
    for (const reply of replies) worst = Math.min(worst, standing(ownAfter, [...theirs.members, reply.member], ctx));
    const reasons = reasonsFor({ name: c.name, role: c.role }, mine.members, theirs.members, ctx);
    const family = familyTerm(c, mine, lockFamily, links, blindPhase);
    if (family.reason) reasons.push(family.reason);
    if (flex) reasons.push({ rule: "flex", saved: round(flex) });
    // Each counter of an enemy champion, whatever its role, comes on top of the needs.
    const answer = WEIGHTS.answer * theirs.members.reduce((sum, y) => sum + Math.sign(links.counter(c.name, y.name)), 0);
    // An empty draft has no needs: the blind pick is chosen on its families and roles alone.
    // A documented duo of the champion that the team can still take: the draft is built on such duos.
    const pull = !blindPhase && openAfter.length && links.partners(c.name).some((p) => p !== c.name && !state.taken.has(p) && !mine.members.some((m) => m.name === p)) ? WEIGHTS.comboPull : 0;
    // Shanei's composition checker on the team this pick leaves: the rules it breaks, its duo, what it still lacks.
    const check = blindPhase ? { total: 0, bad: [] } : checkTerm(ownAfter, theirs.members, ctx);
    if (check.total) reasons.push({ rule: "check", with: check.bad, saved: check.total });
    // A pick that breaks a rule of Shanei, or leaves one that no free champion can mend, is ranked after the others.
    const breach = !blindPhase && (!structuralOk(c, mine, state.taken, links, champions, theirs.members) || check.bad.length > 0) ? WEIGHTS.breach : 0;
    const score = blindPhase
      ? family.saved + 0.1 * flex
      : worst + flex + family.saved + answer + pull + check.total - breach;
    // The team's value right after the pick: the completion's pool also takes the picks that fix a need now.
    const value = blindPhase ? 0 : valueOf(ownAfter, theirs.members, ctx);
    return { champion: c.name, role: c.role, score: round(score), value, reasons, ownAfter, openAfter, taken };
  });
  // The completion: each option is judged on the team it can still become, from the best options of each role.
  if (!blindPhase && options.length) {
    const byScore = [...options].sort((a, b) => b.score - a.score);
    // The pool: the best of each role by score, and the best of each role by the value of the team it leaves.
    const pool = new Map();
    for (const ranking of [byScore, [...options].sort((a, b) => b.value - a.value)]) {
      const perRole = new Map();
      for (const option of ranking) {
        const count = perRole.get(option.role) ?? 0;
        if (count >= POOL_PER_ROLE) continue;
        perRole.set(option.role, count + 1);
        pool.set(`${option.champion}|${option.role}`, { name: option.champion, role: option.role });
      }
    }
    const poolList = [...pool.values()];
    const planned = new Map();
    for (const option of byScore.slice(0, SHORTLIST))
      planned.set(
        option,
        completionValue({
          team: option.ownAfter,
          open: option.openAfter,
          used: new Set(option.taken),
          enemy: theirs.members,
          pool: poolList,
          links,
          ctx,
        }),
      );
    // An option outside the shortlist is judged as the weakest of the shortlist: it is not run.
    const floor = Math.min(...planned.values());
    for (const option of options) option.score = round(option.score + WEIGHTS.plan * (planned.get(option) ?? floor));
  }
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
