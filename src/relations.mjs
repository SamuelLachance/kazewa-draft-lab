/**
 * What his champion cards say about a draft.
 *
 * Each card sums up what Kazewa says of one champion across his videos, with
 * the champions it is "good with" and the ones it is "punished by". On a draft,
 * a card speaks when one of those champions is there in the matching relation:
 * a named partner on the same side, a named punisher on the other side.
 *
 * This reading covers almost every draft, because every champion has a card.
 * It is coarser than his arguments: a card is a summary, not a sentence he
 * said about these two champions in these roles.
 */
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const SIDES = ["blue", "red"];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Champion names found in a text as whole names ("Vi" is not in "Viego"). */
export function mentionedChampions(text, names) {
  if (!text) return [];
  return names.filter((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "u").test(text),
  );
}

/** `{ good: Map(champion -> Set), bad: Map(champion -> Set) }` from the cards. */
export function cardRelations(cards) {
  const names = Object.keys(cards ?? {});
  const good = new Map();
  const bad = new Map();
  for (const name of names) {
    const card = cards[name];
    good.set(
      name,
      new Set(mentionedChampions(card.good, names).filter((other) => other !== name)),
    );
    bad.set(
      name,
      new Set(mentionedChampions(card.bad, names).filter((other) => other !== name)),
    );
  }
  return { good, bad };
}

/**
 * Card statements that apply to this draft, each with the side it favours,
 * and the side most of them favour.
 */
export function cardReading(draft, relations) {
  const items = [];
  if (!relations) return { items, blue: 0, red: 0, side: "even" };
  const where = [];
  for (const side of SIDES)
    for (const role of ROLES) {
      const name = draft?.[side]?.[role];
      if (name) where.push({ name, side });
    }
  const seen = new Set();
  for (const a of where) {
    for (const b of where) {
      if (a.name === b.name) continue;
      if (a.side === b.side && relations.good.get(a.name)?.has(b.name)) {
        // "A is good with B" and "B is good with A" are one synergy.
        const key = "s:" + [a.name, b.name].sort().join("+");
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ kind: "synergy", champion: a.name, other: b.name, favours: a.side });
      }
      if (a.side !== b.side && relations.bad.get(a.name)?.has(b.name))
        items.push({
          kind: "counter",
          champion: a.name,
          other: b.name,
          favours: b.side,
        });
    }
  }
  const blue = items.filter((item) => item.favours === "blue").length;
  const red = items.length - blue;
  return { items, blue, red, side: blue === red ? "even" : blue > red ? "blue" : "red" };
}
