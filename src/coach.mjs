/**
 * What to ban or pick next, and why.
 *
 * A suggestion is ranked on things a player can check:
 *   - what Kazewa said about this champion with the champions already locked:
 *     the matchups, answers and synergies he named in the drafts he judged,
 *     and the relations written on his champion cards;
 *   - what he said of the champion itself in the last months: strong or weak
 *     in the meta of the day;
 *   - how much professional teams pick or ban it right now, in that role;
 *   - whether professionals lock that role, and that champion, at this point
 *     of a draft;
 *   - his first rule of composition: a draft needs a frontline;
 *   - the draft method of the two coaches (src/method.mjs): the order of
 *     roles, the first pick, blind picks and flex picks, the family of the
 *     composition and the pieces it still lacks, the duos Shanei names, the
 *     answers to what the opponent shows, and bans that protect the plan.
 *
 * It also lists who can still answer a pick: the counters he named that are
 * neither banned nor picked, in a role the opponent has yet to fill. That is
 * a warning, not a penalty.
 *
 * Every point of the score comes with its sentence. Nothing here predicts who
 * wins: the structural calculator is not part of the ranking.
 */
import { ROLES } from "./engine.mjs";
import { LANES } from "./lanes.mjs";
import { banNotes, METHOD_WEIGHTS, pickNotes } from "./method.mjs";

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
  // Share of recent professional games where the champion is picked or banned.
  presence: 6,
  // How usual the role is at this pick, against one role in five.
  timing: 1,
  // How usual this champion is at this stage of the draft (log2 of the lift).
  stage: 0.5,
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
  // A frontline when three picks are locked without one.
  frontline: 1,
  // In a ban list, how much the ban rate counts against the pick rate.
  banMix: 0.5,
  // A ban of the champion the banning side would take itself right after.
  own: 4,
  // A counter he named that the opponent can still take: a warning only. On
  // real professional drafts, counting it against the champion made the list
  // worse (research/coach-eval.mjs).
  answer: 0,
  // The draft method of the two coaches: see METHOD_WEIGHTS in src/method.mjs.
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
/* Professional play                                                   */
/* ------------------------------------------------------------------ */

const proPicks = (meta, champion) => sum(Object.values(meta?.picks?.[champion] ?? {}));

/** Share of recent professional games where the champion is picked or banned. */
export function presence(meta, champion) {
  if (!meta?.games) return 0;
  return (proPicks(meta, champion) + (meta.bans?.[champion] ?? 0)) / meta.games;
}

/** Among the games where it is picked, the share played in this role. */
export function roleShare(meta, champion, role) {
  const total = proPicks(meta, champion);
  if (!total) return (LANES[champion] ?? [])[0] === role ? 1 : 0;
  return (meta.picks[champion][role] ?? 0) / total;
}

/**
 * The roles a champion can be given, most played first: the lane table, plus
 * the roles professionals really play it in, minus a listed lane they never
 * use when there is enough professional play to tell.
 */
export function playableRoles(meta, champion) {
  const listed = LANES[champion] ?? [];
  const total = proPicks(meta, champion);
  if (!total) return [...listed];
  const byRole = meta.picks[champion];
  const roles = new Set();
  for (const role of ROLES) {
    const games = byRole[role] ?? 0;
    if (games >= 5 && games / total >= 0.1) roles.add(role);
  }
  for (const role of listed) {
    const games = byRole[role] ?? 0;
    if (total < 10 || games >= 3 || games / total >= 0.05) roles.add(role);
  }
  if (!roles.size) roles.add(listed[0] ?? ROLES[0]);
  return [...roles].sort(
    (a, b) => (byRole[b] ?? 0) - (byRole[a] ?? 0) || listed.indexOf(a) - listed.indexOf(b),
  );
}

/** How often professionals lock this role at this pick (1 to 10). */
export function timingShare(meta, slot, role) {
  const row = meta?.slots?.[slot - 1];
  const total = row ? sum(ROLES.map((r) => row[r] ?? 0)) : 0;
  return total ? (row[role] ?? 0) / total : 0.2;
}

const STAGE_BASE = [0.3, 0.3, 0.4];
const STAGE_FR = ["en début de draft", "en milieu de draft", "en fin de draft"];
export const stageOf = (slot) => (slot <= 3 ? 0 : slot <= 6 ? 1 : 2);
/**
 * How much more (or less) often than an average champion this one is locked
 * at this stage: picks 1-3, 4-6 or 7-10. Pulled towards 1 when it is rare.
 */
export function stageLift(meta, champion, slot) {
  const counts = meta?.stages?.[champion];
  if (!counts) return { lift: 1, share: null, total: 0 };
  const stage = stageOf(slot);
  const total = counts[0] + counts[1] + counts[2];
  const base = STAGE_BASE[stage];
  return {
    lift: (counts[stage] + 6 * base) / (total + 6) / base,
    share: total ? counts[stage] / total : null,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* Sentences                                                           */
/* ------------------------------------------------------------------ */

const percent = (value) => `${Math.round(value * 100)} %`;
const ROLE_FR = { top: "top", jng: "jungle", mid: "mid", bot: "ADC", sup: "support" };
// "le top", "l’ADC".
const theRole = (role) => (role === "bot" ? "l’ADC" : `le ${ROLE_FR[role]}`);
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

/**
 * His latest word on the champion's strength, when it is recent enough. A
 * remark that names a role ("Shen support never works") holds for that role.
 */
export function recentOpinion(notes, meta, role = null) {
  const end = Date.parse(meta?.to ?? "");
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
 * dated remarks on this champion (data/coach.json). `method` is
 * indexMethod() of src/method.mjs and `plan` the family the reader said they
 * are going for: with them the draft method of the two coaches is counted.
 */
export function scorePick({
  champion,
  role,
  side,
  picks,
  bans,
  slot,
  tables,
  meta,
  profiles = null,
  notes = null,
  mine = true,
  method = null,
  plan = null,
  weights = WEIGHTS,
}) {
  const foe = other(side);
  const myOpen = ROLES.filter((lane) => !picks[side][lane]);
  const foeOpen = ROLES.filter((lane) => !picks[foe][lane]);
  const reasons = [];
  const add = (points, kind, text, extra = {}) => {
    if (!points && kind !== "note") return;
    reasons.push({ points: round(points), kind, text, ...extra });
  };

  // 1. Professional play.
  const seen = presence(meta, champion);
  const share = roleShare(meta, champion, role);
  if (meta?.games)
    add(
      weights.presence * seen * share,
      "meta",
      seen
        ? `Pris ou banni dans ${percent(seen)} des parties pro récentes${share < 0.95 ? `, joué ${ROLE_FR[role]} dans ${percent(share)} de ses parties` : ""}.`
        : "Absent des parties pro récentes.",
    );

  // 2. The moment of the draft. It says nothing when one role is left, and
  //    a role is not "answered" when its opponent is already locked.
  if (slot && meta?.slots && myOpen.length > 1) {
    const usual = timingShare(meta, slot, role);
    const points = weights.timing * (usual - 0.2) * 5;
    const exposed = foeOpen.includes(role);
    if (points >= 0 || exposed)
      add(
        points,
        "timing",
        usual >= 0.3
          ? `Les équipes pro prennent souvent ${theRole(role)} à ce moment de la draft (${percent(usual)} des cas).`
          : usual <= 0.12
            ? `Les équipes pro prennent rarement ${theRole(role)} à ce moment de la draft (${percent(usual)} des cas) : il peut se faire répondre.`
            : `Les équipes pro prennent parfois ${theRole(role)} à ce moment de la draft (${percent(usual)} des cas).`,
      );
  }

  // 2b. The stage of the draft where this champion is usually locked.
  if (slot && meta?.stages) {
    const { lift, share: at, total } = stageLift(meta, champion, slot);
    const points = weights.stage * Math.max(-1.5, Math.min(1.5, Math.log2(lift)));
    if (total >= 15 && Math.abs(points) >= 0.25)
      add(
        points,
        "stage",
        points > 0
          ? `Un pick que les équipes pro prennent volontiers ${STAGE_FR[stageOf(slot)]} (${percent(at)} de ses picks).`
          : `Les équipes pro le prennent rarement ${STAGE_FR[stageOf(slot)]} (${percent(at)} de ses picks).`,
      );
  }

  // 2c. What he said of the champion itself, lately.
  const opinion = recentOpinion(notes, meta, role);
  if (opinion && weights.opinion) {
    const strong = opinion.tag === "meta_strong";
    add(
      strong ? weights.opinion : -weights.opinion,
      "opinion",
      `Il le jugeait ${strong ? "fort" : "faible"} en ${monthYear(opinion.date)}${opinion.patch ? ` (patch ${opinion.patch})` : ""}.`,
      { detail: opinion.text, sources: [{ video: opinion.video, ts: opinion.ts ?? null, title: null }] },
    );
  }

  // 3. What he said, on the champions already locked. A cap limits how much
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

  // 4. His champion cards, where he said nothing more precise.
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
    const usual = (name, lane) =>
      proPicks(meta, name) ? roleShare(meta, name, lane) >= 0.5 : (LANES[name] ?? [])[0] === lane;
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

  // 4a. The draft method of the two coaches. Each line names its coach and
  //     carries the id of its rule.
  const process =
    method && slot
      ? pickNotes({ champion, role, side, picks, slot, taken: unavailable(picks, bans), plan, index: method, profiles, mine, weights: weights.method ?? METHOD_WEIGHTS })
      : [];
  for (const note of process) reasons.push(note);
  // Shanei's tank of the block of four, when the champion brings it, says the
  // same thing as Kazewa's frontline: it is counted once.
  const tankSaid = process.some((note) => note.tank && note.points > 0);

  // 4b. His first rule of composition: a draft needs a frontline.
  if (profiles && weights.frontline && !tankSaid) {
    const team = locked(picks, side);
    const front = (name) => profiles[name]?.frontline ?? 0;
    if (team.length >= 3 && !team.some((ally) => front(ally.champion) >= 1) && front(champion) >= 1)
      add(
        weights.frontline * Math.min(2, front(champion)),
        "need",
        mine
          ? "Ta composition n’a pas encore de frontline : il en apporte une."
          : "Leur composition n’a pas encore de frontline : il en apporterait une.",
      );
  }

  // 5. Who can still answer it: his named counters, still free, in a role the
  //    opponent has yet to fill and where that counter is really played.
  const taken = unavailable(picks, bans);
  taken.add(champion);
  const named = new Set();
  for (const entry of tables.beatenBy.get(champion) ?? []) {
    if (entry.roles[champion] !== role || taken.has(entry.winner)) continue;
    const lane = entry.roles[entry.winner];
    if (foeOpen.includes(lane) && playableRoles(meta, entry.winner).includes(lane)) named.add(entry.winner);
  }
  const fromCards = new Set();
  for (const name of relations?.badAgainst.get(champion) ?? []) {
    if (taken.has(name) || named.has(name)) continue;
    const lanes = playableRoles(meta, name).filter((lane) => foeOpen.includes(lane));
    if (lanes.some((lane) => !proPicks(meta, name) || roleShare(meta, name, lane) >= 0.1)) fromCards.add(name);
  }
  if (named.size + fromCards.size) {
    const byPresence = (a, b) => presence(meta, b) - presence(meta, a) || a.localeCompare(b, "fr");
    const names = [...[...named].sort(byPresence), ...[...fromCards].sort(byPresence)];
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
const timingOf = (row) => row.reasons.find((reason) => reason.kind === "timing")?.points ?? 0;

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every available champion with its role, best first. `side` is the side
 * that picks; `slot` the number of the pick, 1 to 10. A champion goes to the
 * role it is played in: the moment of the draft ranks it, it does not choose
 * its role. `noteOf` gives his dated remarks on a champion.
 */
export function rankPicks({
  side,
  picks,
  bans,
  slot,
  tables,
  meta,
  champions,
  profiles = null,
  noteOf = null,
  mine = true,
  method = null,
  plan = null,
  weights = WEIGHTS,
}) {
  const taken = unavailable(picks, bans);
  const open = ROLES.filter((role) => !picks[side][role]);
  const rows = [];
  for (const champion of champions) {
    if (taken.has(champion)) continue;
    const roles = playableRoles(meta, champion).filter((role) => open.includes(role));
    if (!roles.length) {
      rows.push({ champion, role: null, playable: false, score: null, flex: false, reasons: [], roles: [] });
      continue;
    }
    // A role it is rarely played in is only used when nothing else is open.
    const real = proPicks(meta, champion)
      ? roles.filter((role) => roleShare(meta, champion, role) >= 0.2)
      : roles;
    const candidates = real.length ? real : roles;
    const scored = candidates
      .map((role) =>
        scorePick({ champion, role, side, picks, bans, slot, tables, meta, profiles, notes: noteOf?.(champion), mine, method, plan, weights }),
      )
      .sort(
        (a, b) =>
          b.score - timingOf(b) - (a.score - timingOf(a)) ||
          candidates.indexOf(a.role) - candidates.indexOf(b.role),
      );
    rows.push({
      ...scored[0],
      playable: true,
      flex: candidates.length > 1,
      roles,
      // Enough professional play to know it, and none of it in a role still open.
      rare:
        proPicks(meta, champion) >= 10 &&
        !roles.some((role) => roleShare(meta, champion, role) >= 0.1),
    });
  }
  return rows.sort((a, b) => Number(b.playable) - Number(a.playable) || byScore(a, b));
}

/**
 * What to take away from the opponent, best first. `side` is the side that
 * bans. Before the first pick it is the professional ban list; afterwards a
 * ban is worth what the champion would do to the picks already locked.
 * `mine`: the side that bans is the reader's side. `ownPicks`: the champions
 * the banning side would take itself at its next pick, when it picks first
 * after these bans.
 */
export function rankBans({
  side,
  picks,
  bans,
  tables,
  meta,
  champions,
  noteOf = null,
  ownPicks = null,
  mine = true,
  method = null,
  plan = null,
  profiles = null,
  weights = WEIGHTS,
}) {
  const foe = other(side);
  const taken = unavailable(picks, bans);
  const foeOpen = ROLES.filter((role) => !picks[foe][role]);
  const rows = [];
  for (const champion of champions) {
    if (taken.has(champion)) continue;
    const roles = playableRoles(meta, champion).filter((role) => foeOpen.includes(role));
    const known = proPicks(meta, champion);
    // The part of its professional play the opponent can still use.
    const usable = known ? Math.min(1, sum(roles.map((role) => roleShare(meta, champion, role)))) : 1;
    if (!roles.length || (known >= 10 && usable < 0.1)) {
      rows.push({ champion, role: null, playable: false, score: null, flex: false, reasons: [] });
      continue;
    }
    // The champion as the opponent would take it.
    const asTheirs = roles
      .map((role) =>
        scorePick({ champion, role, side: foe, picks, bans, slot: null, tables, meta, notes: noteOf?.(champion), weights }),
      )
      .sort((a, b) => b.score - a.score)[0];
    const reasons = asTheirs.reasons
      .filter((reason) => ["said", "card", "opinion"].includes(reason.kind))
      .map((reason) => ({
        ...reason,
        points: round(reason.points * usable),
        text: reason.kind === "opinion" ? reason.text : banText(reason, champion, mine),
      }));
    if (meta?.games) {
      const banned = (meta.bans?.[champion] ?? 0) / meta.games;
      const seen = presence(meta, champion);
      reasons.unshift({
        points: round(
          weights.presence * (weights.banMix * banned + (1 - weights.banMix) * seen) * usable,
        ),
        kind: "meta",
        text: seen
          ? `Banni dans ${percent(banned)} des parties pro récentes, pris ou banni dans ${percent(seen)}.`
          : "Absent des parties pro récentes.",
      });
    }
    // The method: a ban that protects the composition, never one's own piece.
    if (method)
      for (const note of banNotes({ champion, side, picks, plan, index: method, profiles, mine, roles: playableRoles(meta, champion), weights: weights.method ?? METHOD_WEIGHTS }))
        reasons.push({ ...note, points: round(note.points > 0 ? note.points * usable : note.points) });
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
