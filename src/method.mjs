/**
 * The draft method of the two coaches, applied.
 *
 * data/method.json holds what Shanei and Kazewa teach: their rules with the
 * video behind each, Shanei's families of compositions and where every
 * champion sits in them, the duos he calls a combo, his ban lists. This file
 * turns that into three things:
 *
 *   shaneiReading()  a finished draft read with Shanei's grid: the family of
 *                    each composition, what it lacks, what he would fault,
 *                    and which of the two is the healthier one;
 *   pickNotes() / banNotes()
 *                    what the method says of one champion at one step of a
 *                    draft, for the coach: pick order, first pick, blind
 *                    picks, flex, family, missing pieces, combos, counters;
 *   stepBrief()      the rules of both coaches for the step being played.
 *
 * Every sentence carries the id of its rule, or the clause of his champion
 * sheet with its video, so the site can link what it says. A sentence with
 * neither is not said. What a coach said is kept apart from what is deduced:
 * a champion's family is marked `cited` or `deduced`, a rule the notes mark as
 * uncertain never scores, and the kit facts (tank, damage type, engage…) come
 * from an analyst grid, not from their words.
 */
import { ROLES } from "./engine.mjs";

export const BLOCK = Object.freeze(["jng", "mid", "bot", "sup"]);
const SIDES = ["blue", "red"];
const other = (side) => (side === "blue" ? "red" : "blue");
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const round = (value) => Math.round(value * 100) / 100 || 0;

export const FAMILY_FR = Object.freeze({
  "all-in": "all-in",
  poke: "poke / disengage",
  hypercarry: "hypercarry",
});
const SUB_FR = {
  "all-in-catch": "catch",
  "all-in-wombo": "wombo combo",
  "all-in-full-early": "full early",
};
const ROLE_FR = { top: "top", jng: "jungle", mid: "mid", bot: "ADC", sup: "support" };
const list = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
// "d’Aphelios", but "de Yunara" and "de Hwei".
const de = (name) => (/^[aeiouàâéèêëîïôöûü]/i.test(name) ? `d’${name}` : `de ${name}`);
// A sentence ends with one mark: no full stop after "…" or "»".
const closed = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`);

// A rule of the method weighs about as much as one statement of Kazewa on two
// champions (WEIGHTS.said in src/coach.mjs is 1). On professional drafts of
// 2025 replayed pick by pick, every part of the method lowers the agreement
// with what teams really took, and the more it weighs the more it does:
// professional teams do not draft by these rules. The method is kept because
// the coach is asked what the two coaches would do; its weights were set by
// that principle, not to follow professional teams (research/coach-eval.mjs).
export const METHOD_WEIGHTS = Object.freeze({
  // The order of roles in the draft (top last, support before it, ADC early).
  order: 1,
  // His lists: safe first picks, true flex picks, picks he never blinds.
  first: 1.5,
  blind: 1,
  flex: 0.75,
  // A piece of the family the composition is going for, or outside it.
  family: 0.75,
  offTheme: 0.75,
  // The poke / engage mix when the drafter said which family they play: as
  // much as his statements can add up to (WEIGHTS.saidCap).
  offPlan: 3,
  // Picks locked before a family is read from them, when no plan was given:
  // Shanei looks at what the opponent does before he settles on a family.
  familyFrom: 3,
  // A piece the composition still lacks (enchanter, tank, poke mid), and how
  // much more it weighs on the last pick that can still bring it.
  need: 1,
  rare: 1.5,
  lastChance: 2,
  // A duo he names: in a video, or in the combo table of his course.
  combo: 1,
  courseCombo: 0.5,
  comboCap: 2,
  antiSynergy: 1,
  // An answer to the family or to a champion of the opponent.
  counter: 0.75,
  // Damage type, immobile champions, scaling: construction rules.
  build: 0.75,
  // A ban that protects the composition, or that would remove one's own piece.
  ban: 1,
  banWith: 2,
  ownPiece: 1,
});

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

export function indexMethod(method) {
  if (!method?.champions) return null;
  const pairs = new Map();
  for (const entry of method.pairs ?? []) pairs.set(pairKey(entry.a, entry.b), entry);
  return {
    rules: method.rules ?? {},
    champions: method.champions,
    pairs,
    bans: method.bans ?? [],
    of: (name) => method.champions[name] ?? null,
    pair: (a, b) => pairs.get(pairKey(a, b)) ?? null,
  };
}

const allIn = (info) => info.families.some((family) => family.startsWith("all-in"));
const pokeSide = (info) => info.families.includes("poke") || info.families.includes("disengage");
/**
 * Does the champion have a place in a composition of this family? A
 * hypercarry composition is a carry, its enchanter and a tank; he takes the
 * rest from anywhere ("le top on s’en fout", an engage jungler for the
 * combo), so no pick is outside it: its pieces are checked one by one.
 */
export function fits(family, info) {
  if (!info) return false;
  if (family === "all-in") return allIn(info);
  if (family === "poke") return pokeSide(info);
  return family === "hypercarry";
}
// The big family a champion is first known for.
const primary = (info) => {
  const first = info.families[0];
  if (!first) return null;
  if (first.startsWith("all-in")) return "all-in";
  if (first === "poke" || first === "disengage") return "poke";
  return first === "hypercarry" ? "hypercarry" : null;
};
// The mid of a poke / disengage composition: a poker, or the carry of the
// disengage half of the family (Azir).
const pokeMid = (info) => info.poker || (info.families.length === 1 && info.families[0] === "disengage");
// Is this the enchanter of that carry? A champion he calls a hypercarry takes
// any of his enchanters; one that only becomes a carry next to an enchanter
// needs an enchanter he first files under that family (Lulu, Milio, Yuumi…).
// When the reader declared the hypercarry plan, any of his enchanters does.
// Never one he does not want next to that carry.
const enchants = (carry, info, declared = false) =>
  Boolean(info.hyper) &&
  !info.notWith?.includes(carry.name) &&
  (declared || carry.info.carry === 2 || info.families[0] === "hypercarry");
// A source of damage for the "never full AD nor full AP" rule: every lane
// but the support, enchanters left out. A tank mid still deals its damage.
// Every locked champion counts as a source of damage: his "never full AD nor
// full AP" rule counts the damage of the whole team, support and enchanters too.
const dealsDamage = () => true;

/* ------------------------------------------------------------------ */
/* A composition, finished or not                                      */
/* ------------------------------------------------------------------ */

const CARRY_ROLES = ["bot", "jng", "top"];

/**
 * What a team of one to five champions is, in Shanei's terms. `plan` is the
 * family the drafter said they are going for: it wins over what the picks
 * suggest.
 */
export function composition(team, index, plan = null) {
  const members = ROLES.filter((role) => team?.[role] && index.of(team[role])).map((role) => ({
    role,
    name: team[role],
    info: index.of(team[role]),
  }));
  const block = members.filter((member) => BLOCK.includes(member.role));
  const hyper = members.filter((member) => member.info.hyper);
  // A hypercarry composition is a carry and its enchanter. A champion he calls
  // a hypercarry comes first.
  let core = null;
  for (const level of [2, 1]) {
    for (const role of CARRY_ROLES) {
      const carry = members.find((member) => member.role === role && member.info.carry === level);
      if (!carry) continue;
      const partner = hyper.find(
        (member) =>
          member.name !== carry.name &&
          (member.role === "sup" || (member.role === "jng" && carry.role === "top")) &&
          enchants(carry, member.info, plan === "hypercarry"),
      );
      if (partner) {
        core = { carry, enchanter: partner };
        break;
      }
    }
    if (core) break;
  }
  const votes = { "all-in": 0, poke: 0 };
  const firsts = { "all-in": 0, poke: 0 };
  // The family is read on the block of four; the top is apart.
  // A champion he did not class himself has no say, for or against.
  const voters = (block.length ? block : members).filter((member) => member.info.basis === "cited");
  for (const member of voters) {
    if (allIn(member.info)) votes["all-in"]++;
    if (pokeSide(member.info)) votes.poke++;
    const first = primary(member.info);
    if (first in firsts) firsts[first]++;
  }
  let voted =
    votes["all-in"] !== votes.poke
      ? votes["all-in"] > votes.poke ? "all-in" : "poke"
      : firsts["all-in"] !== firsts.poke
        ? firsts["all-in"] > firsts.poke ? "all-in" : "poke"
        : null;
  // A poke composition is carried by its mid or its ADC: a disengage tag on a
  // jungler or a tank support (Xin Zhao, Braum) confirms it, it does not make it.
  if (voted === "poke" && !voters.some((member) => ["mid", "bot"].includes(member.role) && (primary(member.info) === "poke" || pokeMid(member.info))))
    voted = votes["all-in"] >= 2 ? "all-in" : null;
  // A champion that only becomes a carry next to an enchanter does not make a
  // hypercarry when the whole block, the pair included, belongs to the family
  // the block votes for (Caitlyn + Janna in a poke / disengage block).
  if (core && core.carry.info.carry === 1 && plan !== "hypercarry" && voted && block.every((member) => fits(voted, member.info)))
    core = null;
  // A hypercarry already locked announces the family, enchanter or not. On a
  // finished team it no longer does when the three other picks of the block
  // all belong to one other family: the carry is then the pick out of theme.
  const announces = (member) =>
    member.info.carry === 2 &&
    (member.role === "bot" ? member.info.families[0] === "hypercarry" : member.info.families.length === 1);
  let announced =
    core?.carry ?? ["bot", "jng"].map((role) => members.find((member) => member.role === role && announces(member))).find(Boolean) ?? null;
  if (!core && announced && members.length === 5 && voted) {
    const others = block.filter((member) => member.name !== announced.name);
    if (others.length >= 3 && others.every((member) => fits(voted, member.info))) announced = null;
  }
  // With a hypercarry plan, a champion that can be a carry is the carry.
  let planned = null;
  if (plan === "hypercarry" && !announced)
    for (const level of [2, 1]) {
      planned ??= CARRY_ROLES.map((role) => members.find((member) => member.role === role && member.info.carry === level)).find(Boolean) ?? null;
    }
  let family = null;
  let basis = "picks";
  if (plan && plan in FAMILY_FR) {
    family = plan;
    basis = "plan";
  } else if (announced) family = "hypercarry";
  else family = voted;
  // Two picks at least before a family is read from them.
  if (basis === "picks" && family !== "hypercarry" && voters.length < 2) family = null;
  const carry = family === "hypercarry" ? (announced ?? planned) : null;
  // Judged against the family: the champions of the block he classed himself.
  const judged = family && family !== "hypercarry" ? block.filter((member) => member.info.families.length && member.info.basis === "cited") : [];
  const fit = judged.filter((member) => fits(family, member.info));
  const off = judged.filter((member) => !fits(family, member.info));
  // The all-in sub-family most of the block belongs to.
  let sub = null;
  if (family === "all-in") {
    const tally = {};
    for (const member of block.length ? block : members) {
      const tag = member.info.families.find((name) => name.startsWith("all-in"));
      if (tag) tally[tag] = (tally[tag] ?? 0) + 1;
    }
    sub = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b))[0] ?? null;
  }
  const sources = members.filter((member) => dealsDamage(member.role, member.info));
  const physical = sources.filter((member) => member.info.damage !== "ap");
  const magic = sources.filter((member) => member.info.damage !== "ad");
  const has = (name) => members.some((member) => member.name === name);
  return {
    members,
    block,
    size: members.length,
    family,
    basis,
    sub,
    label: family
      ? family === "all-in" && sub
        ? `all-in (${SUB_FR[sub]})`
        : family === "hypercarry" && carry
          ? `hypercarry ${ROLE_FR[carry.role]}`
          : FAMILY_FR[family]
      : null,
    core: family === "hypercarry" ? core : null,
    carry,
    fit,
    off,
    tank: block.find((member) => member.info.tank) ?? null,
    hyper,
    sources,
    physical,
    magic,
    // Three sources of damage at least, all of one type.
    fullAd: sources.length >= 3 && !magic.length,
    fullAp: sources.length >= 3 && !physical.length,
    engage: members.filter((member) => member.info.engage),
    disengage: members.filter((member) => member.info.disengage),
    globals: members.filter((member) => member.info.global),
    mobile: members.filter((member) => member.info.mobile),
    // The speed composition he describes: Sivir and Karma.
    speed: has("Sivir") && has("Karma"),
    has,
    at: (role) => members.find((member) => member.role === role) ?? null,
  };
}

// What holds an all-in back, in his words: the supports he bans when he
// plays it, and defensive globals. Each list is the list of its rule.
const ANTI_DIVE = { "Tahm Kench": "sf-56", Xayah: "sf-56", Morgana: "sf-56", Braum: "sp-57", Taric: "sp-57" };
const DEFENSIVE_GLOBALS = ["Shen", "Galio", "Gangplank", "Pantheon", "Twisted Fate"];
const SPLIT_TOPS = ["Fiora", "Camille"];
const STEALABLE = ["Galio", "Taliyah"];
const brakes = (comp) => [...Object.keys(ANTI_DIVE), ...DEFENSIVE_GLOBALS].filter((name) => comp.has(name));
// The only composition he lets go without a tank.
const speedException = (comp, also = null) =>
  ["Kled", "Sivir", "Karma"].every((name) => name === also || comp.has(name));
// The rule that says what a carry needs, by where the carry plays.
const carryRule = (carry) => (carry.role === "jng" ? "sf-34" : carry.role === "top" ? "sf-38" : "sf-29");

/* ------------------------------------------------------------------ */
/* A finished draft, read with Shanei's grid                           */
/* ------------------------------------------------------------------ */

/**
 * One composition against the other. Each item is a sentence with its rule:
 * `fault` (he would fault it, with a weight), `strength`, or `remark` (said,
 * not counted). A rule the notes mark as uncertain is a remark.
 */
function assess(own, foe, index) {
  const items = [];
  const add = (kind, weight, text, rule, extra = {}) => {
    const unsure = Boolean(rule && index.rules[rule]?.uncertain);
    const as = unsure ? "remark" : kind;
    items.push({ kind: as, weight: as === "remark" ? 0 : weight, text, rule, ...(unsure ? { unsure: true } : {}), ...extra });
  };
  const names = (members) => list(members.map((member) => member.name));

  // 1. One identity, read on the block of four.
  if (!own.family)
    add("fault", 2, "Le bloc jungle, mid, ADC et support ne dessine aucune famille : ni all-in, ni poke, ni hypercarry.", "sf-1");
  else if (own.family === "hypercarry") {
    if (own.core && own.tank)
      add("strength", 1, `Une seule identité : composition ${own.label}, avec ${own.core.carry.name}, son enchanteur ${own.core.enchanter.name} et un tank (${own.tank.name}).`, "sp-73");
  } else if (own.off.length >= 2)
    add("fault", 2, `Composition ${own.label}, mais ${names(own.off)} sortent du thème : deux picks hors famille cassent la cohérence.`, "sf-5");
  else if (own.off.length === 1) {
    const out = own.off[0];
    const mix = (own.family === "poke" && allIn(out.info)) || (own.family === "all-in" && pokeSide(out.info));
    // A hypercarry alone in another family: it has no enchanter either.
    if (out.info.carry === 2)
      add("fault", 1, `${out.name} est un hypercarry : dans une composition ${own.label}, sans enchanteur, il sort du thème.`, carryRule(out));
    else add(mix ? "fault" : "remark", 1, `Composition ${own.label} ; ${out.name} est le seul pick du bloc hors de cette famille.`, mix ? "sf-6" : "sf-5");
  } else if (own.fit.length >= 3)
    add("strength", 1, `Une seule identité : composition ${own.label}, les picks du bloc y ont tous leur place.`, "sp-73");

  // 2. A real tank among jungle, mid, ADC and support.
  if (!own.tank) {
    if (speedException(own))
      add("remark", 0, "Pas de tank dans le bloc de quatre : la compo full speed Kled, Sivir et Karma est la seule exception qu’il donne.", "sp-74");
    else {
      add("fault", 2, "Pas de vrai tank parmi jungle, mid, ADC et support : le top ne compte pas, il part en side.", "sp-74");
      if (own.has("Lissandra"))
        add("remark", 0, "Lissandra avec Zhonya achète du temps et compense presque le tank, sans le remplacer.", "sr-4");
    }
  }

  // 3. Never full AD nor full AP.
  if (own.fullAp)
    add("fault", 2, `Composition full AP (${names(own.sources)}) : l’adversaire n’a qu’une résistance à acheter.`, "sp-75");
  else if (own.fullAd)
    add("fault", 2, `Composition full AD (${names(own.sources)}) : l’adversaire n’a qu’une résistance à acheter.`, "sp-75");

  // 4. What each family needs.
  if (own.family === "hypercarry" && own.carry) {
    const carry = own.carry;
    if (!own.core)
      add(
        "fault",
        1,
        carry.role === "top"
          ? `${carry.name} est un hypercarry top : il lui faut un enchanteur au support ou en jungle, et la compo n’en a pas.`
          : `${carry.name} est un hypercarry : il lui faut un support enchanteur, et la compo n’en a pas.`,
        carryRule(carry),
      );
    if (carry.role === "jng" && !own.at("mid")?.info.tank)
      add("fault", 1, `Hypercarry jungle (${carry.name}) : il veut un tank au mid, pour tenir la lane et temporiser.`, "sf-34");
    const mid = own.at("mid");
    if (mid?.info.assassin && carry.role !== "mid")
      add("fault", 1, `${mid.name} au mid d’une compo hypercarry : le mid doit y être défensif, pas un assassin.`, carry.role === "jng" ? "sf-53" : "sf-32");
    if (!own.members.some((member) => member.info.waveclear))
      add("fault", 1, "Aucun waveclear : le contre d’une hypercarry est le speed push et le siège.", "sf-61");
  }
  if (own.family === "poke") {
    const mid = own.at("mid");
    if (mid && !pokeMid(mid.info))
      add("fault", 1, `Compo poke sans mid de poke (${mid.name}) : c’est la pièce indispensable de la famille.`, "sf-45");
    if (own.disengage.length <= 1)
      add("fault", 1, `Une compo qui n’engage pas veut trois à cinq sources de désengage ; celle-ci en a ${own.disengage.length}.`, "sp-78");
    else if (own.disengage.length === 2)
      add("remark", 0, `Deux sources de désengage (${names(own.disengage)}) : il en veut trois à cinq.`, "sp-78");
  }
  // He says it of one draft: an all-in with no engage, in front of Morgana.
  if (own.family === "all-in" && !own.engage.length) {
    if (foe.has("Morgana"))
      add("fault", 1, "Compo all-in sans source d’engage face à Morgana : il la donne perdante dans une draft de ce type.", "sf-73");
    else add("remark", 0, "Compo all-in sans source d’engage nette.", "sf-73");
  }

  // 5. The duos he names.
  let combos = 0;
  const pairs = [];
  for (let i = 0; i < own.members.length; i++)
    for (let j = i + 1; j < own.members.length; j++) {
      const entry = index.pair(own.members[i].name, own.members[j].name);
      if (entry) pairs.push(entry);
    }
  for (const entry of pairs.filter((item) => !item.good && item.unless !== own.family))
    if (entry.soft)
      add("remark", 0, `${entry.a} + ${entry.b} : un duo qu’il juge surcoté, sans vraie synergie sur la durée.`, entry.rule, { with: [entry.a, entry.b] });
    else add("fault", 1, `${entry.a} + ${entry.b} : une anti-synergie d’après lui.`, entry.rule, { with: [entry.a, entry.b] });
  // A lane duo counts with both champions in their lane.
  const inLane = (item) => !item.lanes || Object.entries(item.lanes).every(([name, lane]) => own.at(lane)?.name === name);
  const good = pairs.filter((item) => item.good && inLane(item)).sort((a, b) => Number(b.origin === "video") - Number(a.origin === "video"));
  for (const entry of good.slice(0, 3)) {
    const weight = Math.min(entry.origin === "video" ? 1 : 0.5, 2 - combos);
    if (weight <= 0) break;
    combos += weight;
    add(
      "strength",
      weight,
      entry.origin === "video"
        ? `${entry.a} + ${entry.b} : un combo qu’il nomme.`
        : `${entry.a} + ${entry.b} : un duo de la table des combos de son cours.`,
      entry.rule,
      { with: [entry.a, entry.b], course: entry.origin !== "video" },
    );
  }
  if (!good.length) add("remark", 0, "Aucun des combos qu’il nomme dans cette composition : il en veut au moins un par draft.", "sf-77");

  // 6. Against the other composition.
  if (foe.has("Sylas")) {
    const gift = STEALABLE.filter((name) => own.has(name));
    if (gift.length) add("fault", 1, `${list(gift)} face à Sylas : un bon ultime offert à voler.`, "sp-48");
  }
  if (foe.has("Poppy") && own.has("Alistar"))
    add("fault", 1, "Alistar face à Poppy : ses engages passent par des dashs qu’elle annule.", "sr-31");
  if (own.has("Neeko") && foe.mobile.length >= 3)
    add("fault", 1, `Neeko face à trois champions mobiles (${names(foe.mobile.slice(0, 3))}) : elle n’est forte que contre les immobiles.`, "sr-32");
  if (own.has("Malphite") && foe.fullAd)
    add("strength", 1, "Malphite face à une compo full AD : il annule la vitesse d’attaque.", "sr-52");
  const support = own.at("sup");
  if (foe.family === "poke" && support?.info.tank && foe.at("bot")?.info.poker && foe.at("sup")?.info.poker)
    add("fault", 1, `${support.name} support face à une botlane de poke (${foe.at("bot").name} + ${foe.at("sup").name}) : une lane perdue au bot ne se rattrape pas.`, "sp-77");
  if (foe.family === "all-in") {
    if (support?.name === "Morgana")
      add("strength", 1, "Morgana en support contre une compo all-in : le counter-pick qu’il laisse grand ouvert.", "sf-72");
    if (own.has("Braum") && foe.has("Draven"))
      add("strength", 1, "Braum contre une botlane all-in de Draven : la réponse qu’il cite pour pouvoir jouer la lane.", "sf-58");
  }
  if (foe.family === "poke") {
    if (own.has("Bard")) add("strength", 1, "Bard contre une compo poke : un très gros counter d’après lui.", "sf-64");
    if (own.speed) add("strength", 1, "La vitesse de Sivir et Karma contre une compo poke : son premier counter.", "sf-65");
    const split = SPLIT_TOPS.find((name) => own.at("top")?.name === name);
    if (split) add("strength", 1, `${split} en splitpush contre une compo poke : un soft counter.`, "sf-66");
    if ((own.has("Kog'Maw") || own.has("Twitch")) && (own.has("Milio") || own.has("Lulu")))
      add("strength", 1, "Un hypercarry très longue portée avec son enchanteur : sa réponse à l’ADC d’une compo poke.", "sf-69");
  }
  if (foe.speed && own.family === "all-in" && own.engage.length >= 2)
    add("strength", 1, "De l’engage dur contre la compo speed de Sivir et Karma : la réponse qu’il donne.", "sf-70");
  if (own.family === "poke" && foe.family === "all-in") {
    if (own.disengage.length > foe.engage.length)
      add("strength", 1, `Plus de désengage (${own.disengage.length}) que l’adversaire n’a d’engage (${foe.engage.length}) : ce qu’il demande à une compo poke.`, "sr-11");
    else
      add("fault", 1, `Pas plus de désengage (${own.disengage.length}) que l’adversaire n’a d’engage (${foe.engage.length}) : une compo poke en veut toujours davantage.`, "sr-11");
  }
  if (foe.family === "hypercarry" && foe.carry?.role === "bot") {
    const held = brakes(foe);
    if (own.family === "all-in") {
      if (held.length >= 2)
        add("remark", 0, `L’all-in bat normalement une hypercarry ADC, mais en face ${list(held)} tiennent le dive : deux ou trois arguments suffisent à tenir.`, "sf-57");
      else add("strength", 1, "Compo all-in contre une hypercarry ADC : elle la prive de sa lane, et un hypercarry privé de lane n’a pas de partie.", "sf-59");
    } else if (own.family === "poke")
      add("strength", 1, "Compo poke contre une hypercarry : une des deux seules réponses qu’il connaisse.", "sp-46");
  }
  const top = own.at("top");
  if (top && top.info.families[0] === "split" && foe.globals.length)
    add("remark", 0, `Un plan de split au top alors que l’adversaire a un ultime global (${names(foe.globals)}).`, "sf-75");
  return items;
}

/**
 * Shanei's reading of a finished draft: for each side its family, the faults
 * and strengths, a score, and the side his grid finds healthier.
 */
export function shaneiReading(draft, index) {
  if (!index) return null;
  const comps = { blue: composition(draft.blue, index), red: composition(draft.red, index) };
  if (comps.blue.size < 5 || comps.red.size < 5) return null;
  const out = {};
  for (const side of SIDES) {
    const items = assess(comps[side], comps[other(side)], index);
    const strengths = items.filter((item) => item.kind === "strength").reduce((n, item) => n + item.weight, 0);
    const faults = items.filter((item) => item.kind === "fault").reduce((n, item) => n + item.weight, 0);
    out[side] = {
      family: comps[side].family,
      label: comps[side].label,
      carry: comps[side].carry?.name ?? null,
      items,
      faults: round(faults),
      strengths: round(strengths),
      score: round(strengths - faults),
    };
  }
  const margin = round(out.blue.score - out.red.score);
  return {
    blue: out.blue,
    red: out.red,
    margin,
    side: margin === 0 ? "even" : margin > 0 ? "blue" : "red",
  };
}

/* ------------------------------------------------------------------ */
/* The coach: one champion at one step                                 */
/* ------------------------------------------------------------------ */

// Tops he accepts to blind: few matchups punish them.
const BLIND_TOPS = { Renekton: "sp-34", Aatrox: "sp-34", Ornn: "sp-42", Kennen: "sp-42", Rumble: "sp-42" };
// What Kazewa says of a first pick, champion by champion. An entry whose rule
// the notes mark as uncertain is shown without points, and says so.
const KAZEWA_FIRST = {
  Karma: { good: true, rule: "kp-1", text: "Kazewa préfère ouvrir sur un flex qu’un carry à un seul rôle." },
  Morgana: { good: true, rule: "kp-2", text: "Kazewa ouvre côté bleu sur un pick sans contre ou un flex." },
  Maokai: { good: true, rule: "kp-13", text: "D’après Kazewa, Maokai en premier pick retire beaucoup de réponses à l’adversaire." },
  Rell: { good: false, rule: "kp-6", text: "Kazewa n’ouvre jamais sur un engage pur : il montre toute la stratégie." },
  Camille: { good: false, rule: "kp-12", text: "Pour Kazewa, Camille en premier pick ferme la draft plus qu’elle ne l’ouvre." },
  Cassiopeia: { good: false, rule: "kp-8", text: "Kazewa semble éviter d’ouvrir sur un carry courte portée comme Cassiopeia : l’adversaire répond full range." },
  "Jarvan IV": { good: false, rule: "kp-9", text: "Kazewa semble éviter d’ouvrir sur un catcheur : il annonce le catch sans cible garantie." },
};
const KAZEWA_BLIND = { Jax: "kp-18" };
// What each family is called in his descriptions of a champion.
const FAMILY_WORDS = {
  "all-in": /all-in|\bengage|dive|wombo|catch|full early|roam/i,
  poke: /poke|siège|d[ée]sengage|disengage|anti-dive|anti-engage/i,
  hypercarry: /hypercarry|enchanteur|tank|global|sécurise|scaling/i,
};

const lockedOf = (team) => ROLES.filter((role) => team[role]).map((role) => ({ role, name: team[role] }));

// The clause of his description that speaks of this family, shortened at a
// word, brackets closed, acronyms kept ("ADC", "DPS").
function pieceOf(info, family = null) {
  // Cut on " ; " and " — " outside brackets only.
  const clauses = String(info.piece ?? "").split(/(?: ; | — )(?![^()]*\))/).map((clause) => clause.trim().replace(/[.;,]+$/, "")).filter(Boolean);
  const pattern = family ? FAMILY_WORDS[family] : null;
  // "anti-all-in", "anti-dive", "désengage" do not name the all-in family.
  const names = (clause) => pattern.test(family === "all-in" ? clause.replace(/anti-[a-zé-]+|d[ée]sengag\w*|disengag\w*/gi, "") : clause);
  // With a family asked for, only a clause that speaks of it: no description is better than a wrong one.
  let text = pattern ? (clauses.find(names) ?? "") : (clauses[0] ?? "");
  if (pattern && !text) return null;
  if (text.length > 110) {
    text = text.slice(0, 107).replace(/\s+\S*$/, "");
    // Not in the middle of a bracket.
    if (text.lastIndexOf("(") > text.lastIndexOf(")")) text = text.slice(0, text.lastIndexOf("(")).trimEnd();
    text = `${text.replace(/[,;:]$/, "")}…`;
  }
  if (!text) return "une pièce d’une autre famille";
  return /^[A-ZÀ-Ý][a-zà-ÿ]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * What the method says for or against one champion in one role, at one pick.
 * `slot` is the number of the pick, 1 to 10. `taken`: every champion banned
 * or picked. `profiles`: Kazewa's champion profiles (immobile, scaling…).
 * `mine`: the side that picks is the reader's; `plan` is the reader's too.
 * Returns reasons shaped like those of src/coach.mjs, each with its coach and
 * its rule, or the clause of his champion sheet and its video (`sources`).
 */
export function pickNotes({
  champion,
  role,
  side,
  picks,
  slot,
  taken = new Set(),
  plan = null,
  index,
  profiles = null,
  mine = true,
  weights = METHOD_WEIGHTS,
}) {
  const info = index?.of(champion);
  if (!info) return [];
  const foeSide = other(side);
  const team = picks[side];
  const enemy = picks[foeSide];
  const before = lockedOf(team).length; // picks this side has already made
  const open = ROLES.filter((lane) => !team[lane]);
  const last = open.length === 1;
  const firstPhase = before < 3;
  const blind = !enemy[role];
  // The plan is the reader's. The other side only sees the picks.
  const own = composition(team, index, mine ? plan : null);
  const foe = composition(enemy, index, null);
  const your = mine ? "ta" : "leur";
  const reasons = [];
  // A rule the notes mark as uncertain is said, hedged, and scores nothing.
  const add = (points, kind, coach, text, rule, extra = {}) => {
    const unsure = Boolean(rule && index.rules[rule]?.uncertain);
    reasons.push({
      points: unsure ? 0 : round(points),
      kind: unsure ? "note" : kind,
      coach,
      text,
      rule: rule ?? null,
      ...(unsure ? { unsure: true } : {}),
      ...extra,
    });
  };
  // A line that rests on a clause of his champion sheet, with its video.
  const said = (entry) => ({ sources: [{ video: entry.video, ts: entry.ts, title: `Shanei · ${entry.title}` }] });
  // Is the family of each side settled enough to count for or against a pick?
  const settled = (comp) =>
    Boolean(comp.family) && (comp.basis === "plan" || Boolean(comp.carry) || comp.size >= weights.familyFrom);
  const ownFamily = settled(own) ? own.family : null;
  const foeFamily = settled(foe) ? foe.family : null;
  // The roles of a flex he validates that are still open: the role stays hidden.
  const hidden = info.flexRule ? info.flexRoles.filter((lane) => open.includes(lane)) : [];
  // He plays the champion elsewhere: his words on it do not describe this pick.
  const offRole = info.roles.length > 0 && !info.roles.includes(role);
  const carry = own.carry;
  const waitsEnchanter = ownFamily === "hypercarry" && carry && !own.core;
  // The reader said they play hypercarry: any of his enchanters is the enchanter.
  const declared = own.basis === "plan" && own.family === "hypercarry";
  // "Dans la famille (X) : <what he says of the champion there>", or without the description.
  const described = (head, piece) => (piece ? closed(`${head} : ${piece}`) : `${head}.`);

  /* --- The order of roles (Shanei), and where Kazewa agrees ---------- */
  if (role === "top") {
    if (!blind) {
      if (slot === 10)
        add(weights.order * 0.67, "order", "shanei", "Le top en dernier pick rouge, pour répondre au top adverse : ce que veut Shanei.", "sp-4");
      else
        add(
          weights.order * 0.67,
          "order",
          "shanei",
          mine
            ? "Leur top est sorti : le tien peut lui répondre, et c’est le counter-pick qui coûte le plus cher à subir."
            : "Ton top est sorti : le leur peut lui répondre, et c’est le counter-pick qui coûte le plus cher à subir.",
          "sp-0",
        );
      if (slot === 10)
        add(0.5, "order", "kazewa", "Kazewa réserve lui aussi le dernier pick rouge au contre-pick du top.", "kp-22");
    } else if (!last && slot !== 8) {
      // Slot 8 and 9 are two blue picks in a row: their order tells red nothing.
      // A flex whose role stays hidden is not a top shown to the opponent.
      const flexFirst = info.firstPick === "flex" && info.flexRoles.filter((lane) => open.includes(lane)).length >= 2;
      if (slot === 1) {
        if (!flexFirst)
          add(-weights.first, "order", "shanei", "Shanei ne first pick jamais un top : c’est le rôle le plus puni par le counter-pick.", "sp-6");
      } else if (BLIND_TOPS[champion] && (BLIND_TOPS[champion] !== "sp-42" || own.family === "hypercarry"))
        add(-weights.order / 3, "order", "shanei", "Shanei garde le top pour la fin, mais ce top-là se blind sans trop de risque.", BLIND_TOPS[champion]);
      else if (firstPhase)
        // His rule "the top is always the last pick" is a principle, not a preference: three times the order weight.
        add(-weights.order * 3, "order", "shanei", "Shanei garde le top pour le dernier pick : pris maintenant, il se fait counter.", "sp-0");
      else if (!team.sup)
        add(-weights.order * 3, "order", "shanei", "Shanei garde top et support pour la dernière rotation, et prend le support avant le top.", side === "red" ? "sp-3" : "sp-6");
      else if (!team.mid)
        add(-weights.order / 3, "order", "shanei", "S’il faut blind une solo lane, Shanei blind le mid plutôt que le top.", "sp-5");
    }
  }
  if (role === "sup" && open.length > 1) {
    const securing = waitsEnchanter && enchants(carry, info, declared);
    if (before < 2 && blind && !securing && hidden.length < 2)
      add(-weights.order, "order", "shanei", "Shanei ne blind pas le support en première rotation : il se choisit en voyant le support adverse.", "sp-7");
    else if (before === 3 && !team.top) {
      if (!blind)
        add(
          weights.order * 0.67,
          "order",
          "shanei",
          mine
            ? "Leur support est sorti : au bot c’est le support qui fait le matchup, le tien peut y répondre."
            : "Ton support est sorti : au bot c’est le support qui fait le matchup, le leur peut y répondre.",
          "sp-0",
        );
      else if (side === "red")
        add(weights.order * 0.67, "order", "shanei", "Shanei blind le support au quatrième pick rouge pour garder le dernier au top.", "sp-3");
      else
        add(weights.order * 0.67, "order", "shanei", "Shanei garde top et support pour la dernière rotation : le support d’abord.", "sp-6");
    }
  }
  if (role === "bot" && firstPhase && open.length > 1)
    add(weights.order * 0.67, "order", "shanei", "L’ADC se prend tôt : au bot c’est le support qui fait le matchup.", "sp-0");
  if (role === "jng" && before < 2 && blind)
    add(weights.order / 3, "order", "shanei", "Le jungler se blind mieux qu’un support.", "sp-7");
  if (role === "mid" && slot === 6 && !blind)
    add(weights.order * 0.67, "order", "shanei", "Shanei se sert du troisième pick rouge pour counter le mid adverse.", "sp-2");

  /* --- The first pick and the blind picks --------------------------- */
  const firstBacked = info.firstRule ?? null;
  const firstExtra = !info.firstRule && info.firstSaid ? said(info.firstSaid) : {};
  if (slot === 1) {
    if (info.firstPick === "safe")
      add(weights.first, "first", "shanei", "Un first pick sûr d’après Shanei : il se blind sans se faire punir.", firstBacked, firstExtra);
    else if (info.firstPick === "flex" && !(role === "top" && champion === "Malphite"))
      add(
        weights.first,
        "first",
        "shanei",
        `Un flex que Shanei valide en first pick${info.flexRoles.length > 1 ? ` (${info.flexRoles.map((lane) => ROLE_FR[lane]).join(", ")})` : ""} : il cache le rôle.`,
        firstBacked,
        firstExtra,
      );
    else if (info.firstPick === "no" && role !== "top")
      add(-weights.first, "first", "shanei", "Shanei ne le prend pas en first pick.", firstBacked, firstExtra);
    const kazewa = KAZEWA_FIRST[champion];
    if (kazewa) add(kazewa.good ? 1 : -1, "first", "kazewa", kazewa.text, kazewa.rule);
  } else if (firstPhase && blind && info.firstPick === "safe")
    add(weights.first * 0.4, "first", "shanei", "Un pick que Shanei blind sans crainte.", firstBacked, firstExtra);
  if (slot !== 1) {
    if (champion === "Sylas") {
      if (firstPhase)
        add(-weights.blind, "blind", "shanei", "Shanei ne prend Sylas qu’en deuxième rotation : son intérêt est de voler les ultimes adverses.", "sp-39");
    } else if (champion === "Jarvan IV") {
      // His rule is about the opposing carries, not about the opposing jungler.
      if (!team.bot && (!enemy.top || !enemy.mid || !enemy.bot))
        add(-weights.blind, "blind", "shanei", "Shanei ne lock pas Jarvan IV avant d’avoir vu les carries adverses et l’ADC de son équipe : ils prennent des dashs et il ne peut plus engager.", "sp-11");
    } else if (blind && info.neverBlind && (!info.blindRole || info.blindRole === role)) {
      if (info.blindRule) add(-weights.blind, "blind", "shanei", "Shanei ne le blind pas.", info.blindRule);
      else if (info.blindSaid)
        add(-weights.blind, "blind", "shanei", closed(`Shanei ne le blind pas : ${info.blindSaid.text}`), null, said(info.blindSaid));
    }
    if (blind && KAZEWA_BLIND[champion])
      add(-0.5, "blind", "kazewa", "Pour Kazewa aussi : pris en aveugle, il se fait contre-picker.", KAZEWA_BLIND[champion]);
  }
  if (champion === "Galio" && blind && !taken.has("Gangplank") && !enemy.top)
    add(-weights.blind * 0.67, "blind", "shanei", "Shanei ne blind pas Galio tant que Gangplank est ouvert en face.", "sp-38");

  /* --- Flex --------------------------------------------------------- */
  if (firstPhase && hidden.length >= 2 && !(slot === 1 && info.firstPick === "flex") && !(slot === 1 && info.firstPick == null && info.flexRoles.length >= 2))
    add(weights.flex, "flex", "shanei", `Un flex validé par Shanei (${hidden.map((lane) => ROLE_FR[lane]).join(" ou ")}) : garde l’ambiguïté le plus longtemps possible.`, info.flexRule);

  /* --- The family of the composition -------------------------------- */
  const source = own.basis === "plan" ? "la famille visée" : `la famille de ${your} compo`;
  // A champion he did not class himself: the family is said, not counted.
  const deduced = info.basis !== "cited";
  const familyLine = (points, text, rule, extra = {}) =>
    deduced
      ? add(0, "note", "shanei", `${text.replace(/\.$/, "")} (famille déduite de ses définitions : il ne l’a pas classé lui-même).`, rule, extra)
      : add(points, "family", "shanei", text, rule, extra);
  if (ownFamily && role !== "top" && info.families.length) {
    if (ownFamily === "hypercarry") {
      const inside =
        role === "sup"
          ? carry ? enchants(carry, info, declared) : info.hyper
          : role === "jng"
            ? (info.tank && carry?.role !== "jng") || (!carry && info.carry > 0)
            : role === "mid"
              ? carry?.role === "jng" ? info.tank : info.families.includes("hypercarry") && !info.assassin
              : role === "bot" && !carry && info.carry > 0;
      if (inside && !offRole)
        familyLine(weights.family, described(`Dans ${source} (${own.label})`, pieceOf(info, "hypercarry")), role === "jng" && info.tank && carry?.role === "bot" ? "sf-30" : "sf-5", { also: ["kp-46"] });
    } else if (fits(ownFamily, info)) {
      if (!offRole)
        familyLine(weights.family, described(`Dans ${source} (${own.label})`, pieceOf(info, ownFamily)), "sf-5", { also: ["kp-46"] });
    } else {
      const mix = (ownFamily === "poke" && allIn(info)) || (ownFamily === "all-in" && pokeSide(info));
      familyLine(
        -(mix && own.basis === "plan" ? weights.offPlan : weights.offTheme),
        closed(`Hors thème : ${your} compo part ${own.label}, et il est ${pieceOf(info)}`),
        mix ? "sf-6" : "sf-5",
        { also: ["kp-45"] },
      );
    }
  }

  /* --- The pieces still missing ------------------------------------- */
  if (ownFamily === "hypercarry") {
    // The carry itself, while the composition has none.
    // The carry itself, while the composition has none. The ADC is the usual
    // one; he calls the jungle and top versions harder to draft.
    if (!carry && info.carry === 2 && ["bot", "jng", "top"].includes(role) && !offRole)
      add(weights.need * (role === "bot" ? weights.lastChance : 1), "need", "shanei", described(`L’hypercarry autour duquel bâtir ${your} compo`, pieceOf(info, "hypercarry")), carryRule({ role }));
    if (waitsEnchanter) {
      const where = firstPhase ? "à sécuriser avant les bans" : "à prendre tant qu’il est libre";
      if (enchants(carry, info, declared) && (role === "sup" || role === "jng"))
        add(weights.rare, "need", "shanei", `L’enchanteur ${de(carry.name)} : une pièce rare, ${where}.`, firstPhase ? "sp-9" : carryRule(carry), { with: carry.name });
      else if (role === "sup" && carry.role !== "top")
        add(-weights.need * weights.lastChance, "need", "shanei", `${carry.name} attend son enchanteur, et le support est la place de cet enchanteur.`, carryRule(carry), { with: carry.name });
    }
    if (role === "mid" && carry) {
      if (info.assassin)
        add(-weights.need, "need", "shanei", "Le mid d’une compo hypercarry doit être défensif : pas un assassin.", carry.role === "jng" ? "sf-53" : "sf-32");
      else if (carry.role === "jng" && info.tank)
        add(weights.need, "need", "shanei", `Le tank au mid que demande un hypercarry jungle comme ${carry.name}.`, "sf-34", { with: carry.name });
      else if (carry.role === "jng")
        add(-weights.need, "need", "shanei", `Un hypercarry jungle comme ${carry.name} veut un tank au mid.`, "sf-34", { with: carry.name });
      else if (carry.role === "bot" && (info.global || (info.waveclear && info.families.includes("hypercarry"))))
        add(weights.need * 0.5, "need", "shanei", "Un mid qui sécurise l’hypercarry : waveclear, et idéalement un global.", "sf-31");
    }
  }
  if (ownFamily === "poke" && role === "mid") {
    if (pokeMid(info))
      add(weights.need * weights.lastChance, "need", "shanei", "Le mid d’une compo poke : la pièce indispensable de la famille, à sécuriser.", "sf-45");
    else add(-weights.need, "need", "shanei", "Pas un mid de poke : la pièce indispensable de la famille manquerait.", "sf-45");
  }
  // He says it of one draft, in front of Morgana: elsewhere it is said, not counted.
  if (ownFamily === "all-in" && !own.engage.length && info.engage && allIn(info) && before >= 2 && !offRole) {
    if (foe.has("Morgana"))
      add(weights.need * 0.67, "need", "shanei", `Une source d’engage : face à Morgana, ${your} compo all-in n’en a pas encore.`, "sf-73");
    else add(0, "note", "shanei", `Apporterait une source d’engage : ${your} compo all-in n’en a pas encore.`, "sf-73");
  }
  // A real tank among jungle, mid, ADC and support.
  if (BLOCK.includes(role) && !own.tank && !speedException(own, champion)) {
    // The open slots of the block of four, the ADC included (sp-74).
    const tankSlots = BLOCK.filter((lane) => !team[lane]);
    const lastSlot = tankSlots.length === 1 && tankSlots[0] === role;
    const jungle = own.at("jng");
    if (info.tank && !offRole && (own.block.length >= 2 || (jungle && !jungle.info.tank)))
      add(
        weights.need * (lastSlot ? weights.lastChance : 1),
        "need",
        "shanei",
        jungle && !jungle.info.tank
          ? `${jungle.name} n’est pas un tank : Shanei sécurise alors tout de suite le tank du bloc de quatre.`
          : `Le vrai tank qu’il faut parmi jungle, mid, ADC et support : ${your} compo n’en a pas encore.`,
        jungle && !jungle.info.tank ? "sr-57" : "sp-74",
        { also: ["kp-59"], tank: true },
      );
    else if (!info.tank && lastSlot)
      add(-weights.need * weights.lastChance, "need", "shanei", "Dernière place du bloc de quatre qui peut porter un tank, et toujours pas de vrai tank : le top ne compte pas.", "sp-74");
  }

  /* --- Construction: damage type, immobiles, scaling ----------------- */
  if (dealsDamage(role, info) && own.sources.length >= 2) {
    const onlyAp = !own.physical.length;
    const onlyAd = !own.magic.length;
    const heavy = own.sources.length >= 3 ? 1.5 : 1;
    const also = { also: ["kp-71"] };
    if (onlyAp && info.damage === "ap")
      add(-weights.build * heavy, "build", "shanei", `Déjà ${own.sources.length} sources de dégâts magiques et aucune physique : jamais full AP.`, own.sources.length >= 3 ? "sr-6" : "sp-75", also);
    else if (onlyAp)
      add(weights.build, "build", "shanei", `Apporte les dégâts physiques qui manquent : ${your} compo n’a que de l’AP.`, own.sources.length >= 3 ? "sr-6" : "sp-75", also);
    else if (onlyAd && info.damage === "ad")
      add(-weights.build * heavy, "build", "shanei", `Déjà ${own.sources.length} sources de dégâts physiques et aucune magique : jamais full AD.`, "sp-75", also);
    else if (onlyAd)
      add(weights.build, "build", "shanei", `Apporte les dégâts magiques qui manquent : ${your} compo n’a que de l’AD.`, "sp-75", also);
  }
  if (profiles) {
    const mates = lockedOf(team).map((ally) => ({ ...ally, profile: profiles[ally.name] ?? {} }));
    const self = profiles[champion] ?? {};
    const immobile = mates.filter((ally) => (ally.profile.immobile ?? 0) >= 2);
    if ((self.immobile ?? 0) >= 2 && immobile.length >= 2) {
      const catcher = lockedOf(enemy).find((foeman) => (profiles[foeman.name]?.catch ?? 0) >= 2);
      if (catcher)
        add(-weights.build * 1.5, "build", "kazewa", `Troisième immobile avec ${list(immobile.map((ally) => ally.name))}, face à ${catcher.name} : pour Kazewa, trois immobiles face à un catcheur, c’est perdu.`, "kp-68");
      else
        add(-weights.build, "build", "kazewa", `Troisième immobile avec ${list(immobile.map((ally) => ally.name))} : Kazewa ne les empile pas.`, "kp-67");
    } else if ((self.immobile ?? 0) >= 2 && immobile.length === 1)
      add(-weights.build * 0.5, "build", "kazewa", `Deuxième immobile avec ${immobile[0].name} : Kazewa n’aime pas les empiler.`, "kp-67");
    const scaling = mates.filter((ally) => (ally.profile.scaling ?? 0) >= 2);
    if (scaling.length >= 2 && (self.scaling ?? 0) >= 2)
      add(-weights.build, "build", "kazewa", `Troisième pick de scaling avec ${list(scaling.map((ally) => ally.name))} : deux au maximum pour Kazewa.`, "kp-56");
    else if (scaling.length >= 2 && (self.bridge ?? 0) >= 1 && !mates.some((ally) => (ally.profile.bridge ?? 0) >= 1))
      add(weights.build * 0.75, "build", "kazewa", `Le pont que Kazewa demande entre deux picks de scaling (${list(scaling.map((ally) => ally.name))}).`, "kp-57");
    // Kazewa: a tank or frontline within the first two picks.
    if (!reasons.some((reason) => reason.tank) && before === 1 && (self.frontline ?? 0) >= 2 && !mates.some((ally) => (ally.profile.frontline ?? 0) >= 2))
      add(0.75, "need", "kazewa", "Kazewa sécurise un tank dans ses deux premiers picks, pour ne pas finir la draft sans.", "kp-14");
  }

  /* --- The duos he names --------------------------------------------- */
  let comboTotal = 0;
  for (const ally of lockedOf(team)) {
    const entry = index.pair(champion, ally.name);
    if (!entry) continue;
    if (!entry.good) {
      if (entry.unless && entry.unless === ownFamily) continue;
      if (entry.soft)
        add(0, "note", "shanei", `Avec ${ally.name} : un duo que Shanei juge surcoté.`, entry.rule, { with: ally.name });
      else add(-weights.antiSynergy, "combo", "shanei", `Anti-synergie avec ${ally.name} d’après Shanei.`, entry.rule, { with: ally.name });
      continue;
    }
    if (offRole) continue;
    if (entry.lanes && (entry.lanes[champion] !== role || entry.lanes[ally.name] !== ally.role)) continue;
    const points = Math.min(entry.origin === "video" ? weights.combo : weights.courseCombo, weights.comboCap - comboTotal);
    if (points <= 0) continue;
    comboTotal += points;
    add(
      points,
      "combo",
      "shanei",
      entry.origin === "video"
        ? `Combo que Shanei nomme avec ${ally.name}.`
        : `Duo avec ${ally.name} dans la table des combos du cours de Shanei.`,
      entry.rule,
      { with: ally.name },
    );
  }

  /* --- Against what the opponent shows ------------------------------- */
  const versus = (points, text, rule, coach = "shanei") => add(points, "counter", coach, text, rule);
  // An answer that would break the picker's own family is not one.
  const earlyAnswer = !ownFamily || ownFamily === "all-in";
  const pokeAnswer = !ownFamily || ownFamily === "poke";
  if (foeFamily === "hypercarry") {
    const target = foe.carry?.name ?? "leur carry";
    if (info.families.includes("all-in-full-early") && earlyAnswer)
      versus(weights.counter, `Contre une hypercarry annoncée (${target}), Shanei ne connaît que deux réponses : ici le full early.`, "sp-46");
    else if (info.poker && pokeAnswer)
      versus(weights.counter, `Contre une hypercarry annoncée (${target}), Shanei ne connaît que deux réponses : ici le full poke.`, "sp-46");
    else if (info.carry === 2 && role === "bot" && own.family !== "hypercarry")
      versus(-weights.counter, `Répondre à ${target} par un autre hypercarry donne une compo sans identité, d’après Shanei.`, "sp-46");
  }
  if (foeFamily === "poke") {
    if (champion === "Bard") versus(weights.counter * 1.5, "Bard : un très gros counter des compos poke d’après Shanei.", "sf-64");
    else if (SPLIT_TOPS.includes(champion) && role === "top")
      versus(weights.counter, "Un très bon splitpusher contre une compo poke : un soft counter d’après Shanei.", "sf-66");
    else if ((champion === "Sivir" || champion === "Karma") && own.has(champion === "Sivir" ? "Karma" : "Sivir") && (!ownFamily || ownFamily === "all-in"))
      versus(weights.counter, "La vitesse de Sivir et Karma contre une compo poke : son premier counter d’après Shanei.", "sf-65");
    else if ((champion === "Kog'Maw" || champion === "Twitch") && role === "bot")
      versus(weights.counter, "Un hypercarry très longue portée : la réponse de Shanei à l’ADC d’une compo poke.", "sf-69");
  }
  if (foeFamily === "all-in") {
    if (champion === "Morgana" && role === "sup")
      versus(weights.counter * 1.5, "Morgana en support contre une compo all-in : le counter-pick que Shanei laisse grand ouvert.", "sf-72");
    else if (champion === "Braum" && foe.has("Draven"))
      versus(weights.counter * 1.5, "Braum contre une botlane all-in de Draven : la réponse de Shanei pour pouvoir jouer la lane.", "sf-58");
    else if (champion === "Braum" && foe.has("Samira"))
      versus(weights.counter * 1.5, "Samira est en face : Braum est le ban automatique de Shanei quand il la joue.", "sp-50");
    else if (ANTI_DIVE[champion])
      versus(
        weights.counter,
        ANTI_DIVE[champion] === "sf-56"
          ? "Un anti-dive : ce que Shanei bannit lui-même quand il joue all-in."
          : "Un support qui temporise : ce que Shanei bannit en priorité quand il joue all-in.",
        ANTI_DIVE[champion],
      );
    else if (DEFENSIVE_GLOBALS.includes(champion) && foe.sub !== "all-in-wombo")
      versus(weights.counter * 0.75, "Un global défensif : une réponse au dive d’une compo all-in d’après Shanei.", "sf-55");
  }
  if (STEALABLE.includes(champion)) {
    if (foe.has("Sylas"))
      versus(-weights.offPlan, "Sylas est en face : Shanei ne lui offre jamais un bon ultime à voler.", "sp-48");
  }
  if (foe.has("Poppy") && champion === "Alistar")
    versus(-weights.counter * 1.5, "Poppy est en face : elle annule les engages d’Alistar, Shanei prend Nautilus.", "sr-31");
  if (champion === "Malphite" && foe.fullAd)
    versus(weights.counter * 1.5, mine ? "Leur compo est full AD : Malphite annule la vitesse d’attaque, d’après Shanei." : "Ta compo est full AD : Malphite annule la vitesse d’attaque, d’après Shanei.", "sr-52");
  if (champion === "Neeko" && foe.mobile.length >= 3)
    versus(-weights.counter, "Trois champions mobiles en face : Neeko n’est forte que contre les immobiles, d’après Shanei.", "sr-32");
  if (info.global && foe.at("top")?.info.families[0] === "split")
    versus(weights.counter * 0.75, `Un ultime global contre le split ${de(foe.at("top").name)} : la réponse de Kazewa.`, "kp-82", "kazewa");
  return reasons;
}

/**
 * What the method says of a ban. `side` is the side that bans. `roles`: the
 * roles the champion is really played in (the banning side can only "need"
 * a champion it could still pick). Returns reasons like pickNotes().
 */
export function banNotes({ champion, side, picks, plan = null, index, profiles = null, mine = true, roles = null, weights = METHOD_WEIGHTS }) {
  const info = index?.of(champion);
  if (!info) return [];
  const foeSide = other(side);
  const own = composition(picks[side], index, mine ? plan : null);
  const foe = composition(picks[foeSide], index, null);
  const reasons = [];
  const add = (points, coach, text, rule, extra = {}) =>
    reasons.push({ points: round(points), kind: "ban", coach, text, rule, ...extra });
  const your = mine ? "ta" : "leur";
  // Never ban a piece of one's own composition: a champion it could still pick.
  const openMine = ROLES.filter((role) => !picks[side][role]);
  const canTake = openMine.length > 0 && (roles ? roles.some((role) => openMine.includes(role)) : true);
  if (canTake) {
    const partner = own.members.find((member) => {
      const entry = index.pair(champion, member.name);
      return entry?.good && entry.origin === "video" && !entry.uncertain;
    });
    if (own.family === "hypercarry" && own.carry && !own.core && enchants(own.carry, info, own.basis === "plan") && openMine.includes("sup")) {
      add(-weights.ownPiece, "shanei", `C’est l’enchanteur qu’il faut à ${own.carry.name} : Shanei ne bannit jamais un pick qui sert sa propre compo.`, "sp-56");
      return reasons;
    }
    if (partner) {
      add(-weights.ownPiece, "shanei", `Il combote avec ${partner.name} : Shanei ne bannit jamais un pick qui sert sa propre compo.`, "sp-56");
      return reasons;
    }
  }
  const immobile = profiles ? own.members.filter((member) => (profiles[member.name]?.immobile ?? 0) >= 2) : [];
  let best = null;
  for (const entry of index.bans) {
    if (!entry.champions.includes(champion)) continue;
    let points = 0;
    let text = "";
    const partner = (entry.with ?? []).find((name) => own.has(name));
    const target = (entry.against ?? []).find((name) => foe.has(name));
    if (partner) {
      points = weights.banWith;
      text = `${mine ? "Tu joues" : "Ils jouent"} ${partner} : Shanei bannit ${champion} pour le protéger.`;
    } else if (entry.mine && entry.mine === own.family) {
      points = weights.ban;
      text = `Shanei bannit ce qui casse ${your} compo ${own.label} : ${champion} en fait partie.`;
    } else if (entry.theirs && entry.theirs === foe.family) {
      points = weights.ban;
      text = `Contre ${mine ? "leur" : "ta"} compo ${foe.label}, Shanei retire ses pièces : ${champion} en est une.`;
    } else if (target) {
      points = weights.ban;
      text = `Contre ${target}, Shanei bannit ce qui le solidifie : ${champion}.`;
    } else if (entry.immobiles && immobile.length >= entry.immobiles) {
      points = weights.ban;
      text = `Deux immobiles dans ${your} compo (${list(immobile.slice(0, 2).map((member) => member.name))}) : Shanei bannit ${champion}.`;
    }
    if (points > (best?.points ?? 0)) best = { points, text, rule: entry.rule };
  }
  if (best) add(best.points, "shanei", best.text, best.rule);
  return reasons;
}

/* ------------------------------------------------------------------ */
/* The rules of the step being played                                  */
/* ------------------------------------------------------------------ */

/**
 * The rules of both coaches for the current step. `step` comes from
 * currentStep() of src/draft-coach.mjs. Each line: the id of the rule, its
 * coach, its sentence, and whether the notes mark it as uncertain.
 */
export function stepBrief(step, index) {
  if (!index) return [];
  let ids;
  if (!step) ids = ["sp-73", "sp-74", "sp-75", "sp-79", "kp-86"];
  else if (step.action === "ban") ids = step.index < 6 ? ["sp-49", "sp-56", "kp-33", "kp-31"] : ["sp-69", "kp-43"];
  else if (step.slot === 1) ids = ["sp-14", "sp-70", "kp-2"];
  else if (step.slot <= 3) ids = ["sp-8", "sp-71", "kp-17"];
  else if (step.slot <= 5) ids = ["sp-9", "sp-13", "kp-14"];
  else if (step.slot === 6) ids = ["sp-2", "sp-45", "kp-20"];
  else if (step.slot === 7) ids = ["sp-3", "sp-10", "kp-15"];
  else if (step.slot <= 9) ids = ["sp-6", "sp-73", "kp-23"];
  else ids = ["sp-4", "sp-44", "kp-22"];
  return ids
    .filter((id) => index.rules[id])
    .map((id) => ({ id, coach: index.rules[id].coach, text: index.rules[id].text, uncertain: index.rules[id].uncertain }));
}

/**
 * Where a composition stands while it is drafted: its family and the pieces
 * the two coaches would check, for the panel next to the board.
 * Each item: { state: "ok" | "todo" | "bad", coach, text, rule }.
 */
export function compositionStatus(team, enemy, index, { plan = null, profiles = null } = {}) {
  if (!index) return null;
  const own = composition(team, index, plan);
  const items = [];
  const add = (state, coach, text, rule) => items.push({ state, coach, text, rule });
  if (!own.size) return { family: plan, label: plan ? FAMILY_FR[plan] : null, basis: plan ? "plan" : null, items };
  const done = own.size === 5;
  const names = (members) => list(members.map((member) => member.name));
  if (own.family === "hypercarry") {
    const carry = own.carry;
    if (!carry)
      add(done || CARRY_ROLES.every((role) => team[role]) ? "bad" : "todo", "shanei", "Plan hypercarry : pas encore d’hypercarry dans la compo.", "sf-29");
    else if (own.core) add("ok", "shanei", `${carry.name} et son enchanteur ${own.core.enchanter.name}.`, carryRule(carry));
    else {
      const closedOff = Boolean(team.sup) && (carry.role !== "top" || Boolean(team.jng));
      add(closedOff ? "bad" : "todo", "shanei", `${carry.name} attend son enchanteur.`, carryRule(carry));
    }
    if (carry?.role === "jng" && !own.at("mid")?.info.tank)
      add(team.mid ? "bad" : "todo", "shanei", `Hypercarry jungle : ${carry.name} veut un tank au mid.`, "sf-34");
  } else if (own.family) {
    const out = own.off.length === 1 ? own.off[0] : null;
    const mix = out && ((own.family === "poke" && allIn(out.info)) || (own.family === "all-in" && pokeSide(out.info)));
    if (out?.info.carry === 2) {
      // Still fixable while the place of its enchanter is open.
      const closedOff = Boolean(team.sup) && (out.role !== "top" || Boolean(team.jng));
      add(
        closedOff ? "bad" : "todo",
        "shanei",
        closedOff
          ? `${out.name} est un hypercarry sans enchanteur, dans une compo ${own.label}.`
          : `${out.name} est un hypercarry dans une compo ${own.label} : il attend un enchanteur.`,
        carryRule(out),
      );
    } else if (own.off.length >= 2)
      add("bad", "shanei", `Hors de la famille ${own.label} : ${names(own.off)}.`, "sf-5");
    else if (out)
      // As in his reading: one pick out of theme is a fault when it mixes poke and engage.
      add(done ? (mix ? "bad" : "note") : "todo", "shanei", `Hors de la famille ${own.label} : ${out.name}.`, mix ? "sf-6" : "sf-5");
    else if (own.fit.length >= 2)
      add("ok", "shanei", done ? `Une seule famille : ${own.label}.` : `Une seule famille jusqu’ici : ${own.label}.`, "sp-73");
  } else if (own.block.length >= 2) add(done ? "bad" : "todo", "shanei", "Pas de famille lisible : all-in, poke ou hypercarry ?", "sf-1");
  // The plan says one family, the picks another: said while it can be fixed.
  if (own.basis === "plan" && own.block.length >= 3) {
    const bare = composition(team, index, null);
    if (bare.family !== own.family)
      add("todo", "shanei", bare.family ? `Sans ton plan, tes picks se liraient plutôt ${bare.label}.` : "Sans ton plan, tes picks ne dessinent aucune famille.", "sf-1");
  }
  const tankSlots = BLOCK.filter((role) => !team[role]);
  if (own.tank) add("ok", "shanei", `Tank du bloc de quatre : ${own.tank.name}.`, "sp-74");
  else if (speedException(own)) add("ok", "shanei", "Pas de tank : la compo full speed Kled, Sivir et Karma est la seule exception qu’il donne.", "sp-74");
  else if (tankSlots.length) add("todo", "shanei", "Il faudra un vrai tank parmi jungle, mid, ADC et support.", "sp-74");
  else add("bad", "shanei", "Pas de vrai tank parmi jungle, mid, ADC et support.", "sp-74");
  if (own.family === "poke" && !(own.at("mid") && pokeMid(own.at("mid").info)))
    add(team.mid ? "bad" : "todo", "shanei", "Compo poke : il faut un mid de poke.", "sf-45");
  if (done) {
    if (own.fullAp) add("bad", "shanei", `Composition full AP (${names(own.sources)}).`, "sp-75");
    else if (own.fullAd) add("bad", "shanei", `Composition full AD (${names(own.sources)}).`, "sp-75");
  } else if (own.sources.length >= 2) {
    if (!own.physical.length)
      add("todo", "shanei", `Que des dégâts magiques pour l’instant (${names(own.sources)}) : il faudra de l’AD.`, "sp-75");
    else if (!own.magic.length)
      add("todo", "shanei", `Que des dégâts physiques pour l’instant (${names(own.sources)}) : il faudra de l’AP.`, "sp-75");
  }
  if (profiles) {
    const immobile = own.members.filter((member) => (profiles[member.name]?.immobile ?? 0) >= 2);
    if (immobile.length >= 2)
      add(immobile.length >= 3 || done ? "bad" : "todo", "kazewa", `${immobile.length} immobiles (${names(immobile)}) : Kazewa ne les empile pas.`, "kp-67");
    const scaling = own.members.filter((member) => (profiles[member.name]?.scaling ?? 0) >= 2);
    if (scaling.length >= 3) add("bad", "kazewa", `Trois picks de scaling (${names(scaling)}) : deux au maximum pour Kazewa.`, "kp-56");
    else if (scaling.length === 2 && !own.members.some((member) => (profiles[member.name]?.bridge ?? 0) >= 1))
      add(done ? "bad" : "todo", "kazewa", `Deux picks de scaling (${names(scaling)}) : Kazewa veut un pont entre eux.`, "kp-57");
    if (own.size >= 3 && !own.members.some((member) => (profiles[member.name]?.frontline ?? 0) >= 1))
      add(done ? "bad" : "todo", "kazewa", "Pas de frontline : pour Kazewa, sans elle la backline n’existe pas.", "kp-59");
  }
  const foe = composition(enemy, index);
  if (foe.has("Sylas")) {
    const gift = STEALABLE.filter((name) => own.has(name));
    if (gift.length) add("bad", "shanei", `${list(gift)} offre un ultime à leur Sylas.`, "sp-48");
  }
  return { family: own.family, label: own.label, basis: own.family ? own.basis : null, items };
}
