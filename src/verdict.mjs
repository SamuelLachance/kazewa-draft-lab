/**
 * What the site answers for a draft. Every complete draft gets a verdict.
 *
 * 1. Kazewa judged this exact draft: his verdict, his reasons, his video.
 * 2. He did not: the site reads the draft the way his corpus allows, from the
 *    most reliable reading to the coarsest, and says which one it used:
 *      - the arguments he gave about the same champions in other drafts;
 *      - his champion cards (who is good with whom, who is punished by whom);
 *      - his composition principles, applied by the structural calculator.
 *    Each reading comes with the agreement measured for it on the drafts he
 *    did judge. The last ones are little better than a coin: the site says so.
 *
 * The pick order is not a reading. It looked like one on 195 drafts; on 268 it
 * does no better than always naming the same side, and it adds nothing to his
 * arguments. scripts/evaluate.mjs keeps measuring it so this stays checkable.
 */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { applicableArguments, precedents, recall } from "./memory.mjs";
import { cardReading } from "./relations.mjs";

export const NEAR_SHARED = 8;

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
 *   arguments   the side his arguments from other drafts lean to
 *   cards       his champion cards
 *   principles  his composition principles (structural calculator)
 *   balance     nothing separates the two compositions
 */
export function chooseReading({ argumentSide, cardSide, calculatorSide }) {
  if (argumentSide) return { basis: "arguments", side: argumentSide };
  if (cardSide) return { basis: "cards", side: cardSide };
  if (calculatorSide) return { basis: "principles", side: calculatorSide };
  return { basis: "balance", side: "even" };
}
const sideOrNull = (side) => (side === "blue" || side === "red" ? side : null);

/**
 * Full answer for a draft.
 * `memory` is the index from indexMemory(). `relations` comes from
 * cardRelations(champion cards). `model.reliability` holds the measured
 * agreement of each reading.
 *
 * `lean` is the one side every screen shows, with where it comes from:
 * `memory` (his verdict), `undecided` (he commented without choosing), or one
 * of the readings of chooseReading().
 */
export function judgeDraft(
  draft,
  { knowledge, memory = null, model = null, relations = null } = {},
) {
  const structure = analyzeDraft(draft, knowledge);
  if (structure.status !== "complete")
    return {
      status: structure.status,
      source: null,
      lean: { basis: "none", side: "even" },
      kazewa: null,
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
  const close = precedents(canonical, memory);
  const near = !kazewa && close[0]?.sharedChampions >= NEAR_SHARED ? close[0] : null;
  const said = applicableArguments(canonical, memory, { limit: Infinity });
  const saidLean = argumentLean(said);
  const cards = cardReading(canonical, relations);
  const estimate = chooseReading({
    argumentSide: sideOrNull(saidLean.side),
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
    arguments: said,
    precedents: close,
    near,
    structure,
    warnings: structure.warnings,
  };
}
