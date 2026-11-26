/**
 * The links between champions, from the accumulated knowledge: the families of
 * Shanei's method (data/method.json), the duos he named (method pairs and his
 * champion cards), and the counters he named (his champion cards). Built once.
 *
 *   combo(a, b)    +1 a good duo, -1 a bad duo, 0 nothing said
 *   counter(a, b)  +1 a is good against b, -1 a is bad against b (b punishes a), 0 nothing said
 *   families(a)    the families of a champion, as the method names them
 */
import { cardRelations } from "../relations.mjs";

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildLinks({ method = null, cards = null, relations = null }) {
  const families = new Map();
  for (const [name, info] of Object.entries(method?.champions ?? {}))
    families.set(name, new Set(info.families ?? []));

  const combos = new Map();
  for (const pair of method?.pairs ?? []) {
    if (!pair.a || !pair.b || pair.a === pair.b) continue;
    combos.set(key(pair.a, pair.b), pair.good ? 1 : -1);
  }

  const counters = new Map();
  const cardLinks = relations ?? (cards ? cardRelations(cards) : null);
  if (cardLinks) {
    const note = (map, from, to, sign) => {
      if (from === to) return;
      counters.set(`${from}>${to}`, sign);
      // A card that says it is good against someone says the other is bad against it, but never the reverse.
      if (!counters.has(`${to}>${from}`)) counters.set(`${to}>${from}`, -sign);
    };
    for (const [name, list] of cardLinks.goodAgainst) for (const other of list) note(counters, name, other, 1);
    for (const [name, list] of cardLinks.badAgainst) for (const other of list) note(counters, name, other, -1);
    for (const [name, list] of cardLinks.goodWith) for (const other of list) combos.set(key(name, other), 1);
    for (const [name, list] of cardLinks.badWith) for (const other of list) combos.set(key(name, other), -1);
  }

  return {
    families: (name) => families.get(name) ?? new Set(),
    combo: (a, b) => combos.get(key(a, b)) ?? 0,
    counter: (a, b) => counters.get(`${a}>${b}`) ?? 0,
    size: { families: families.size, combos: combos.size, counters: counters.size },
  };
}
