/**
 * What the site answers for a draft. Every complete draft gets a verdict.
 *
 * 1. Kazewa judged this exact draft: his verdict, his reasons, his video.
 * 2. He did not: the estimate is read from his own words first, then from his
 *    champion cards, and the site says which one it used:
 *      - the arguments he gave about the same champions in other drafts;
 *      - his champion cards (who is good with whom, who is punished by whom).
 *    When neither separates the two compositions, the site gives no estimate.
 *    Each reading comes with the agreement measured for it on the drafts he
 *    did judge.
 *
 * The draft procedure of the two coaches (src/theory.mjs: his decision rubric
 * with Shanei's construction checks, no professional game read) is not an
 * estimate. It is a second opinion, shown apart with its measured agreement,
 * which is a coin flip: the site says so.
 *
 * A game already played is a fact about the draft, shown as such: which team
 * won. It is not the verdict of the draft, and it does not decide the estimate.
 *
 * Shanei's reading of the two compositions (src/method.mjs) is shown next to
 * the verdict as a second opinion. It is not a reading of the estimate either.
 *
 * The pick order is not a reading. It looked like one on 195 drafts; on 268 it
 * does no better than always naming the same side. scripts/evaluate.mjs keeps
 * measuring it so this stays checkable.
 */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { applicableArguments, precedents, recall } from "./memory.mjs";
import { cardReading } from "./relations.mjs";
import { shaneiReading } from "./method.mjs";
import { evaluateDraft, theoryContext } from "./theory.mjs";

export const NEAR_SHARED = 8;

/** Which side the arguments he gave elsewhere lean to on this draft. */
export function argumentLean(list) {
  const blue = list.filter((item) => item.favours === "blue").length;
  const red = list.filter((item) => item.favours === "red").length;
  return { blue, red, side: blue === red ? "even" : blue > red ? "blue" : "red" };
}

/**
 * The estimate for a draft he did not judge, in order of measured reliability.
 * Shared with the evaluation so that what is measured is what is shown.
 *   result      the side that won, when the draft is a game already played
 *               (measured, never shown as the estimate)
 *   arguments   the side his arguments from other drafts lean to
 *   cards       his champion cards
 *   balance     neither separates the two compositions: no estimate
 * The decision grid of the two coaches is not a step here: it is a second
 * opinion, shown apart (see judgeDraft).
 */
export function chooseReading({ resultSide = null, argumentSide = null, cardSide = null } = {}) {
  if (resultSide) return { basis: "result", side: resultSide };
  if (argumentSide) return { basis: "arguments", side: argumentSide };
  if (cardSide) return { basis: "cards", side: cardSide };
  return { basis: "balance", side: "even" };
}
const sideOrNull = (side) => (side === "blue" || side === "red" ? side : null);

// One context per knowledge object and method index: the facts of each
// champion are read once, and a different knowledge object never reuses them.
const contexts = new WeakMap();
function theoryFor(knowledge, method) {
  if (!contexts.has(knowledge)) contexts.set(knowledge, new WeakMap());
  const byMethod = contexts.get(knowledge);
  if (!byMethod.has(method)) byMethod.set(method, theoryContext({ knowledge, index: method }));
  return byMethod.get(method);
}

/**
 * Full answer for a draft.
 * `memory` is the index from indexMemory(). `relations` comes from
 * cardRelations(champion cards). `model.reliability` holds the measured
 * agreement of each reading. `played` is a function that returns the
 * professional games already played with a draft (playedGames() of
 * src/results.mjs on the file the caller loaded), or null when it knows none.
 * `method` is indexMethod() of src/method.mjs: the draft procedure needs it.
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
      theory: null,
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
  const theory = method && knowledge ? evaluateDraft(canonical, theoryFor(knowledge, method)) : null;
  const games =
    !kazewa && typeof played === "function" ? (played(canonical) ?? null) : null;
  const estimate = chooseReading({
    argumentSide: sideOrNull(saidLean.side),
    cardSide: sideOrNull(cards.side),
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
    // The draft procedure of the two coaches (src/theory.mjs): a second
    // opinion, never the estimate.
    theory,
    // A professional game already played with these ten champions: a fact.
    played: games,
    reliability: model?.reliability ?? null,
    kazewa,
    arguments: said,
    precedents: close,
    near,
    // Shanei's reading of the two compositions (method: indexMethod() of
    // src/method.mjs), a second opinion next to the verdict.
    shanei: method ? shaneiReading(canonical, method) : null,
    structure,
    warnings: structure.warnings,
  };
}
