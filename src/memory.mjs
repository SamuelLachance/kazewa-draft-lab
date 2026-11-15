/**
 * Kazewa's own verdicts on the drafts he commented.
 *
 * A draft he judged is answered with his verdict, not with a model. A draft he
 * never judged gets the closest drafts he did judge and the arguments he gave
 * about the same champions. Nothing here predicts: it only retrieves.
 */
export const ROLES = Object.freeze(["top", "jng", "mid", "bot", "sup"]);
const SIDES = ["blue", "red"];
const flip = (side) =>
  side === "blue" ? "red" : side === "red" ? "blue" : side;

const teamKey = (team) => ROLES.map((role) => team?.[role] ?? "").join("|");
const teamSetKey = (team) =>
  ROLES.map((role) => team?.[role] ?? "")
    .sort()
    .join("|");
const complete = (draft) =>
  SIDES.every((side) => ROLES.every((role) => Boolean(draft?.[side]?.[role])));

/** Same ten champions in the same roles, whatever the side order. */
export function fingerprint(draft) {
  return [teamKey(draft.blue), teamKey(draft.red)].sort().join("//");
}

/** Same two groups of five champions, whatever the roles and the side order. */
export function rosterFingerprint(draft) {
  return [teamSetKey(draft.blue), teamSetKey(draft.red)].sort().join("//");
}

export function indexMemory(memory) {
  const byFingerprint = new Map();
  const byRoster = new Map();
  for (const item of memory?.cases ?? []) {
    byFingerprint.set(item.fingerprint ?? fingerprint(item), item);
    // Two games with the same two fives but other roles: the roster key is
    // ambiguous and only the exact fingerprint may answer.
    const key = rosterFingerprint(item);
    byRoster.set(key, byRoster.has(key) ? null : item);
  }
  return { byFingerprint, byRoster, cases: memory?.cases ?? [] };
}

/**
 * Re-expresses a stored case on the sides of the draft on screen.
 * `flipped` is true when the stored blue composition is the draft's red one.
 */
function orient(item, flipped) {
  const side = (value) => (flipped ? flip(value) : value);
  return {
    id: item.id,
    flipped,
    verdict: { ...item.verdict, side: side(item.verdict.side) },
    reasons: item.reasonsFr?.length ? item.reasonsFr : item.reasons,
    label: item.labelFr || item.verdict.label,
    reads: (item.reads ?? []).map((read) => ({
      champion: read.champion,
      side: side(read.side),
      read: read.readFr || read.read,
      timing: read.timing,
    })),
    disagreements: (item.disagreements ?? []).map((d) => ({
      ...d,
      side: side(d.side),
    })),
    winner: item.winner ? side(item.winner) : null,
    winnerSource: item.winnerSource ?? null,
    teams: item.match?.teams
      ? {
          blue: item.match.teams[flipped ? "red" : "blue"] ?? null,
          red: item.match.teams[flipped ? "blue" : "red"] ?? null,
        }
      : null,
    match: item.match
      ? {
          date: item.match.date ?? null,
          league: item.match.league ?? null,
          patch: item.match.patch ?? null,
          game: item.match.game ?? null,
        }
      : null,
    // True when blue and red on screen are the real map sides of the game.
    mapSides: item.sides === "map" && !flipped,
    realSidesKnown: item.sides === "map",
    rosterVerified: Boolean(item.rosterVerified),
    sources: item.sources ?? [],
    later: item.later
      ? Object.fromEntries(
          Object.entries(item.later).map(([role, value]) => [role, side(value)]),
        )
      : null,
    blue: flipped ? item.red : item.blue,
    red: flipped ? item.blue : item.red,
  };
}

/**
 * His verdict on this draft, or null when he never judged it. The ten
 * champions decide: a flex pick filed under another role is still the draft
 * he judged (`rolesDiffer`), and the stored roles are the ones returned.
 */
export function recall(draft, index) {
  if (!index || !complete(draft)) return null;
  const exact = index.byFingerprint.get(fingerprint(draft));
  if (exact)
    return {
      ...orient(exact, teamKey(exact.blue) !== teamKey(draft.blue)),
      rolesDiffer: false,
    };
  const same = index.byRoster?.get(rosterFingerprint(draft));
  if (!same) return null;
  const found = orient(same, teamSetKey(same.blue) !== teamSetKey(draft.blue));
  // The stored pick order is per lane: it does not carry over to other roles.
  return { ...found, later: null, rolesDiffer: true };
}

/**
 * Closest judged drafts. A shared champion counts once, more when it sits in
 * the same role, and a whole lane (both opponents) counts on top.
 */
export function precedents(draft, index, { limit = 4, minimum = 4 } = {}) {
  if (!index) return [];
  const own = complete(draft) ? rosterFingerprint(draft) : null;
  const ranked = [];
  for (const item of index.cases) {
    if (item.verdict.side === "even") continue;
    if (own && rosterFingerprint(item) === own) continue;
    const tries = [false, true].map((flipped) => {
      const theirs = {
        blue: flipped ? item.red : item.blue,
        red: flipped ? item.blue : item.red,
      };
      let score = 0;
      let shared = 0;
      const lanes = [];
      for (const side of SIDES) {
        const mine = draft?.[side] ?? {};
        const other = theirs[side];
        const otherNames = new Set(ROLES.map((role) => other[role]));
        for (const role of ROLES) {
          const name = mine[role];
          if (!name) continue;
          if (other[role] === name) {
            score += 1.5;
            shared++;
          } else if (otherNames.has(name)) {
            score += 0.75;
            shared++;
          }
        }
      }
      for (const role of ROLES) {
        const b = draft?.blue?.[role];
        const r = draft?.red?.[role];
        if (b && r && theirs.blue[role] === b && theirs.red[role] === r) {
          score += 1.5;
          lanes.push(role);
        }
      }
      return { score, shared, lanes, flipped };
    });
    // Both orientations fit equally: the precedent has no side to show here.
    if (tries[0].score === tries[1].score) continue;
    const best = tries[0].score > tries[1].score ? tries[0] : tries[1];
    if (best.shared >= minimum) ranked.push({ ...best, item });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.item.verdict.confidence - a.item.verdict.confidence ||
      a.item.id.localeCompare(b.item.id),
  );
  return ranked.slice(0, limit).map((entry) => ({
    ...orient(entry.item, entry.flipped),
    similarity: entry.score,
    sharedChampions: entry.shared,
    sharedLanes: entry.lanes,
  }));
}

// A claim about allies only carries over when it is about the pair itself.
const ALLY_TAGS = new Set(["synergy"]);
// A claim that names champions of both sides carries over when it is about
// how they meet, not about the rest of the two compositions.
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
const LANE_TAGS = new Set(["lane", "jungle"]);

/**
 * Arguments he gave elsewhere that still hold on this draft: every champion
 * the argument names is here, in the same ally/enemy relation and the same
 * roles as when he said it. Returned with the side they favour on this draft.
 */
export function applicableArguments(draft, index, { limit = 8 } = {}) {
  if (!index) return [];
  const where = new Map();
  for (const side of SIDES)
    for (const role of ROLES) {
      const name = draft?.[side]?.[role];
      if (name) where.set(name, { side, role });
    }
  const own = complete(draft) ? rosterFingerprint(draft) : null;
  const found = new Map();
  for (const item of index.cases) {
    if (!item.claims?.length) continue;
    if (own && rosterFingerprint(item) === own) continue;
    const origin = new Map();
    for (const side of SIDES)
      for (const role of ROLES) origin.set(item[side][role], { side, role });
    for (const claim of item.claims) {
      if (!claim.transferable || (claim.champions?.length ?? 0) < 2) continue;
      const here = claim.champions.map((name) => where.get(name));
      if (here.some((entry) => !entry)) continue;
      const there = claim.champions.map((name) => origin.get(name));
      if (there.some((entry) => !entry)) continue;
      // The relation between champions must be the same: allies stay allies.
      const sameAsFirstHere = here.map((entry) => entry.side === here[0].side);
      const sameAsFirstThere = there.map((entry) => entry.side === there[0].side);
      if (sameAsFirstHere.some((value, i) => value !== sameAsFirstThere[i])) continue;
      const facing = sameAsFirstHere.some((value) => !value);
      if (!(facing ? FACING_TAGS : ALLY_TAGS).has(claim.tag)) continue;
      // Every champion keeps the role it had when he said it.
      if (here.some((entry, i) => entry.role !== there[i].role)) continue;
      // A lane argument is about two opponents in the lane it names.
      if (LANE_TAGS.has(claim.tag)) {
        const role = claim.role || here[0].role;
        const sidesInLane = new Set(
          here.filter((entry) => entry.role === role).map((entry) => entry.side),
        );
        if (sidesInLane.size < 2) continue;
      }
      const flipped = here[0].side !== there[0].side;
      const favours = flipped ? flip(claim.favours) : claim.favours;
      const key = [claim.tag, favours, [...claim.champions].sort().join("+")].join("|");
      const entry = found.get(key) ?? {
        tag: claim.tag,
        favours,
        champions: claim.champions,
        role: claim.role || null,
        detail: claim.detailFr || claim.detail,
        sources: [],
        count: 0,
      };
      entry.count++;
      for (const source of item.sources ?? [])
        if (!entry.sources.some((s) => s.video === source.video))
          entry.sources.push({
            video: source.video,
            title: source.title ?? null,
            ts: source.ts ?? null,
          });
      found.set(key, entry);
    }
  }
  return [...found.values()]
    .sort(
      (a, b) =>
        b.champions.length - a.champions.length ||
        b.count - a.count ||
        a.detail.localeCompare(b.detail, "fr"),
    )
    .slice(0, limit);
}

/** What he said about one champion, across the drafts he judged. */
export function championReads(champion, index, { limit = 5 } = {}) {
  if (!index) return [];
  const reads = [];
  for (const item of index.cases)
    for (const read of item.reads ?? [])
      if (read.champion === champion)
        reads.push({
          read: read.readFr || read.read,
          video: item.sources?.[0]?.video ?? null,
          title: item.sources?.[0]?.title ?? null,
          ts: item.sources?.[0]?.ts ?? null,
        });
  return reads.slice(0, limit);
}
