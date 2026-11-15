/**
 * What the site answers for a draft.
 *
 * 1. Kazewa judged this exact draft: his verdict, his reasons, his video.
 * 2. He did not: the drafts he judged that look most like it, the arguments he
 *    gave about the same champions, and a tendency built from two readings
 *    that were measured on drafts held out: the side his own arguments lean
 *    to, and the pick order.
 *
 * The structural calculator stays available as a description of the two
 * compositions. Its score is not presented as his verdict.
 */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { applicableArguments, precedents, recall } from "./memory.mjs";

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
 * Tendency for a draft Kazewa did not judge. Positive score favours blue.
 * Only the pick order carries a measured signal: the side that answers in a
 * lane. Without it the tendency is "none", not a guess. Only the direction
 * was measured: the size of the score means nothing.
 */
export function tendency({ later = null, model = null } = {}) {
  const order = normalizeLater(later);
  const weights = model?.process?.weights;
  if (!order || !weights)
    return {
      basis: "none",
      side: "even",
      score: 0,
      parts: [],
      reliability: model?.reliability?.withoutOrder ?? null,
    };
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
 * Full answer for a draft.
 * `memory` is the index from indexMemory(). `later` is optional pick order.
 *
 * `lean` is the one side every screen shows, with where it comes from:
 *   memory     his verdict on this draft
 *   undecided  he commented this draft and did not choose
 *   both       his arguments and the pick order point to the same side
 *   arguments  the side his arguments from other drafts lean to
 *   order      measured tendency from the pick order
 *   split      his arguments and the pick order point to opposite sides
 *   near       his verdict on a draft that shares eight champions or more
 *   none       nothing reliable to say
 */
export function judgeDraft(draft, { knowledge, memory = null, model = null, later = null } = {}) {
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
  // A judged draft carries its real pick order. A typed one overrides it.
  // While the visitor is typing an order, only what is typed counts.
  const order = later ? normalizeLater(later) : (kazewa?.later ?? null);
  const close = precedents(canonical, memory);
  const lean = tendency({ later: order, model });
  const near = !kazewa && close[0]?.sharedChampions >= NEAR_SHARED ? close[0] : null;
  const said = applicableArguments(canonical, memory, { limit: Infinity });
  const saidLean = argumentLean(said);
  const orderSide = lean.basis === "order" && lean.side !== "even" ? lean.side : null;
  const saidSide = saidLean.side !== "even" ? saidLean.side : null;
  const estimate =
    saidSide && orderSide
      ? saidSide === orderSide
        ? { basis: "both", side: saidSide }
        : { basis: "split", side: "even" }
      : saidSide
        ? { basis: "arguments", side: saidSide }
        : orderSide
          ? { basis: "order", side: orderSide }
          : near
            ? { basis: "near", side: near.verdict.side }
            : { basis: "none", side: "even" };
  return {
    status: "complete",
    source: decided ? "memory" : kazewa ? "memory_undecided" : "unseen",
    winner: decided ? kazewa.verdict.side : null,
    lean: decided
      ? { basis: "memory", side: kazewa.verdict.side }
      : kazewa
        ? { basis: "undecided", side: "even" }
        : estimate,
    // What the two measured readings say, whatever the headline is.
    estimate,
    argumentLean: saidLean,
    reliability: model?.reliability ?? null,
    kazewa,
    tendency: lean,
    later: order,
    arguments: said,
    precedents: close,
    near,
    structure,
    warnings: structure.warnings,
  };
}
