/**
 * The draft coach: twenty steps, and at each one what to ban or pick and why.
 *
 * The ranking is src/coach.mjs: what Kazewa said about the champions already
 * locked, the composition-only draft value of each champion in its role (from
 * professional drafts, no team and no player), and who can still answer a
 * pick. The structural calculator is not part of it: on the drafts he judged
 * it follows his verdict one time in two.
 */
import { ROLES } from "./engine.mjs";
import { coachTables, latestNoteDate, playableRoles, rankBans, rankPicks } from "./coach.mjs";
import { compositionStatus, FAMILY_FR, indexMethod, stepBrief } from "./method.mjs";
import { theoryContext } from "./theory.mjs";
import { systemPickRows } from "./draft-system/coach.mjs";
import { buildLinks } from "./draft-system/links.mjs";

// Blue opens bans and the first pick. Red opens the second ban phase and the last pick.
export const DRAFT_STEPS = Object.freeze([
  ...[0, 1, 2, 3, 4, 5].map((index) => ({
    action: "ban",
    side: index % 2 === 0 ? "blue" : "red",
  })),
  { action: "pick", side: "blue" },
  { action: "pick", side: "red" },
  { action: "pick", side: "red" },
  { action: "pick", side: "blue" },
  { action: "pick", side: "blue" },
  { action: "pick", side: "red" },
  { action: "ban", side: "red" },
  { action: "ban", side: "blue" },
  { action: "ban", side: "red" },
  { action: "ban", side: "blue" },
  { action: "pick", side: "red" },
  { action: "pick", side: "blue" },
  { action: "pick", side: "blue" },
  { action: "pick", side: "red" },
]);
const SIDES = ["blue", "red"];
const emptyPicks = () => Object.fromEntries(ROLES.map((role) => [role, null]));

export function createSession(seat = "first") {
  if (seat !== "first" && seat !== "second")
    throw new Error("Côté de draft inconnu.");
  return {
    seat,
    userSide: seat === "first" ? "blue" : "red",
    bans: { blue: [], red: [] },
    picks: { blue: emptyPicks(), red: emptyPicks() },
    log: [],
  };
}

export function currentStep(session) {
  const step = DRAFT_STEPS[session.log.length];
  if (!step) return null;
  return {
    index: session.log.length,
    action: step.action,
    side: step.side,
    ours: step.side === session.userSide,
    // The number of this pick in the draft, 1 to 10.
    slot:
      step.action === "pick"
        ? session.log.filter((entry) => entry.action === "pick").length + 1
        : null,
    phase:
      session.log.length < 6
        ? "Première phase de bans"
        : session.log.length < 12
          ? "Première phase de picks"
          : session.log.length < 16
            ? "Deuxième phase de bans"
            : "Deuxième phase de picks",
  };
}

function taken(session) {
  const names = new Set();
  for (const side of SIDES) {
    for (const name of session.bans[side]) names.add(name);
    for (const role of ROLES) {
      const name = session.picks[side][role];
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * What the coach knows, built once.
 *   knowledge  the champion catalogue and profiles
 *   memory     the memory as the site loads it (his arguments)
 *   relations  cardRelations(champion cards)
 *   data       data/coach.json: professional figures and his notes per champion
 *   method     data/method.json: the draft method of Shanei and Kazewa
 * Every part but `knowledge` may be missing: the coach then says less.
 */
export function coachContext({ knowledge, memory = null, relations = null, data = null, method = null, draftValues = null }) {
  const index = indexMethod(method);
  return {
    method: index,
    // The procedure of the two coaches (src/theory.mjs), which decides the reasons.
    theory: theoryContext({ knowledge, index }),
    // The links of the draft system: families, duos and counters, from the same knowledge.
    links: buildLinks({ method, relations }),
    // The composition-only draft values (data/draft-values.json), or null.
    draftValues,
    knowledge,
    champions: Object.keys(knowledge.champions),
    profiles: knowledge.champions,
    tables: coachTables(memory, relations),
    meta: data?.meta ?? null,
    // The date of Kazewa's newest remark: the reference of "recent" for his opinions.
    asOf: latestNoteDate(data?.notes ?? {}),
    notes: data?.notes ?? {},
    cache: new Map(),
  };
}

/**
 * The pick the banning side would take itself right after these bans: its
 * best pick among the champions the opponent could take too, when that pick
 * has something for it. `shared` holds what rankPicks() needs (side, picks,
 * bans, tables, meta, champions…); `slot` is the number of that next pick.
 * Returns a set of one champion, or null. The measure of the coach
 * (research/coach-eval.mjs) calls it too, so it replays what the site does.
 */
export function ownNextPick(shared, slot, profiles = null) {
  const foe = shared.side === "blue" ? "red" : "blue";
  const foeOpen = ROLES.filter((role) => !shared.picks[foe][role]);
  const own = rankPicks({ ...shared, slot, profiles }).find(
    (row) =>
      row.playable &&
      playableRoles(shared.meta, row.champion).some((role) => foeOpen.includes(role)),
  );
  return own && own.reasons.some((reason) => reason.points > 0) ? new Set([own.champion]) : null;
}

/** The families a drafter can say they are going for. */
export const PLANS = Object.freeze(Object.keys(FAMILY_FR));

// The system's rows first, in its order, each with Kazewa's sentences about the champion.
// Rows the system cannot play (no open role of the champion) stay in the pool, unplayable.
function mergeSystemPicks(said, system) {
  const sentences = new Map(
    said.map((row) => [row.champion, (row.reasons ?? []).filter((reason) => ["said", "card", "opinion", "answer"].includes(reason.kind))]),
  );
  const ranked = system.map((row) => ({ ...row, reasons: [...row.reasons, ...(sentences.get(row.champion) ?? [])] }));
  const placed = new Set(ranked.map((row) => row.champion));
  const others = said.filter((row) => !row.playable && !placed.has(row.champion));
  return [...ranked, ...others];
}

function rank(session, context, step, plan = null) {
  const key = JSON.stringify({
    bans: session.bans,
    picks: session.picks,
    at: session.log.length,
    ours: step.ours,
    plan,
  });
  if (!context.cache.has(key)) {
    const shared = {
      mine: step.ours,
      side: step.side,
      picks: session.picks,
      bans: session.bans,
      tables: context.tables,
      meta: context.meta,
      champions: context.champions,
      noteOf: (champion) => context.notes[champion] ?? null,
      asOf: context.asOf,
      method: context.method,
      theory: context.theory,
      draftValues: context.draftValues,
      // The plan is the reader's: it says nothing of the other side's draft.
      plan,
    };
    let rows;
    if (step.action === "pick") {
      // The order is the draft system's (src/draft-system). Kazewa's sentences about each
      // champion stay as reasons; champions the system cannot play stay in the pool.
      const said = rankPicks({ ...shared, slot: step.slot, profiles: context.profiles });
      rows = mergeSystemPicks(
        said,
        systemPickRows(session.picks, step.side, {
          champions: context.knowledge.champions,
          bans: [...session.bans.blue, ...session.bans.red],
          rules: context.knowledge.rules,
          links: context.links,
        }),
      );
    } else {
      // Blue picks first after the first bans, red after the second ones. The
      // side that picks next does not ban what it is about to take.
      const picked = session.log.filter((entry) => entry.action === "pick").length;
      const next = session.log.length < 6 ? "blue" : "red";
      const ownPicks = next === step.side ? ownNextPick(shared, picked + 1, context.profiles) : null;
      rows = rankBans({ ...shared, ownPicks, profiles: context.profiles });
    }
    // One draft is twenty boards: older ones are let go.
    if (context.cache.size >= 24) context.cache.delete(context.cache.keys().next().value);
    context.cache.set(
      key,
      rows.map((row) => ({ ...row, notes: context.notes[row.champion] ?? [] })),
    );
  }
  return context.cache.get(key);
}

/**
 * The advice for the current step: `pool` is every champion, best first;
 * `options` the first playable ones that have something to say for them.
 * Each row carries its reasons, one sentence per point of its score. With no
 * professional figures and nothing said, there is no suggestion: an order
 * with no reason behind it is not advice.
 * `options.plan`: the family the reader is going for ("all-in", "poke",
 * "hypercarry"), or nothing. `brief` are the rules of the two coaches for
 * this step, `status` where each composition stands for them.
 */
export function advise(session, context, options = {}) {
  const limit = options.limit ?? 5;
  const plan = PLANS.includes(options.plan) ? options.plan : null;
  const step = currentStep(session);
  const status = context.method
    ? Object.fromEntries(
        SIDES.map((side) => [
          side,
          compositionStatus(session.picks[side], session.picks[side === "blue" ? "red" : "blue"], context.method, {
            // The plan is an intention: once the draft is finished, the five
            // picks alone say what the composition is, as in Shanei's reading.
            plan: step && side === session.userSide ? plan : null,
            profiles: context.profiles,
          }),
        ]),
      )
    : null;
  const brief = stepBrief(step, context.method);
  if (!step) return { done: true, step: null, options: [], answers: [], pool: [], brief, status };
  const pool = rank(session, context, step, plan);
  // Not suggested: a champion in a role it is not played in, and the ban of
  // one's own best pick. Both stay in the pool, so they can still be clicked.
  const worth = pool.filter(
    (row) =>
      row.playable &&
      row.reasons.some((reason) => reason.points > 0) &&
      !row.reasons.some((reason) => reason.kind === "own"),
  );
  const shown = worth.slice(0, limit);
  // What he said against or with the champions already locked, when the first
  // suggestions do not carry it: an answer he named is worth seeing.
  const answers =
    step.action === "pick"
      ? worth
          .slice(limit)
          .filter((row) => row.reasons.some((reason) => reason.kind === "said" && reason.points > 0))
          .slice(0, 3)
      : [];
  return { done: false, step, pool, options: shown, answers, brief, status };
}

// A click that names no role: the champion goes to the open role it is most
// played in. A role given by the caller wins when it is free.
export function inferPickRole(session, champion, context = null, plan = null) {
  const step = currentStep(session);
  if (!step || step.action !== "pick" || !context) return null;
  return rank(session, context, step, plan).find((row) => row.champion === champion)?.role ?? null;
}

export function applyAction(session, champion, role = null, context = null, plan = null) {
  const step = currentStep(session);
  if (!step) throw new Error("La draft est déjà complète.");
  const name = String(champion || "");
  if (!name) throw new Error("Champion manquant.");
  if (taken(session).has(name))
    throw new Error("Ce champion est déjà banni ou pick.");
  const next = {
    seat: session.seat,
    userSide: session.userSide,
    bans: { blue: [...session.bans.blue], red: [...session.bans.red] },
    picks: {
      blue: { ...session.picks.blue },
      red: { ...session.picks.red },
    },
    log: session.log.map((entry) => ({ ...entry })),
  };
  if (step.action === "ban") {
    next.bans[step.side].push(name);
    next.log.push({ action: "ban", side: step.side, champion: name, role: null });
    return next;
  }
  const assigned =
    ROLES.includes(role) && !next.picks[step.side][role]
      ? role
      : inferPickRole(session, name, context, plan);
  if (!assigned || next.picks[step.side][assigned])
    throw new Error("Aucun rôle habituel n’est libre pour ce champion.");
  next.picks[step.side][assigned] = name;
  next.log.push({
    action: "pick",
    side: step.side,
    champion: name,
    role: assigned,
  });
  return next;
}

export function undo(session) {
  if (!session.log.length) return session;
  return session.log.slice(0, -1).reduce(
    (state, entry) => applyAction(state, entry.champion, entry.role),
    createSession(session.seat),
  );
}
