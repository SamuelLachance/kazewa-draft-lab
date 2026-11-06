/** The calculator scores a partial board as if empty roles were a finished comp.
 * That inflates the first tank and a reactive support. This policy keeps that
 * number for the portrait, and ranks the action a draft can actually lock:
 * ADC, jungle or mid before a blind support or a blind top, named answers
 * first, and no credit for a hole the opponent has not picked yet. */
import { HOOK_SUPPORTS, ROLES, laneCounters, laneTargets } from "./engine.mjs";
import { LANES } from "./lanes.mjs";

const EARLY_ROLES = ["bot", "jng", "mid"];
// Cours 3 : ouvrir sur un ADC stable, un jungle, ou un flex. Pas sur le top ni le support.
export const STABLE_BOT = new Set(["Caitlyn", "Varus", "Aphelios", "Jinx", "Xayah"]);
// These rules describe a comp that does not exist while either side is still picking its first three.
const STRUCTURAL = new Set([
  "frontline_missing",
  "dps_missing",
  "tank_without_dps",
  "no_proactivity",
  "followup_missing",
  "isolated_catcher",
  "grid_teamfight",
  "grid_range",
  "grid_side",
  "grid_scaling",
  "grid_objectives",
  "double_tank_limited_damage",
  "carry_without_peel",
  "poke_without_peel",
  "early_timer",
  "coherent_block",
  "objective_plan",
  "protected_scaling",
  "immobile_into_catch",
  "burst_into_tanks",
  "multi_winconditions",
  "disengage_against_engage",
]);
// Answers stated beside the lane table: Milio loses to hooks, Nautilus is answered on the blind.
const EXTRA_COUNTERS = {
  Milio: [...HOOK_SUPPORTS],
  Nautilus: ["Renata Glasc", "Braum", "Taric"],
};
const SUPPORT_PAIRS = {
  Braum: ["Lucian", "Kog'Maw"],
};
const SUPPORT_TARGETS = {
  Braum: ["Draven"],
};

const round = (n) => Math.round(n * 100) / 100;
const other = (side) => (side === "blue" ? "red" : "blue");
const lockedCount = (picks, side) => ROLES.filter((role) => picks[side][role]).length;

function unique(names) {
  return [...new Set(names.filter(Boolean))];
}

function answersFor(champion, role) {
  const extra = role === "sup" ? EXTRA_COUNTERS[champion] || [] : [];
  return unique([...laneCounters(champion, role), ...extra]);
}

function targetsFor(champion, role) {
  const named = laneTargets(champion, role);
  if (role === "sup" && SUPPORT_TARGETS[champion])
    return unique([...named, ...SUPPORT_TARGETS[champion]]);
  return named;
}

export function orderingScore(result, picks, side) {
  const unfinished = lockedCount(picks, "blue") < 3 || lockedCount(picks, "red") < 3;
  let total = 0;
  for (const signal of result?.signals ?? []) {
    if (unfinished && STRUCTURAL.has(signal.id)) continue;
    total += (signal.side === "blue" ? 1 : -1) * signal.weight;
  }
  if (Object.is(total, -0)) total = 0;
  const signed = side === "blue" ? total : -total;
  return round(Object.is(signed, -0) ? 0 : signed);
}

export function assessPlacement({
  champion,
  role,
  result,
  side,
  picks,
  remaining,
  profile,
}) {
  const score = round(side === "blue" ? result.score : -result.score);
  const ordering = orderingScore(result, picks, side);
  const foe = other(side);
  const enemy = picks[foe][role] || null;
  const allies = new Set(ROLES.map((lane) => picks[side][lane]).filter(Boolean));
  // `picks` already contains this champion. What is still empty is what the draft can answer later.
  const open = ROLES.filter((lane) => !picks[side][lane]);
  const earlyOpen = EARLY_ROLES.some((lane) => open.includes(lane));
  const lastSlot = open.length === 0;
  const usualLeft = (LANES[champion] || []).filter(
    (lane) => lane === role || open.includes(lane),
  );
  const engage = profile?.engage || 0;
  const peel = profile?.peel || 0;
  const disengage = profile?.disengage || 0;
  const reactive = role === "sup" && engage < 2 && (peel >= 2 || disengage >= 1);
  const counters = enemy
    ? []
    : answersFor(champion, role).filter((name) => remaining.has(name));
  const wins = targetsFor(champion, role);
  const answered = Boolean(enemy && wins.includes(enemy));
  const loses = Boolean(enemy && answersFor(champion, role).includes(enemy));
  const paired =
    role === "sup" && (SUPPORT_PAIRS[champion] || []).some((name) => allies.has(name));
  const aimed =
    role === "sup" &&
    Boolean(picks[foe].bot) &&
    (SUPPORT_TARGETS[champion] || []).includes(picks[foe].bot);

  let adjustment = 0;
  const parts = [];
  const add = (amount, text) => {
    adjustment += amount;
    parts.push({ abs: Math.abs(amount), text });
  };

  if (loses) {
    add(-4, `${champion} perd déjà le matchup contre ${enemy}.`);
  } else if (answered) {
    add(2.25, `${champion} répond à ${enemy} sur cette lane.`);
  } else if (!lastSlot && earlyOpen && role === "top") {
    add(
      -6,
      "Blind top : l’adversaire peut encore choisir le compteur. ADC, jungle et mid passent avant.",
    );
  } else if (!lastSlot && earlyOpen && reactive && !paired && !aimed) {
    add(
      -6,
      "Blind réactif : ce soutien se prend quand son ADC ou sa cible est déjà lock.",
    );
  } else if (!lastSlot && earlyOpen && role === "sup" && !paired && !aimed) {
    add(
      -2.5,
      "Le soutien peut attendre : un ADC, un jungle ou un mid ouvre la draft.",
    );
  } else if (!lastSlot && !earlyOpen && role === "top" && !enemy && open.includes("sup")) {
    add(-1.25, "Le top ferme la draft, après le soutien.");
  }

  if (!enemy && counters.length)
    add(
      Math.max(-2.25, round(-0.75 * counters.length)),
      `Compteurs encore ouverts : ${counters.slice(0, 3).join(", ")}.`,
    );
  if (paired) add(0.75, `${champion} complète un duo déjà lock.`);
  if (aimed && !answered) add(2, `${champion} répond à ${picks[foe].bot} en bot.`);
  if (role === "bot" && !picks[foe].bot && STABLE_BOT.has(champion) && lockedCount(picks, side) < 3)
    add(1.5, "ADC stable pour ouvrir la draft.");
  if (role === "bot" && !picks[foe].bot && !STABLE_BOT.has(champion))
    add(-1.2, "Cet ADC se fait répondre plus facilement qu’un ADC stable.");
  if (usualLeft.length >= 2 && usualLeft.includes(role) && lockedCount(picks, side) < 3)
    add(0.8, "Flex : une autre lane habituelle reste libre.");

  const illusion = round(score - ordering);
  parts.sort((a, b) => b.abs - a.abs || a.text.localeCompare(b.text, "fr"));
  let strategy = parts[0]?.text ?? "";
  if (illusion >= 2 && !(parts[0]?.abs >= 2)) {
    const caveat =
      "Le calculateur compte les rôles vides de l’autre côté. Ce chiffre n’est pas encore un avantage de draft.";
    strategy = strategy ? `${caveat} ${strategy}` : caveat;
  }
  return {
    ordering,
    adjustment: round(adjustment),
    priority: round(ordering + adjustment),
    strategy,
  };
}
