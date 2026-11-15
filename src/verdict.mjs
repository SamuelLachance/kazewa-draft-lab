/**
 * What the site answers for a draft. Every complete draft gets a verdict.
 *
 * 1. Kazewa judged this exact draft: his verdict, his reasons, his video.
 * 2. He did not: the site reads the draft the way his corpus allows, from the
 *    most reliable reading to the coarsest, and says which one it used:
 *      - the arguments he gave about the same champions in other drafts,
 *        confirmed or contested by the pick order;
 *      - the pick order alone;
 *      - his champion cards (who is good with whom, who is punished by whom);
 *      - his composition principles, applied by the structural calculator.
 *    Each reading comes with the agreement measured for it on the drafts he
 *    did judge. The last ones are little better than a coin: the site says so.
 */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { applicableArguments, precedents, recall } from "./memory.mjs";
import { cardReading } from "./relations.mjs";

const SIDES = ["blue", "red"];
export const NEAR_SHARED = 8;
const flip = (side) => (side === "blue" ? "red" : "blue");
const round = (n) => Math.round(n * 100) / 100;

/** `later` is valid when every lane names the side that picked later. */
export function normalizeLater(later) {
  if (!later || typeof later !== "object") return null;
  const out = {};
  for (const role of ROLES) {
    if (!SIDES.includes(later[role])) return null;
    out[role] = later[role];
  }
  return out;
}

export function swapLater(later) {
  const value = normalizeLater(later);
  return value
    ? Object.fromEntries(ROLES.map((role) => [role, flip(value[role])]))
    : null;
}

/**
 * Pick-order reading. Positive score favours blue. Only the direction was
 * measured: the size of the score means nothing.
 */
export function tendency({ later = null, model = null } = {}) {
  const order = normalizeLater(later);
  const weights = model?.process?.weights;
  if (!order || !weights)
    return { basis: "none", side: "even", score: 0, parts: [], reliability: null };
  const parts = ROLES.map((role) => {
    const weight = Number(weights[role]) || 0;
    const signed = order[role] === "blue" ? weight : -weight;
    return {
      role,
      later: order[role],
      // The side this lane's pick order pushes towards.
      favours: signed === 0 ? "even" : signed > 0 ? "blue" : "red",
      weight: round(Math.abs(weight)),
      signed,
    };
  });
  const score = parts.reduce((total, part) => total + part.signed, 0);
  return {
    basis: "order",
    side: score === 0 ? "even" : score > 0 ? "blue" : "red",
    score: round(score),
    parts: parts.map(({ signed, ...part }) => part),
    reliability: model?.reliability?.withOrder ?? null,
  };
}

/** Which side the arguments he gave elsewhere lean to on this draft. */
export function argumentLean(list) {
  const blue = list.filter((item) => item.favours === "blue").length;
  const red = list.filter((item) => item.favours === "red").length;
  return { blue, red, side: blue === red ? "even" : blue > red ? "blue" : "red" };
}

/**
 * The reading used for a draft he did not judge, in order of measured
 * reliability. Shared with the evaluation so that what is measured is what
 * is shown.
 *   both        his arguments and the pick order point to the same side
 *   arguments   his arguments, no pick order
 *   contested   his arguments, against the pick order
 *   order       the pick order, when no argument applies
 *   cards       his champion cards
 *   principles  his composition principles (structural calculator)
 *   balance     nothing separates the two compositions
 */
export function chooseReading({ argumentSide, orderSide, cardSide, calculatorSide }) {
  if (argumentSide && orderSide)
    return argumentSide === orderSide
      ? { basis: "both", side: argumentSide }
      : { basis: "contested", side: argumentSide };
  if (argumentSide) return { basis: "arguments", side: argumentSide };
  if (orderSide) return { basis: "order", side: orderSide };
  if (cardSide) return { basis: "cards", side: cardSide };
  if (calculatorSide) return { basis: "principles", side: calculatorSide };
  return { basis: "balance", side: "even" };
}
const sideOrNull = (side) => (side === "blue" || side === "red" ? side : null);

/**
 * Full answer for a draft.
 * `memory` is the index from indexMemory(). `later` is optional pick order.
 * `relations` comes from cardRelations(champion cards).
 *
 * `lean` is the one side every screen shows, with where it comes from:
 * `memory` (his verdict), `undecided` (he commented without choosing), or one
 * of the readings of chooseReading().
 */
export function judgeDraft(
  draft,
  { knowledge, memory = null, model = null, later = null, relations = null } = {},
) {
  const structure = analyzeDraft(draft, knowledge);
  if (structure.status !== "complete")
    return {
      status: structure.status,
      source: null,
      lean: { basis: "none", side: "even" },
      kazewa: null,
      tendency: null,
      arguments: [],
      precedents: [],
      near: null,
      structure,
      warnings: structure.warnings,
    };
  const canonical = {
    blue: Object.fromEntries(ROLES.map((role) => [role, structure.teams.blue.champions[role]])),
    red: Object.fromEntries(ROLES.map((role) => [role, structure.teams.red.champions[role]])),
  };
  const kazewa = recall(canonical, memory);
  const decided = Boolean(kazewa && kazewa.verdict.side !== "even");
  // While the visitor is typing an order, only what is typed counts.
  const order = later ? normalizeLater(later) : (kazewa?.later ?? null);
  const close = precedents(canonical, memory);
  const fromOrder = tendency({ later: order, model });
  const near = !kazewa && close[0]?.sharedChampions >= NEAR_SHARED ? close[0] : null;
  const said = applicableArguments(canonical, memory, { limit: Infinity });
  const saidLean = argumentLean(said);
  const cards = cardReading(canonical, relations);
  const estimate = chooseReading({
    argumentSide: sideOrNull(saidLean.side),
    orderSide: fromOrder.basis === "order" ? sideOrNull(fromOrder.side) : null,
    cardSide: sideOrNull(cards.side),
    calculatorSide: sideOrNull(structure.winner),
  });
  return {
    status: "complete",
    source: decided ? "memory" : kazewa ? "memory_undecided" : "unseen",
    winner: decided ? kazewa.verdict.side : null,
    lean: decided
      ? { basis: "memory", side: kazewa.verdict.side }
      : kazewa
        ? { basis: "undecided", side: "even" }
        : estimate,
    // What the readings say, whatever the headline is.
    estimate,
    argumentLean: saidLean,
    cardReading: cards,
    reliability: model?.reliability ?? null,
    kazewa,
    tendency: fromOrder,
    later: order,
    arguments: said,
    precedents: close,
    near,
    structure,
    warnings: structure.warnings,
  };
}
