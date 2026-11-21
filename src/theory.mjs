/**
 * The draft reading of the two coaches, as a procedure.
 *
 * Kazewa's decision rubric (KAZEWA_METHOD.md, section 8) is applied as it is
 * written: identity (A), structural holes (B), the grid of axes (C), the
 * bonuses (D), the timing (E) and the verdict with its confidence (F, section
 * 7). Shanei's construction checks (src/method.mjs) add their own holes: a
 * tank in the block of four, no full AD or full AP, an enchanter for a
 * hypercarry. Shanei gives no points for them: they take the weight of the
 * nearest rubric hole, and the reason says so.
 *
 * Nothing here reads professional games. The numbers are the ones of the
 * rubric. Where the rubric names something the champion profiles do not
 * measure, the nearest measured quantity is used and the reason text says so.
 *
 * Not applied, and said so here because they need the pick order, the bans
 * and his named counters: step B's blind pick hard-countered, false counter
 * and first pick handed its counter; step D's decisive pick left open to the other side;
 * step F's downgrade by one for a plan that depends on a player's comfort or
 * on execution. The coach applies Shanei's first pick and blind rules itself
 * (src/method.mjs, pickNotes).
 *
 * The weights are not fitted to the verdicts: research/theory-eval.mjs
 * measures the procedure as it stands.
 */
import { ROLES } from "./engine.mjs";
import { composition, fits as shaneiFits } from "./method.mjs";

const SIDES = ["blue", "red"];
const other = (side) => (side === "blue" ? "red" : "blue");
const round = (value) => Math.round(value * 100) / 100 || 0;
const sum = (list, key) => list.reduce((n, member) => n + (member.f[key] ?? 0), 0);
const BLOCK = ["jng", "mid", "bot", "sup"];

// The axes of step C, in the order of his list.
export const AXES = Object.freeze(["lane", "teamfight", "scaling", "objective", "catch", "side", "range"]);
const AXIS_FR = {
  lane: "la phase de lane",
  teamfight: "le combat d’équipe (front, dégâts, engage)",
  scaling: "le scaling",
  objective: "les objectifs (dégâts soutenus)",
  catch: "le catch",
  side: "le split et les globaux",
  range: "la portée et le poke",
};
// The partner some champions need in the team (his notes: Kog'Maw without
// peel, Ivern without a hyper carry, MF without a wombo, Taliyah or Viego
// with nothing to bridge to).
const PARTNER = { "Kog'Maw": "peel", Ivern: "hyper", "Miss Fortune": "wombo", Taliyah: "bridge", Viego: "bridge" };
const PARTNER_FR = {
  peel: "peel ni enchanteur",
  hyper: "carry hypercarry à enchanter",
  wombo: "wombo ni engage pour la suivre",
  bridge: "pont ni engage pour le relier",
};
const FAMILIES = ["all-in", "poke", "hypercarry"];
const FAMILY_FR = { "all-in": "all-in", poke: "poke / disengage", hypercarry: "hypercarry" };

// The profile fields (data/knowledge.json) are 0 to 2: 2 is a clear case.
const strongEngage = (f) => f.engage >= 2 || f.engageTag;
const disengages = (f) => f.disengage >= 2 || f.disengageTag;
const peels = (f) => f.peel >= 2;
const dealsDamage = (f) => f.dps >= 1 || f.carry > 0;
const immobile = (f) => f.immobile >= 2;
const catches = (f) => f.catch >= 2;
const antiMobility = (f) => f.antiDash >= 2;

// His family of a champion, read from his own classification (data/method.json).
function fitsFamily(family, f) {
  if (family === "all-in") return f.families.some((name) => name.startsWith("all-in"));
  if (family === "poke") return f.families.includes("poke") || f.families.includes("disengage");
  return f.families.includes("hypercarry") || f.carry > 0 || f.enchanter;
}

/** What the procedure knows of one champion, from the profiles and the method. */
export function facts(name, ctx) {
  if (!name) return null;
  if (ctx.facts.has(name)) return ctx.facts.get(name);
  const k = ctx.knowledge?.champions?.[name] ?? {};
  const m = ctx.index?.of(name) ?? {};
  const f = {
    name,
    catch: k.catch ?? 0,
    immobile: k.immobile ?? 0,
    frontline: k.frontline ?? 0,
    peel: k.peel ?? 0,
    disengage: k.disengage ?? 0,
    scaling: k.scaling ?? 0,
    early: k.snowball_early ?? 0,
    bridge: k.bridge ?? 0,
    dps: k.dps ?? 0,
    engage: k.engage ?? 0,
    dashs: k.dashs ?? 0,
    antiDash: k.anti_dash ?? 0,
    global: k.global ?? 0,
    split: k.split ?? 0,
    poke: k.poke ?? 0,
    zone: k.zone ?? 0,
    // Shanei's classification (data/method.json) and the kit grid behind it.
    families: m.families ?? [],
    tank: Boolean(m.tank),
    enchanter: Boolean(m.enchanter),
    carry: m.carry ?? 0,
    engageTag: Boolean(m.engage),
    disengageTag: Boolean(m.disengage),
    damage: m.damage ?? "mixed",
  };
  ctx.facts.set(name, f);
  return f;
}

/** A context for the procedure: the profiles, the method index, a cache of facts. */
export function theoryContext({ knowledge = null, index = null } = {}) {
  return { knowledge, index, facts: new Map(), boards: new Map() };
}

function members(team, ctx) {
  return ROLES.filter((role) => team?.[role])
    .map((role) => ({ role, name: team[role], f: facts(team[role], ctx) }))
    .filter((member) => member.f);
}

// His axes, measured on the profiles. Lane: the early power; teamfight: front,
// damage and engage (2 per engager, a weight the rubric does not give); scaling;
// objectives: sustained damage; catch; split and globals; range: poke and zone.
function axisValues(list) {
  const engagers = list.filter((member) => strongEngage(member.f)).length;
  return {
    lane: sum(list, "early"),
    teamfight: sum(list, "frontline") + sum(list, "dps") + 2 * engagers,
    scaling: sum(list, "scaling"),
    objective: sum(list, "dps"),
    catch: sum(list, "catch"),
    side: sum(list, "global") + sum(list, "split"),
    range: sum(list, "poke") + sum(list, "zone"),
  };
}

// Step C: the side that wins an axis gets one point, two when it wins clearly
// (three points of lead and at least half as much again as the other side).
// The rubric gives the rule (one point, two if clear); the thresholds are ours.
function contest(a, b) {
  if (a === b) return [0, 0];
  const lead = Math.abs(a - b);
  const top = Math.max(a, b);
  const low = Math.min(a, b);
  const points = lead >= 3 && top >= 1.5 * low ? 2 : 1;
  return a > b ? [points, 0] : [0, points];
}

function pairGood(ctx, a, b) {
  const entry = ctx.index?.pair(a, b);
  return Boolean(entry?.good);
}

// Step A: the identity of one side, from his families. A family fits a
// champion when his classification says so. Two picks that fit nothing in
// common are an incoherent side; a side whose picks fit no family at all has
// no identity. Both are read on the block of four, the top aside.
function identityOf(list) {
  const block = list.filter((member) => BLOCK.includes(member.role));
  if (block.length < 3) return { family: null, verdict: "partial" };
  const best = FAMILIES.map((family) => ({ family, n: block.filter((member) => fitsFamily(family, member.f)).length }))
    .sort((a, b) => b.n - a.n)[0];
  if (best.n === 0) return { family: null, verdict: "none", block };
  const against = block.filter((member) => member.f.families.length && !fitsFamily(best.family, member.f));
  if (against.length >= 2) return { family: best.family, verdict: "incoherent", against, block };
  return { family: best.family, verdict: "coherent", block };
}

// Step D: a chain is a pick that goes with another (his combos, or the same
// family). Read over the picks present, at least two of them.
function chains(list, ctx, identity) {
  if (list.length < 2) return false;
  const paired = list.every((member) => list.some((other) => other !== member && pairGood(ctx, member.name, other.name)));
  const family = identity.verdict === "coherent" && identity.block.length === list.length;
  return paired || family;
}

/**
 * Structural holes (step B) of one side, and Shanei's checks. Both sides must
 * have at least three picks before a hole counts: a side with fewer picks is
 * not yet judged, and comparing it with one that is would favour the first.
 */
function holesOf(side, team, mine, theirs, ctx, identity) {
  const holes = [];
  const hole = (id, points, label, text, coach = "kazewa", rule = null) =>
    holes.push({ id, points, label, text, coach, rule, step: "B" });
  const comp = ctx.index && mine.length ? composition(team, ctx.index) : null;
  const names = (list) => list.map((member) => member.name).join(" et ");
  const tank =
    mine.some((member) => member.f.tank || member.f.frontline >= 2) ||
    (mine.some((member) => member.f.enchanter) && mine.some((member) => !member.f.enchanter && member.f.frontline >= 1));
  if (!tank) hole("tank", -3, "pas de tank ni de frontline", "Pas de vrai tank ni de frontline : sans elle la backline ne tient ni les combats ni les objectifs.");
  if (mine.filter((member) => dealsDamage(member.f)).length < 2)
    hole("damage", -3, "moins de deux sources de dégâts soutenus", "Moins de deux sources de dégâts soutenus : la compo ne peut contester ni les tanks ni les objectifs.");
  const immobiles = mine.filter((member) => immobile(member.f)).length;
  if (immobiles >= 3 && theirs.some((member) => catches(member.f) || antiMobility(member.f)))
    hole("immobile", -3, "trois immobiles face à un catch", "Trois carries immobiles face à un catch ou à une anti-mobilité : défaite presque assurée.");
  const engagers = mine.filter((member) => strongEngage(member.f)).length;
  // Two engagers against two diving-back disengagers: the rubric's example is
  // one engage into one disengage block; two is our reading of "a block".
  const diving = theirs.filter((member) => disengages(member.f)).length;
  if (engagers >= 2 && diving >= 2)
    hole("engage", -2, "engage contre un bloc de désengagement", "Un engage contre un bloc de désengagement : les engages ne rentrent pas.");
  if (identity.family === "poke") {
    const support = mine.find((member) => member.role === "sup");
    if (support && strongEngage(support.f) && !mine.some((member) => peels(member.f)))
      hole("poke-engage", -2, "poke avec un support qui engage et aucun peel", "Une compo de poke avec un support qui engage et aucun peel : elle se fait prendre.");
  }
  for (const member of mine) {
    const need = PARTNER[member.name];
    if (!need) continue;
    const ok =
      need === "peel"
        ? mine.some((other) => other !== member && (peels(other.f) || other.f.enchanter))
        : need === "hyper"
          ? mine.some((other) => other !== member && other.f.carry > 0 && (other.role === "bot" || other.role === "top"))
          : need === "wombo"
            ? mine.some((other) => other !== member && (other.f.families.includes("all-in-wombo") || strongEngage(other.f)))
            : mine.some((other) => other !== member && (other.f.bridge >= 1 || strongEngage(other.f)));
    if (!ok) hole(`partner:${member.name}`, -1, `${member.name} sans ${PARTNER_FR[need]}`, `${member.name} a besoin de ${PARTNER_FR[need]} dans sa composition.`);
  }
  // Must win early without a tool to close: his "early" is the lane power of
  // the profiles; the tools are dives, engages, zone control and splits.
  const early = sum(mine, "early");
  const scaling = sum(mine, "scaling");
  const tools = mine.filter((member) => member.f.dashs >= 2 || strongEngage(member.f) || member.f.zone >= 2 || member.f.split >= 2).length;
  if (mine.length >= 4 && early >= scaling + 2 && tools === 0)
    hole("early-tools", -2, "gagne tôt sans outil pour conclure", "Une compo qui doit gagner tôt sans outil pour conclure : ni dash, ni engage, ni siège.");
  // Shanei's checks, on his terms. The weight is the nearest rubric hole's.
  if (comp && mine.length >= 4) {
    const speed = ["Kled", "Sivir", "Karma"].every((name) => mine.some((member) => member.name === name));
    if (!comp.tank && !speed)
      hole("block-tank", -2, "pas de tank dans le bloc de quatre (Shanei)", "Aucun tank parmi jungle, mid, ADC et support : le top ne compte pas, il part en side.", "shanei", "sp-74");
    if (comp.fullAd) hole("full-ad", -2, "full AD (Shanei)", `Composition full AD (${names(comp.sources)}) : l’adversaire n’a qu’une résistance à acheter.`, "shanei", "sp-75");
    if (comp.fullAp) hole("full-ap", -2, "full AP (Shanei)", `Composition full AP (${names(comp.sources)}) : l’adversaire n’a qu’une résistance à acheter.`, "shanei", "sp-75");
  }
  if (comp?.family === "hypercarry" && comp.carry && !comp.core)
    hole("hyper-enchanter", -1, "hypercarry sans enchanteur (Shanei)", `${comp.carry.name} est un hypercarry : il lui faut un enchanteur, et la compo n’en a pas.`, "shanei", "sf-29");
  return holes;
}

function scoreSide(side, team, lists, ctx, axisPoints, holesOn, identities) {
  const mine = lists[side];
  const theirs = lists[other(side)];
  const identity = identities[side];
  const identityItems = [];
  const holes = holesOn ? holesOf(side, team, mine, theirs, ctx, identity) : [];
  const axes = [];
  const bonuses = [];
  const names = (list) => list.map((member) => member.name).join(" et ");

  // A. One identity, in one phrase. Judged on the block of four, from the start.
  if (identity.verdict === "none")
    identityItems.push({ id: "identity", points: -2, label: "aucune identité", text: "Aucune identité lisible : les picks ne se rangent dans aucune des trois familles.", coach: "kazewa", rule: null, step: "A" });
  if (identity.verdict === "incoherent")
    identityItems.push({ id: "identity", points: -2, label: "identités incompatibles", text: `Identités incompatibles : ${names(identity.against)} sortent de la famille ${FAMILY_FR[identity.family]}.`, coach: "kazewa", rule: "sf-5", step: "A" });

  // C. The grid: the axes this side wins. Its points are its own.
  for (const axis of AXES) {
    const points = axisPoints[side][axis];
    if (points)
      axes.push({ id: `axis:${axis}`, points, label: AXIS_FR[axis], text: `Il gagne ${AXIS_FR[axis]} (+${points}).`, coach: "kazewa", rule: null, step: "C" });
  }

  // D. Bonuses. The conditions are the win conditions of his notes: combo,
  // scaling, terrain, split, objective control.
  const chain = chains(mine, ctx, identity);
  if (chain)
    bonuses.push({ id: "chain", points: 2, label: "chaque pick s’enchaîne", text: "Chaque pick s’enchaîne avec un autre : un combo nommé par Kazewa, ou une même famille.", coach: "kazewa", rule: null, step: "D" });
  const conditions = [
    chain,
    mine.some((member) => member.f.scaling >= 2),
    mine.some((member) => member.f.zone >= 2),
    mine.some((member) => member.f.split >= 2),
    mine.filter((member) => member.f.dps >= 2).length >= 2,
  ];
  const count = conditions.filter(Boolean).length;
  const extra = Math.min(3, Math.max(0, count - 1));
  if (extra)
    bonuses.push({ id: "conditions", points: extra, label: `${count} conditions de victoire`, text: `${count} conditions de victoire indépendantes (combo, scaling, terrain, split, objectifs) : l’adversaire ne peut pas toutes les couper.`, coach: "kazewa", rule: null, step: "D" });
  if (identity.verdict === "coherent" && mine.length === 5 && holes.length === 0)
    bonuses.push({ id: "simple-plan", points: 1, label: "plan simple", text: "Un plan simple et cohérent, sans trou structurel.", coach: "kazewa", rule: null, step: "D" });

  const total = (list) => list.reduce((n, item) => n + item.points, 0);
  return {
    side,
    team,
    family: identity.family ? FAMILY_FR[identity.family] : null,
    identity: identityItems,
    holes,
    axes,
    bonuses,
    timing: 0,
    timingText: null,
    points: {
      identity: total(identityItems),
      holes: total(holes),
      axes: total(axes),
      bonuses: total(bonuses),
    },
    total: 0,
  };
}

/**
 * The reading of a draft (either side may be partly picked). `draft` is
 * { blue: {top, jng, mid, bot, sup}, red: {...} } with empty roles as null.
 * Returns the side of his verdict and its confidence (step F), each side's
 * points and the sentences behind them.
 */
export function evaluateDraft(draft, ctx) {
  const key = JSON.stringify(draft);
  if (ctx.boards.has(key)) return ctx.boards.get(key);
  const lists = { blue: members(draft.blue, ctx), red: members(draft.red, ctx) };
  const identities = { blue: identityOf(lists.blue), red: identityOf(lists.red) };
  const axes = { blue: axisValues(lists.blue), red: axisValues(lists.red) };
  const axisPoints = { blue: {}, red: {} };
  for (const axis of AXES) {
    const [blue, red] = contest(axes.blue[axis], axes.red[axis]);
    axisPoints.blue[axis] = blue;
    axisPoints.red[axis] = red;
  }
  // Holes count only when both sides have three picks, so that they are compared.
  const holesOn = Math.min(lists.blue.length, lists.red.length) >= 3;
  const sides = {};
  for (const side of SIDES) sides[side] = scoreSide(side, draft[side], lists, ctx, axisPoints, holesOn, identities);

  // E. Timing. A side that wins early and does not win its lanes, or whose
  // early edge is thin, gives one point to the scaling side it faces. The
  // rubric says one or two points, for "under about 2000 gold at ten minutes"
  // or "the lanes do not win". The profiles carry no gold: the early edge is
  // the lane power of the profiles, and a lead of less than two stands for
  // "under about 2000 gold".
  const early = (list) => sum(list, "early");
  const scaling = (list) => sum(list, "scaling");
  const timingOn = Math.min(lists.blue.length, lists.red.length) >= 4;
  for (const side of SIDES) {
    const enemy = other(side);
    const timer = early(lists[side]) > scaling(lists[side]);
    const scalesMore = scaling(lists[enemy]) > early(lists[enemy]);
    const thinEdge = early(lists[side]) - early(lists[enemy]) < 2;
    const laneLost = axisPoints[side].lane === 0;
    if (timingOn && timer && scalesMore && (laneLost || thinEdge)) {
      sides[side].timing = -1;
      sides[side].timingText = laneLost
        ? "Il compte sur l’avance tôt sans gagner ses lanes : un point pour le camp qui scale."
        : "Son avance tôt est mince : un point pour le camp qui scale.";
      sides[enemy].timing = 1;
      sides[enemy].timingText = "Il scale plus que l’adversaire, qui compte sur l’avance tôt : un point pour lui.";
    }
  }
  for (const side of SIDES) {
    const s = sides[side];
    s.total = round(s.points.identity + s.points.holes + s.points.axes + s.points.bonuses + s.timing);
  }
  const total = round(sides.blue.total - sides.red.total);

  // F. The verdict. The side: the difference, ties go to the side with fewer
  // holes. The confidence counts the holes of the side he does not prefer.
  let side;
  if (total > 0) side = "blue";
  else if (total < 0) side = "red";
  else if (sides.blue.holes.length !== sides.red.holes.length) side = sides.blue.holes.length < sides.red.holes.length ? "blue" : "red";
  else side = "even";
  const gap = Math.abs(total);
  let confidence = 0;
  if (side !== "even" && gap >= 2) {
    const winnerHoles = sides[side].holes.length;
    const loserHoles = sides[other(side)].holes.length;
    if (gap >= 9 || (loserHoles >= 2 && winnerHoles === 0)) confidence = 3;
    else if (gap >= 5 || loserHoles - winnerHoles === 1) confidence = 2;
    else confidence = 1;
  }
  // Two points of difference or less, with no hole to tell the sides apart, is
  // his tier 0: no call.
  if (gap <= 1 && side !== "even" && sides.blue.holes.length === sides.red.holes.length) confidence = 0;

  const result = {
    side,
    confidence,
    total,
    holes: { blue: sides.blue.holes.length, red: sides.red.holes.length },
    blue: sides.blue,
    red: sides.red,
    reasons: [],
  };
  for (const s of SIDES) {
    const side = sides[s];
    for (const item of [...side.identity, ...side.holes, ...side.axes, ...side.bonuses])
      result.reasons.push({ side: s, ...item });
    if (side.timing) result.reasons.push({ side: s, id: "timing", points: side.timing, label: "timing", text: side.timingText, coach: "kazewa", rule: null, step: "E" });
  }
  ctx.boards.set(key, result);
  if (ctx.boards.size > 4000) ctx.boards.delete(ctx.boards.keys().next().value);
  return result;
}

const confidenceText = ["aucun avis", "avis faible", "avis net", "avis tranché"];

/** The verdict in one sentence, for the screen. */
export function theorySentence(reading, names = {}) {
  const who = (side) => names[side] ?? (side === "blue" ? "le côté bleu" : "le côté rouge");
  if (reading.side === "even") return "La grille ne départage pas les deux compositions.";
  return `La grille de Kazewa préfère ${who(reading.side)} (${confidenceText[reading.confidence]}, écart ${Math.abs(reading.total)}).`;
}

// The axes a side gains or loses between two readings of the same draft.
function axisChange(before, after, side) {
  const points = (reading) => new Map(reading[side].axes.map((axis) => [axis.id, axis]));
  const was = points(before);
  const now = points(after);
  const gained = [];
  const lost = [];
  for (const [id, axis] of now) if (!was.has(id)) gained.push(axis.label);
  for (const [id, axis] of was) if (!now.has(id)) lost.push(axis.label);
  return { gained, lost };
}

/** A sentence on the holes and the axes a change fills, creates, wins or loses. */
export function changeText(filled, created, gained = [], lost = []) {
  const parts = [];
  if (filled.length) parts.push(`comble ${filled.map((hole) => hole.label).join(", ")}`);
  if (created.length) parts.push(`crée ${created.map((hole) => hole.label).join(", ")}`);
  if (gained.length) parts.push(`gagne ${gained.join(", ")}`);
  if (lost.length) parts.push(`perd ${lost.join(", ")}`);
  return parts.join(" ; ");
}

const countPicks = (team) => ROLES.filter((role) => team?.[role]).length;

/**
 * What the champion, put at `role`, changes for `side`. Null when nothing
 * changes or the board is too empty to compare (fewer than two picks on it).
 */
export function pickEffect(side, team, role, champion, ctx) {
  const base = { blue: team.blue, red: team.red };
  const withPick = { ...base, [side]: { ...team[side], [role]: champion } };
  const before = evaluateDraft(base, ctx);
  const after = evaluateDraft(withPick, ctx);
  const sign = side === "blue" ? 1 : -1;
  const delta = round(sign * (after.total - before.total));
  const had = new Set(before[side].holes.map((hole) => hole.id));
  const has = new Set(after[side].holes.map((hole) => hole.id));
  const filled = before[side].holes.filter((hole) => !has.has(hole.id));
  const created = after[side].holes.filter((hole) => !had.has(hole.id));
  return { delta, filled, created, ...axisChange(before, after, side), before, after };
}

/**
 * The procedure as a reason for the coach: what the champion, put at `role`,
 * changes for `side`. Null when the board is too empty to compare or when
 * nothing moves.
 */
export function pickReason(side, picks, role, champion, ctx, weight = 1) {
  if (!ctx || !role || countPicks(picks.blue) + countPicks(picks.red) < 2) return null;
  const effect = pickEffect(side, picks, role, champion, ctx);
  const points = round(effect.delta * weight);
  const change = changeText(effect.filled, effect.created, effect.gained, effect.lost);
  if (!points && !change) return null;
  const who = side === "blue" ? "le bleu" : "le rouge";
  const where = role === "bot" ? "en ADC" : `en ${role}`;
  // The total also moves with the axes and bonuses of the other side, which
  // the grid compares: a change with no hole to name says so, and does not
  // pretend nothing moved.
  const text = change
    ? `Dans sa grille de décision, ${champion} ${where} pour ${who} : ${change}.`
    : `Dans sa grille de décision, ${champion} ${where} pour ${who} fait bouger le total de ${points > 0 ? "+" : ""}${points} (axes, bonus ou timing).`;
  return { points, kind: "theory", coach: "kazewa", text, rule: null };
}

/**
 * Points a champion would add to the other side's reading if it were theirs,
 * at the role it would play. `enemy` is the side that receives the champion.
 */
export function banEffect(enemy, team, role, champion, ctx) {
  const base = { blue: team.blue, red: team.red };
  const withBan = { ...base, [enemy]: { ...team[enemy], [role]: champion } };
  const before = evaluateDraft(base, ctx);
  const after = evaluateDraft(withBan, ctx);
  const sign = enemy === "blue" ? 1 : -1;
  const had = new Set(before[enemy].holes.map((hole) => hole.id));
  const has = new Set(after[enemy].holes.map((hole) => hole.id));
  return {
    gain: round(sign * (after.total - before.total)),
    filled: before[enemy].holes.filter((hole) => !has.has(hole.id)),
    created: after[enemy].holes.filter((hole) => !had.has(hole.id)),
    ...axisChange(before, after, enemy),
    after,
  };
}

/** The same for a ban: what the champion would bring to the other side, at the role it would play. */
export function banReason(enemy, picks, roles, champion, ctx, weight = 1) {
  if (!ctx || countPicks(picks[enemy]) < 1) return null;
  let best = null;
  for (const role of roles ?? []) {
    if (picks[enemy][role]) continue;
    const effect = banEffect(enemy, picks, role, champion, ctx);
    if (!best || Math.abs(effect.gain) > Math.abs(best.gain)) best = { ...effect, role };
  }
  if (!best || (!best.gain && !best.filled.length && !best.created.length)) return null;
  const who = enemy === "blue" ? "le bleu" : "le rouge";
  const change = changeText(best.filled, best.created, best.gained, best.lost);
  const text = change
    ? `Dans sa grille de décision, ${champion} en ${best.role} pour ${who} : ${change}.`
    : `Dans sa grille de décision, ${champion} en ${best.role} pour ${who} fait bouger le total de ${best.gain > 0 ? "+" : ""}${best.gain} (axes, bonus ou timing).`;
  return { points: round(best.gain * weight), kind: "theory", coach: "kazewa", text, rule: null };
}
