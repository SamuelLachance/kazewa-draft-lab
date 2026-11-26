/**
 * The needs of a team, written as rules of the accumulated knowledge
 * (data/knowledge.json, rules). A rule measures how much a team is missing
 * what it needs, given what the other team does. It is zero when the rule does
 * not apply to this draft: the needs are adaptive, they depend on the state.
 *
 * `violation(own, other)` returns a non-negative amount; `weight` is the rule's
 * weight in the knowledge base. The thresholds are written here, in the open,
 * and are the only numbers of this module.
 */

// Rules of the knowledge base, by id. Each returns how much the team is missing it.
export const RULES = Object.freeze({
  // frontline_missing: no functional frontline (two frontline functions at least).
  frontline_missing: {
    weight: 3,
    violation: (own) => Math.max(0, 2 - own.frontline),
  },
  // dps_missing: no sustained damage (two dps functions at least).
  dps_missing: {
    weight: 3,
    violation: (own) => Math.max(0, 2 - own.dps),
  },
  // tank_without_dps: a frontline that has nothing to protect in damage.
  tank_without_dps: {
    weight: 2,
    violation: (own) => (own.frontline >= 2 && own.dps < 2 ? 1 : 0),
  },
  // burst_into_tanks: burst does not get through a block of tanks.
  burst_into_tanks: {
    weight: 3,
    violation: (own, other) => (own.burst >= 2 && other.frontline >= 3 && own.dps < 2 ? own.burst - 1 : 0),
  },
  // immobile_into_catch: immobile targets face a catch.
  immobile_into_catch: {
    weight: 3,
    violation: (own, other) => (other.catch >= 2 && own.immobile >= 3 ? own.immobile - 2 : 0),
  },
  // disengage_against_engage: an all-in plan needs a disengage block.
  disengage_against_engage: {
    weight: 2,
    violation: (own, other) => (other.engage >= 3 ? Math.max(0, 2 - own.disengage) : 0),
  },
  // poke_without_peel: poke that cannot be protected.
  poke_without_peel: {
    weight: 2,
    violation: (own) => (own.poke >= 2 && own.peel < 1 ? 1 : 0),
  },
  // carry_without_peel: a scaling carry with no protection.
  carry_without_peel: {
    weight: 2,
    violation: (own) => (own.scaling >= 2 && own.peel < 1 ? 1 : 0),
  },
  // scaling_without_bridge: several scalers with no early-mid bridge.
  scaling_without_bridge: {
    weight: 2,
    violation: (own) => (own.scaling >= 2 && own.bridge < 1 ? 1 : 0),
  },
  // anti_dash: the other side dashes repeatedly and nothing answers it.
  anti_dash: {
    weight: 2,
    violation: (own, other) => (other.dashs >= 3 && own.anti_dash < 1 ? 1 : 0),
  },
  // global_against_split: a side lane pressure with no global answer.
  global_against_split: {
    weight: 1.5,
    violation: (own, other) => (other.split >= 2 && own.global < 1 ? 1 : 0),
  },
  // coherent_block: a frontline, damage and disengage block, all three.
  coherent_block: {
    weight: 1.5,
    violation: (own) => (own.frontline >= 1 && own.dps >= 1 ? Math.max(0, 1 - own.disengage) : 0),
  },
  // initiation_without_followup: an engage with nothing to follow up.
  followup_missing: {
    weight: 1.5,
    violation: (own) => (own.engage >= 2 && own.follow_up < 1 ? 1 : 0),
  },
  // multi_winconditions: a team with one way to win.
  multi_winconditions: {
    weight: 1,
    violation: (own) => {
      const ways = [own.scaling >= 2, own.frontline + own.engage >= 4, own.split + own.global >= 2].filter(Boolean).length;
      return Math.max(0, 2 - ways);
    },
  },
  // no_proactivity: no reliable tool to turn pressure into a fight.
  no_proactivity: {
    weight: 1,
    violation: (own) => (own.engage + own.catch + own.burst < 2 ? 1 : 0),
  },
});

/** Weighted sum of the rule violations of `own` against `other`, with the per-rule amounts. */
export function violations(own, other) {
  const parts = {};
  let total = 0;
  for (const [id, rule] of Object.entries(RULES)) {
    const amount = rule.violation(own, other);
    parts[id] = amount;
    total += rule.weight * amount;
  }
  return { total, parts };
}
