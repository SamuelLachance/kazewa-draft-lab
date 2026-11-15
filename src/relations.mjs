/**
 * What his champion cards say about a draft.
 *
 * Each card sums up what Kazewa says of one champion across his videos. Its
 * "good" text names partners ("avec Orianna") and victims ("contre Gnar"); its
 * "bad" text names punishers ("puni par Tahm Kench") and bad partners ("avec
 * Akali : anti-synergie"). On a draft, a card speaks when one of those
 * champions is there in the matching relation: a partner on the same side, a
 * victim or a punisher on the other side.
 *
 * This reading covers almost every draft, because every champion has a card.
 * It is coarser than his arguments: a card is a summary, not a sentence he
 * said about these two champions in these roles.
 */
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const SIDES = ["blue", "red"];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Short forms the cards use for champions.
const SHORT_NAMES = {
  Jarvan: "Jarvan IV",
  J4: "Jarvan IV",
  TF: "Twisted Fate",
  MF: "Miss Fortune",
  Renata: "Renata Glasc",
  Xin: "Xin Zhao",
  Mundo: "Dr. Mundo",
  Nunu: "Nunu & Willump",
  Tahm: "Tahm Kench",
  Lee: "Lee Sin",
  Cassio: "Cassiopeia",
  ASol: "Aurelion Sol",
  Vlad: "Vladimir",
  Blitz: "Blitzcrank",
  GP: "Gangplank",
  Kog: "Kog'Maw",
  Cho: "Cho'Gath",
  Kha: "Kha'Zix",
  Morde: "Mordekaiser",
  Heimer: "Heimerdinger",
};
const wholeName = (name) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}'])`, "gu");

/** Champions named in a text, with where: `[{ name, index }]`, whole names only. */
function mentions(text, names) {
  if (!text) return [];
  const found = [];
  const known = new Set(names);
  const spans = [];
  // Full names first, so "Lee" inside "Lee Sin" is not read twice.
  for (const name of [...names].sort((a, b) => b.length - a.length))
    for (const match of text.matchAll(wholeName(name))) {
      if (spans.some(([from, to]) => match.index >= from && match.index < to)) continue;
      spans.push([match.index, match.index + name.length]);
      found.push({ name, index: match.index });
    }
  for (const [short, name] of Object.entries(SHORT_NAMES)) {
    if (!known.has(name)) continue;
    for (const match of text.matchAll(wholeName(short))) {
      if (spans.some(([from, to]) => match.index >= from && match.index < to)) continue;
      spans.push([match.index, match.index + short.length]);
      found.push({ name, index: match.index });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Champion names found in a text ("Vi" is not in "Viego", "TF" is Twisted Fate). */
export function mentionedChampions(text, names) {
  return [...new Set(mentions(text, names).map((m) => m.name))];
}

// Words that say the champions named after them are opponents, or partners.
const AGAINST = /\b(contre|face à|face au|face aux|vs|into|bat|battre|counter|countere|punit|puni par|punie par)\b/giu;
const WITH = /\b(avec|aux côtés de|aux côtés d|à côté de|duo|combo)\b/giu;
const lastIndex = (text, pattern) => {
  let at = -1;
  for (const match of text.matchAll(pattern)) at = match.index;
  return at;
};

/**
 * Relation of each champion named in one card field.
 * `fallback` is what a bare name means there: "ally" in the good text, "enemy"
 * in the bad text. A clause that speaks of anti-synergy is about allies.
 */
function relationsIn(text, names, fallback) {
  const ally = new Set();
  const enemy = new Set();
  if (!text) return { ally, enemy };
  for (const clause of text.split(/[;.]/)) {
    const antiSynergy = /anti-?synergi/i.test(clause);
    for (const { name, index } of mentions(clause, names)) {
      const before = clause.slice(0, index);
      const against = lastIndex(before, AGAINST);
      const together = lastIndex(before, WITH);
      const relation = antiSynergy
        ? "ally"
        : against === -1 && together === -1
          ? fallback
          : against > together
            ? "enemy"
            : "ally";
      (relation === "ally" ? ally : enemy).add(name);
    }
  }
  return { ally, enemy };
}

/**
 * Four relations per champion, from the cards:
 * goodWith (partners), goodAgainst (victims), badAgainst (punishers),
 * badWith (bad partners).
 */
export function cardRelations(cards) {
  const names = Object.keys(cards ?? {});
  const relations = {
    goodWith: new Map(),
    goodAgainst: new Map(),
    badAgainst: new Map(),
    badWith: new Map(),
  };
  for (const name of names) {
    const others = names.filter((other) => other !== name);
    const good = relationsIn(cards[name].good, others, "ally");
    const bad = relationsIn(cards[name].bad, others, "enemy");
    relations.goodWith.set(name, good.ally);
    relations.goodAgainst.set(name, good.enemy);
    relations.badAgainst.set(name, bad.enemy);
    relations.badWith.set(name, bad.ally);
  }
  return relations;
}

/**
 * Card statements that apply to this draft, each with the side it favours and
 * the card it comes from, and the side most of them favour.
 *   synergy      two allies a card calls good together
 *   antisynergy  two allies a card calls bad together
 *   counter      `other` gets the better of `champion`, who is on the other side
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
  const other = (side) => (side === "blue" ? "red" : "blue");
  const seen = new Set();
  const add = (key, item) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const a of where) {
    for (const b of where) {
      if (a.name === b.name) continue;
      const pair = [a.name, b.name].sort().join("+");
      if (a.side === b.side) {
        if (relations.goodWith.get(a.name)?.has(b.name))
          add("s:" + pair, {
            kind: "synergy",
            champion: a.name,
            other: b.name,
            card: a.name,
            favours: a.side,
          });
        if (relations.badWith.get(a.name)?.has(b.name))
          add("a:" + pair, {
            kind: "antisynergy",
            champion: a.name,
            other: b.name,
            card: a.name,
            favours: other(a.side),
          });
      } else {
        // b punishes a, by a's card.
        if (relations.badAgainst.get(a.name)?.has(b.name))
          add(`c:${b.name}>${a.name}`, {
            kind: "counter",
            champion: a.name,
            other: b.name,
            card: a.name,
            favours: b.side,
          });
        // a gets the better of b, by a's card.
        if (relations.goodAgainst.get(a.name)?.has(b.name))
          add(`c:${a.name}>${b.name}`, {
            kind: "counter",
            champion: b.name,
            other: a.name,
            card: a.name,
            favours: a.side,
          });
      }
    }
  }
  const blue = items.filter((item) => item.favours === "blue").length;
  const red = items.length - blue;
  return { items, blue, red, side: blue === red ? "even" : blue > red ? "blue" : "red" };
}
