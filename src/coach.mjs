/**
 * What to ban or pick next, and why.
 *
 * A suggestion is ranked on what the two coaches said, and on the procedure
 * they teach. Each point of the score comes with its sentence and, where there
 * is one, its video:
 *   - what Kazewa said about this champion with the champions already locked:
 *     the matchups, answers and synergies he named in the drafts he judged,
 *     and the relations written on his champion cards;
 *   - what he said of the champion's strength in the last months;
 *   - his decision rubric (src/theory.mjs): what the champion changes for its
 *     side, in holes filled or created and axes won or lost;
 *   - the draft method of Shanei (src/method.mjs): the order of roles, the
 *     first pick, blind picks and flex picks, the family of the composition
 *     and the pieces it still lacks, the duos he names, the answers to what the
 *     opponent shows, and bans that protect the plan.
 *
 * No professional statistic decides anything here. The roles a champion can
 * take come from the lane table (src/lanes.mjs). The professional figures of
 * data/coach.json are kept for the measure of the coach (research/coach-eval.mjs)
 * and the notes are read for their dates and their text only.
 *
 * It also lists who can still answer a pick: the counters he named that are
 * neither banned nor picked, in a role the opponent has yet to fill. That is
 * a warning, not a penalty.
 */
import { ROLES } from "./engine.mjs";
import { LANES } from "./lanes.mjs";
import { banNotes, METHOD_WEIGHTS, pickNotes } from "./method.mjs";
import { banReason, pickReason } from "./theory.mjs";

const SIDES = ["blue", "red"];
const other = (side) => (side === "blue" ? "red" : "blue");
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const round = (value) => Math.round(value * 100) / 100 || 0;
const sum = (values) => values.reduce((total, value) => total + value, 0);

// Same rule as the measured reading (src/memory.mjs): a claim about allies
// carries over when it is about the pair, a claim about opponents when it is
// about how they meet.
const ALLY_TAGS = new Set(["synergy"]);
const FACING_TAGS = new Set([
  "lane",
  "jungle",
  "answer",
  "range",
  "identity_matchup",
  "engage",
  "disengage_peel",
  "damage",
]);

export const WEIGHTS = Object.freeze({
  // One statement of his for or against, on a champion already locked; more
  // when it is the opponent of the same lane.
  said: 1,
  saidLane: 1.5,
  // A lane he calls lost weighs more than a lane he calls won.
  saidLaneLost: 2.5,
  saidCap: 3,
  // One relation from his champion cards, when he said nothing more precise.
  card: 0.5,
  cardLane: 0.75,
  cardCap: 1.5,
  // What he said of the champion itself in the last months: strong or weak.
  opinion: 1,
  // A ban of the champion the banning side would take itself right after.
  own: 4,
  // A counter he named that the opponent can still take: shown as a warning,
  // with no points. Switched off on purpose: his named counters are used only
  // as the warning of the sentence, not to rank.
  answer: 0,
  // The procedure of the two coaches (src/theory.mjs), in its own points.
  theory: 1,
  // The draft method of Shanei (src/method.mjs): see METHOD_WEIGHTS there.
  method: METHOD_WEIGHTS,
});

/* ------------------------------------------------------------------ */
/* What he said about two champions together                           */
/* ------------------------------------------------------------------ */

/**
 * `memory` is the memory as the site loads it; `relations` comes from
 * cardRelations(champion cards).
 */
export function coachTables(memory, relations = null) {
  const allies = new Map();
  const beats = new Map();
  const beatenBy = new Map();
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const item of memory?.cases ?? []) {
    const where = new Map();
    for (const side of SIDES)
      for (const role of ROLES) where.set(item[side][role], { side, role });
    const sources = (item.sources ?? []).map((source) => ({
      video: source.video,
      title: source.title ?? null,
      ts: source.ts ?? null,
    }));
    // One video saying the same thing about several games says it once.
    const said = sources.map((source) => source.video).sort().join("+") || item.id;
    for (const claim of item.claims ?? []) {
      if (!claim.transferable || claim.champions?.length !== 2) continue;
      const [a, b] = claim.champions;
      const at = where.get(a);
      const bt = where.get(b);
      if (!at || !bt || a === b) continue;
      const detail = claim.detailFr || claim.detail;
      if (at.side === bt.side) {
        if (!ALLY_TAGS.has(claim.tag)) continue;
        // In favour of the pair's side: a synergy. Against it: an anti-synergy
        // ("Lulu + Sivir est une anti-synergie"), unless the sentence credits
        // the pair and blames the rest ("sa seule synergie est…").
        const good = claim.favours === at.side;
        if (!good && /\bseule? (synergie|utilité)\b/i.test(detail)) continue;
        push(allies, pairKey(a, b), {
          good,
          roles: { [a]: at.role, [b]: bt.role },
          detail,
          sources,
          said,
        });
        continue;
      }
      if (!FACING_TAGS.has(claim.tag)) continue;
      // A lane argument is about two opponents in the same lane.
      if ((claim.tag === "lane" || claim.tag === "jungle") && at.role !== bt.role) continue;
      const winner = claim.favours === at.side ? a : b;
      const loser = winner === a ? b : a;
      const entry = {
        winner,
        loser,
        tag: claim.tag,
        roles: { [a]: at.role, [b]: bt.role },
        detail,
        sources,
        said,
      };
      push(beats, `${winner}>${loser}`, entry);
      push(beatenBy, loser, entry);
    }
  }
  return { allies, beats, beatenBy, relations };
}

/* ------------------------------------------------------------------ */
/* Roles, from the lane table                                          */
/* ------------------------------------------------------------------ */

/**
 * The roles a champion can be given, from the lane table. `meta` is not read:
 * what teams play decides nothing here. Kept in the signature for the callers.
 */
export function playableRoles(meta, champion) {
  const listed = LANES[champion] ?? [];
  return listed.length ? [...listed] : [ROLES[0]];
}

/* ------------------------------------------------------------------ */
/* Sentences                                                           */
/* ------------------------------------------------------------------ */

const ROLE_FR = { top: "top", jng: "jungle", mid: "mid", bot: "ADC", sup: "support" };
// "d’Orianna", but "de Yasuo" and "de Hwei".
const vowel = (name) => /^[aeiouàâéèêëîïôöûü]/i.test(name);
const de = (name) => (vowel(name) ? `d’${name}` : `de ${name}`);
const monthYear = (text) => {
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
};
const DAY = 86400000;
// His opinion of a champion's strength holds for a meta: about six months.
const RECENT_DAYS = 183;

const locked = (picks, side) =>
  ROLES.filter((role) => picks[side][role]).map((role) => ({
    role,
    champion: picks[side][role],
  }));

function unavailable(picks, bans) {
  const names = new Set([...(bans?.blue ?? []), ...(bans?.red ?? [])]);
  for (const side of SIDES)
    for (const role of ROLES) if (picks[side][role]) names.add(picks[side][role]);
  return names;
}

/** The date of his newest dated remark, over all the champions: the reference of "recent". */
export function latestNoteDate(notes) {
  let latest = null;
  for (const list of Object.values(notes ?? {}))
    for (const note of list ?? []) if (note.date && (!latest || note.date > latest)) latest = note.date;
  return latest;
}

/**
 * His latest word on the champion's strength, when it is recent enough, that
 * is within six months of `asOf` (the date of his newest remark, which comes
 * from his own notes and not from the professional data). A remark that names
 * a role ("Shen support never works") holds for that role.
 */
export function recentOpinion(notes, asOf, role = null) {
  const end = Date.parse(asOf ?? "");
  if (!Number.isFinite(end)) return null;
  for (const note of notes ?? []) {
    if (note.tag !== "meta_strong" && note.tag !== "meta_weak") continue;
    if (role && note.role && note.role !== role) continue;
    const at = Date.parse(note.date ?? "");
    if (Number.isFinite(at) && end - at <= RECENT_DAYS * DAY && at <= end + DAY) return note;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* One candidate                                                       */
/* ------------------------------------------------------------------ */

/**
 * One champion in one role: its points and the sentence behind each of them.
 * `slot` is the number of the pick in the draft, 1 to 10 (null in a ban
 * list). `mine`: the side that picks is the reader's side. `notes` are his
 * dated remarks on this champion (data/coach.json), `asOf` the date of his
 * newest remark. `method` is indexMethod() of src/method.mjs and `plan` the
 * family the reader said they are going for.
 */
export function scorePick({
  champion,
  role,
  side,
  picks,
  bans,
  slot,
  tables,
  profiles = null,
  notes = null,
  asOf = null,
  mine = true,
  method = null,
  plan = null,
  weights = WEIGHTS,
}) {
  const foe = other(side);
  const foeOpen = ROLES.filter((lane) => !picks[foe][lane]);
  const reasons = [];
  const add = (points, kind, text, extra = {}) => {
    if (!points && kind !== "note") return;
    reasons.push({ points: round(points), kind, text, ...extra });
  };

  // 1. What he said of the champion itself, lately.
  const opinion = recentOpinion(notes, asOf, role);
  if (opinion && weights.opinion) {
    const strong = opinion.tag === "meta_strong";
    add(
      strong ? weights.opinion : -weights.opinion,
      "opinion",
      `Il le jugeait ${strong ? "fort" : "faible"} en ${monthYear(opinion.date)}${opinion.patch ? ` (patch ${opinion.patch})` : ""}.`,
      { detail: opinion.text, sources: [{ video: opinion.video, ts: opinion.ts ?? null, title: null }] },
    );
  }

  // 2. What he said, on the champions already locked. A cap limits how much
  //    statements of the same direction can pile up; a contrary one always counts.
  const counted = new Set();
  const capped = (total, cap) => (points) => {
    if (!total.value || Math.sign(points) !== Math.sign(total.value)) return points;
    const room = cap - Math.abs(total.value);
    return room <= 0 ? 0 : Math.sign(points) * Math.min(Math.abs(points), room);
  };
  const saidTotal = { value: 0 };
  const sayLimit = capped(saidTotal, weights.saidCap);
  const say = (points, text, entry, with_) => {
    counted.add(with_);
    const given = sayLimit(points);
    if (!given) return;
    saidTotal.value += given;
    add(given, "said", text, { detail: entry.detail, sources: entry.sources, with: with_ });
  };
  const voices = (entries) => new Set(entries.map((entry) => entry.said)).size;
  for (const ally of locked(picks, side)) {
    const about = (tables.allies.get(pairKey(champion, ally.champion)) ?? []).filter(
      (entry) => entry.roles[champion] === role && entry.roles[ally.champion] === ally.role,
    );
    if (!about.length) continue;
    const good = about.filter((entry) => entry.good);
    const bad = about.filter((entry) => !entry.good);
    if (voices(good) > voices(bad))
      say(weights.said, `Va bien avec ${ally.champion} d’après lui.`, good[0], ally.champion);
    else if (voices(bad) > voices(good))
      say(-weights.said, `Va mal avec ${ally.champion} d’après lui.`, bad[0], ally.champion);
    else {
      counted.add(ally.champion);
      add(0, "note", `Avec ${ally.champion}, il a jugé ce duo dans les deux sens selon la draft.`, { coach: "kazewa" });
    }
  }
  for (const enemy of locked(picks, foe)) {
    const fits = (entry) =>
      entry.roles[champion] === role && entry.roles[enemy.champion] === enemy.role;
    const wins = (tables.beats.get(`${champion}>${enemy.champion}`) ?? []).filter(fits);
    const loses = (tables.beats.get(`${enemy.champion}>${champion}`) ?? []).filter(fits);
    if (!wins.length && !loses.length) continue;
    const facing = enemy.role === role;
    const lane = !facing ? "" : role === "jng" ? " en jungle" : " en lane";
    if (voices(wins) > voices(loses))
      say(facing ? weights.saidLane : weights.said, `Prend le dessus${lane} sur ${enemy.champion} d’après lui.`, wins[0], enemy.champion);
    else if (voices(loses) > voices(wins))
      say(-(facing ? weights.saidLaneLost : weights.said), `${enemy.champion} prend le dessus${lane} sur lui, d’après Kazewa.`, loses[0], enemy.champion);
    else {
      // He said it both ways, in different drafts: no point either way.
      counted.add(enemy.champion);
      add(0, "note", `Contre ${enemy.champion}, il a jugé le matchup dans les deux sens selon la draft.`, { coach: "kazewa" });
    }
  }

  // 3. His champion cards, where he said nothing more precise.
  const relations = tables.relations;
  if (relations) {
    const cardTotal = { value: 0 };
    const cardLimit = capped(cardTotal, weights.cardCap);
    const card = (points, text, with_) => {
      if (counted.has(with_)) return;
      counted.add(with_);
      const given = cardLimit(points);
      if (!given) return;
      cardTotal.value += given;
      add(given, "card", text, { with: with_ });
    };
    // A card describes a champion in the role it is known for: nothing is
    // read from it when either champion sits somewhere else.
    const usual = (name, lane) => (LANES[name] ?? [])[0] === lane;
    const here = usual(champion, role);
    for (const ally of locked(picks, side)) {
      if (!here || !usual(ally.champion, ally.role)) continue;
      const name = ally.champion;
      const good = relations.goodWith.get(champion)?.has(name) || relations.goodWith.get(name)?.has(champion);
      const bad = relations.badWith.get(champion)?.has(name) || relations.badWith.get(name)?.has(champion);
      if (good && !bad) card(weights.card, `Sa fiche le donne comme bon partenaire ${de(name)}.`, name);
      else if (bad && !good) card(-weights.card, `Sa fiche le donne comme mauvais partenaire ${de(name)}.`, name);
    }
    for (const enemy of locked(picks, foe)) {
      if (!here || !usual(enemy.champion, enemy.role)) continue;
      const name = enemy.champion;
      const wins =
        relations.goodAgainst.get(champion)?.has(name) || relations.badAgainst.get(name)?.has(champion);
      const loses =
        relations.badAgainst.get(champion)?.has(name) || relations.goodAgainst.get(name)?.has(champion);
      const weight = enemy.role === role ? weights.cardLane : weights.card;
      if (wins && !loses) card(weight, `Sa fiche le donne fort contre ${name}.`, name);
      else if (loses && !wins) card(-weight, `Sa fiche le donne puni par ${name}.`, name);
    }
  }

  // 4. The draft method of Shanei. Each line names its coach and its rule.
  const process =
    method && slot
      ? pickNotes({ champion, role, side, picks, slot, taken: unavailable(picks, bans), plan, index: method, profiles, mine, weights: weights.method ?? METHOD_WEIGHTS })
      : [];
  for (const note of process) reasons.push(note);

  // 5. Who can still answer it: his named counters, still free, in a role the
  //    opponent has yet to fill. A warning, shown with no points.
  const taken = unavailable(picks, bans);
  taken.add(champion);
  const named = new Set();
  for (const entry of tables.beatenBy.get(champion) ?? []) {
    if (entry.roles[champion] !== role || taken.has(entry.winner)) continue;
    const lane = entry.roles[entry.winner];
    if (foeOpen.includes(lane) && playableRoles(null, entry.winner).includes(lane)) named.add(entry.winner);
  }
  const fromCards = new Set();
  for (const name of relations?.badAgainst.get(champion) ?? []) {
    if (taken.has(name) || named.has(name)) continue;
    const lanes = playableRoles(null, name).filter((lane) => foeOpen.includes(lane));
    if (lanes.length) fromCards.add(name);
  }
  if (named.size + fromCards.size) {
    const byName = (a, b) => a.localeCompare(b, "fr");
    const names = [...[...named].sort(byName), ...[...fromCards].sort(byName)];
    reasons.push({
      points: round(-weights.answer * Math.min(3, names.length)),
      kind: "answer",
      text: `Peut encore se faire répondre par ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}, d’après lui.`,
      answers: names,
    });
  } else if (slot && !foeOpen.length) add(0, "note", "Dernier pick : personne ne peut plus lui répondre.");

  const score = round(sum(reasons.map((reason) => reason.points)));
  return { champion, role, score, reasons };
}

const byScore = (a, b) =>
  b.score - a.score || a.champion.localeCompare(b.champion, "fr");

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

// Adds the reason of the procedure to a candidate row, and recomputes its score.
function withTheory(row, { theory, side, picks, weights }) {
  if (!theory || !row.role || !weights.theory) return row;
  const reason = pickReason(side, { blue: picks.blue, red: picks.red }, row.role, row.champion, theory, weights.theory);
  if (!reason) return row;
  const reasons = [...row.reasons, reason];
  return { ...row, reasons, score: round(sum(reasons.map((item) => item.points))) };
}

/**
 * Every available champion with its role, best first. `side` is the side
 * that picks; `slot` the number of the pick, 1 to 10. A champion goes to the
 * role of its lane table that scores best: the procedure and the method rank
 * it, the professional figures do not. `noteOf` gives his dated remarks on a
 * champion, `asOf` the date of his newest remark.
 */
export function rankPicks({
  side,
  picks,
  bans,
  slot,
  tables,
  champions,
  profiles = null,
  noteOf = null,
  asOf = null,
  mine = true,
  method = null,
  plan = null,
  theory = null,
  weights = WEIGHTS,
}) {
  const taken = unavailable(picks, bans);
  const open = ROLES.filter((role) => !picks[side][role]);
  const rows = [];
  for (const champion of champions) {
    if (taken.has(champion)) continue;
    const roles = playableRoles(null, champion).filter((role) => open.includes(role));
    if (!roles.length) {
      rows.push({ champion, role: null, playable: false, score: null, flex: false, reasons: [], roles: [] });
      continue;
    }
    const scored = roles
      .map((role) =>
        withTheory(
          scorePick({ champion, role, side, picks, bans, slot, tables, profiles, notes: noteOf?.(champion), asOf, mine, method, plan, weights }),
          { theory, side, picks, weights },
        ),
      )
      .sort((a, b) => b.score - a.score || roles.indexOf(a.role) - roles.indexOf(b.role));
    rows.push({
      ...scored[0],
      playable: true,
      flex: roles.length > 1,
      roles,
    });
  }
  return rows.sort((a, b) => Number(b.playable) - Number(a.playable) || byScore(a, b));
}

/**
 * What to take away from the opponent, best first. `side` is the side that
 * bans. A ban is worth what the champion would do to the picks already
 * locked, and what Kazewa said of it. `mine`: the side that bans is the
 * reader's side. `ownPicks`: the champions the banning side would take itself
 * at its next pick, when it picks first after these bans.
 */
export function rankBans({
  side,
  picks,
  bans,
  tables,
  champions,
  noteOf = null,
  asOf = null,
  ownPicks = null,
  mine = true,
  method = null,
  plan = null,
  profiles = null,
  theory = null,
  weights = WEIGHTS,
}) {
  const foe = other(side);
  const taken = unavailable(picks, bans);
  const foeOpen = ROLES.filter((role) => !picks[foe][role]);
  const rows = [];
  for (const champion of champions) {
    if (taken.has(champion)) continue;
    const roles = playableRoles(null, champion).filter((role) => foeOpen.includes(role));
    if (!roles.length) {
      rows.push({ champion, role: null, playable: false, score: null, flex: false, reasons: [] });
      continue;
    }
    // The champion as the opponent would take it.
    const asTheirs = roles
      .map((role) =>
        scorePick({ champion, role, side: foe, picks, bans, slot: null, tables, notes: noteOf?.(champion), asOf, weights }),
      )
      .sort((a, b) => b.score - a.score)[0];
    const reasons = asTheirs.reasons
      .filter((reason) => ["said", "card", "opinion"].includes(reason.kind))
      .map((reason) => ({
        ...reason,
        text: reason.kind === "opinion" ? reason.text : banText(reason, champion, mine),
      }));
    // The procedure: what the champion would bring to the other side.
    if (theory) {
      const reason = banReason(foe, picks, roles, champion, theory, weights.theory);
      if (reason) reasons.push(reason);
    }
    // The method: a ban that protects the composition, never one's own piece.
    if (method)
      for (const note of banNotes({ champion, side, picks, plan, index: method, profiles, mine, roles: playableRoles(null, champion), weights: weights.method ?? METHOD_WEIGHTS }))
        reasons.push(note);
    if (ownPicks?.has(champion))
      reasons.push({
        points: -weights.own,
        kind: "own",
        text: mine
          ? "Tu prends juste après ces bans et c’est ton meilleur pick : le bannir te le retire."
          : "Ils prennent juste après ces bans et c’est leur meilleur pick : ils ont peu d’intérêt à le bannir.",
      });
    rows.push({
      champion,
      role: null,
      playable: true,
      flex: false,
      score: round(sum(reasons.map((reason) => reason.points))),
      reasons,
    });
  }
  return rows.sort((a, b) => Number(b.playable) - Number(a.playable) || byScore(a, b));
}

// The same facts, said to the reader: the champion would go to the side
// that does not ban. `mine`: the reader's side is the one that bans.
function banText(reason, champion, mine) {
  const name = reason.with;
  const source = reason.kind === "said" ? "d’après lui" : "d’après sa fiche";
  const theirs = mine ? "leur" : "ton";
  const yours = mine ? "ton" : "leur";
  if (/Va bien avec|bon partenaire/.test(reason.text))
    return `${champion} va bien avec ${theirs} ${name} ${source}.`;
  if (/Va mal avec|mauvais partenaire/.test(reason.text))
    return `Moins urgent : ${champion} va mal avec ${theirs} ${name} ${source}.`;
  if (/Prend le dessus|fort contre/.test(reason.text))
    return `${champion} prend le dessus sur ${yours} ${name} ${source}.`;
  return `Moins urgent : ${yours} ${name} prend le dessus sur ${champion} ${source}.`;
}
