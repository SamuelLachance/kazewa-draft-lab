/**
 * What the site answers for a draft. Every complete draft gets a verdict.
 *
 * 1. Kazewa judged this exact draft: his verdict, his reasons, his video.
 * 2. He did not: the site reads the draft the way his corpus allows, from the
 *    most reliable reading to the coarsest, and says which one it used:
 *      - the result of the game, when this draft is a professional game that
 *        was already played: on the games he commented, the team he preferred
 *        is most often the team that won;
 *      - the arguments he gave about the same champions in other drafts;
 *      - his champion cards (who is good with whom, who is punished by whom);
 *      - his composition principles, applied by the structural calculator.
 *    Each reading comes with the agreement measured for it on the drafts he
 *    did judge. The last ones are little better than a coin: the site says so.
 *
 * Next to that, every draft is read with Shanei's grid (src/method.mjs): the
 * family of each composition and what he would fault in it. It is a second
 * opinion with its own side, shown as such. It is not part of the readings
 * above: on the drafts Kazewa judged, the composition Shanei's grid finds
 * healthier is the one Kazewa preferred about one time in two.
 *
 * The pick order is not a reading. It looked like one on 195 drafts; on 268 it
 * does no better than always naming the same side, and it adds nothing to his
 * arguments. scripts/evaluate.mjs keeps measuring it so this stays checkable.
 */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { applicableArguments, precedents, recall } from "./memory.mjs";
import { cardReading } from "./relations.mjs";
import { shaneiReading } from "./method.mjs";

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
 *   result      the side that won, when the draft is a game already played
 *   arguments   the side his arguments from other drafts lean to
 *   cards       his champion cards
 *   principles  his composition principles (structural calculator)
 *   balance     nothing separates the two compositions
 */
export function chooseReading({ resultSide = null, argumentSide, cardSide, calculatorSide }) {
  if (resultSide) return { basis: "result", side: resultSide };
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
 * agreement of each reading. `played` is a function that returns the
 * professional games already played with a draft (playedGames() of
 * src/results.mjs on the file the caller loaded), or null when it knows none.
 *
 * `lean` is the one side every screen shows, with where it comes from:
 * `memory` (his verdict), `undecided` (he commented without choosing), or one
 * of the readings of chooseReading().
 */
export function judgeDraft(
  draft,
  { knowledge, memory = null, model = null, relations = null, played = null, method = null } = {},
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
      shanei: null,
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
  const games =
    !kazewa && typeof played === "function" ? (played(canonical) ?? null) : null;
  const estimate = chooseReading({
    resultSide: sideOrNull(games?.side),
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
    // Professional games already played with these ten champions, if any.
    played: games,
    reliability: model?.reliability ?? null,
    kazewa,
    arguments: said,
    precedents: close,
    near,
    // Shanei's reading of the two compositions (method: indexMethod() of
    // src/method.mjs), whatever Kazewa said.
    shanei: method ? shaneiReading(canonical, method) : null,
    structure,
    warnings: structure.warnings,
  };
}
