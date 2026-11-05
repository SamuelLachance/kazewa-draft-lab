/** Turn order and draft rules. Suggestions are ranked by the finished-draft
 * advantage from the shipped calculator. Bans only remove champions from the
 * pool: the finished score itself still ignores bans and pick order. */
import { analyzeDraft, scorePartial, ROLES } from "./engine.mjs";
import { LANES } from "./lanes.mjs";

const SIDES = ["blue", "red"];
const other = (side) => (side === "blue" ? "red" : "blue");
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
const ROLE_NAME = {
  top: "top",
  jng: "jungle",
  mid: "mid",
  bot: "ADC",
  sup: "support",
};
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

function openRoles(session, side) {
  return ROLES.filter((role) => !session.picks[side][role]);
}

function earliestRole(roles) {
  return CLOSE_ORDER.find((role) => roles.includes(role)) || null;
}

// Course 3: ADC, jungle, mid, support, top. Close an open blind before opening the next role.
const CLOSE_ORDER = ["bot", "jng", "mid", "sup", "top"];

function coversRoles(champion, roles) {
  const lanes = LANES[champion] || [];
  return roles.every((role) => lanes.includes(role));
}

function closeTarget(session, side) {
  const open = new Set(openRoles(session, side));
  const blinds = [];
  for (const role of ROLES) {
    const champion = session.picks[other(side)][role];
    // A blind is the slot that was actually filled. Ashe locked ADC is an ADC
    // blind even though she can also play support.
    if (!champion || !open.has(role)) continue;
    const lanes = (LANES[champion] || []).filter((lane) => open.has(lane));
    const roles = lanes.includes(role) ? lanes : [role];
    blinds.push({ champion, seat: role, roles });
  }
  blinds.sort(
    (a, b) =>
      CLOSE_ORDER.indexOf(a.seat) - CLOSE_ORDER.indexOf(b.seat) ||
      a.champion.localeCompare(b.champion, "fr"),
  );
  if (blinds.length) {
    const blind = blinds[0];
    return blind.roles.length > 1
      ? {
          kind: "flex",
          champion: blind.champion,
          roles: blind.roles,
          seat: blind.seat,
          closing: true,
        }
      : { kind: "role", role: blind.seat, closing: true };
  }
  const role = CLOSE_ORDER.find((item) => open.has(item));
  return role ? { kind: "role", role, closing: false } : null;
}

function reasonsFrom(signals, side, champion) {
  const ranked = (signals ?? []).map((signal) => ({
    signal,
    text: signal.evidence,
  }));
  ranked.sort((a, b) => {
    const mention = (item) =>
      item.text.includes(champion) || item.signal.evidence.includes(champion) ? 1 : 0;
    const ours = (item) => (item.signal.side === side ? 1 : 0);
    return (
      mention(b) - mention(a) ||
      ours(b) - ours(a) ||
      b.signal.weight - a.signal.weight ||
      a.signal.id.localeCompare(b.signal.id)
    );
  });
  const reasons = [];
  for (const item of ranked) {
    if (reasons.length >= 3) break;
    const text = item.text.replace(/\s+/g, " ").trim();
    reasons.push(text.length > 160 ? item.signal.title : text);
  }
  if (!reasons.length) reasons.push("draft complète selon le calculateur");
  return reasons;
}

function formatSigned(score) {
  if (!Number.isFinite(score) || Object.is(score, -0)) return "0";
  return score > 0 ? `+${score}` : String(score);
}

function remainingNames(session, knowledge) {
  if (!knowledge?.champions) return null;
  return availableNames(session, knowledge);
}

// Off-role is a last resort for a role nobody left can play. Azir does not
// become a jungler while a jungler is still in the pool.
function offroleRole(session, side, champion, open, knowledge) {
  const target = closeTarget(session, side);
  const dump =
    target?.kind === "role" && open.includes(target.role)
      ? target.role
      : target?.kind === "flex"
        ? open.includes(target.seat)
          ? target.seat
          : earliestRole(target.roles.filter((role) => open.includes(role)))
        : earliestRole(open);
  if (!dump) return null;
  const names = remainingNames(session, knowledge);
  if (names?.some((name) => name !== champion && (LANES[name] || []).includes(dump)))
    return null;
  return dump;
}

function candidateRoles(session, side, champion, followDraft, knowledge = null) {
  const open = openRoles(session, side);
  const lanes = (LANES[champion] || []).filter((role) => open.includes(role));
  if (followDraft) {
    const target = closeTarget(session, side);
    if (target?.kind === "role" && lanes.includes(target.role)) return [target.role];
    if (target?.kind === "flex" && coversRoles(champion, target.roles)) {
      const seat = lanes.includes(target.seat)
        ? target.seat
        : earliestRole(target.roles.filter((role) => lanes.includes(role)));
      return seat ? [seat] : [];
    }
  }
  if (lanes.length) return lanes;
  if (!followDraft) return [];
  const dump = offroleRole(session, side, champion, open, knowledge);
  return dump ? [dump] : [];
}

const searchBags = new WeakMap();

function searchBag(knowledge) {
  let bag = searchBags.get(knowledge);
  if (!bag) {
    bag = {
      exact: new Map(),
      rollout: new Map(),
      strength: new Map(),
      rosters: new Map(),
    };
    searchBags.set(knowledge, bag);
  }
  return bag;
}

function stateFrom(session) {
  return {
    bans: { blue: [...session.bans.blue], red: [...session.bans.red] },
    picks: { blue: { ...session.picks.blue }, red: { ...session.picks.red } },
    logLength: session.log.length,
  };
}

function stateKey(state) {
  const cell = (picks) => ROLES.map((role) => picks[role] || "").join(",");
  return [
    state.logLength,
    state.bans.blue.join(","),
    state.bans.red.join(","),
    cell(state.picks.blue),
    cell(state.picks.red),
  ].join("#");
}

function viewOf(state) {
  return { bans: state.bans, picks: state.picks };
}

function availableNames(state, knowledge) {
  const unavailable = new Set([...state.bans.blue, ...state.bans.red]);
  for (const side of SIDES)
    for (const role of ROLES) {
      const name = state.picks[side][role];
      if (name) unavailable.add(name);
    }
  return Object.keys(knowledge.champions)
    .filter((name) => !unavailable.has(name))
    .sort((a, b) => a.localeCompare(b, "fr"));
}

function applyState(state, step, move) {
  const next = {
    bans: state.bans,
    picks: state.picks,
    logLength: state.logLength + 1,
  };
  if (step.action === "ban") {
    next.bans = {
      ...state.bans,
      [step.side]: [...state.bans[step.side], move.champion],
    };
    return next;
  }
  next.picks = {
    ...state.picks,
    [step.side]: { ...state.picks[step.side], [move.role]: move.champion },
  };
  return next;
}

function shouldSearchExactly(state, knowledge) {
  const stepsLeft = DRAFT_STEPS.length - state.logLength;
  if (stepsLeft <= 1) return true;
  const left = availableNames(state, knowledge).length;
  if (left <= 1) return true;
  return stepsLeft * Math.log(left) <= Math.log(20000);
}

// Inside the role rule when anybody can follow it. Off-role fills only when
// the required role has no legal champion left.
function searchMoves(state, knowledge, step) {
  const names = availableNames(state, knowledge);
  if (step.action === "ban")
    return names.map((champion) => ({ champion, role: null }));
  const view = viewOf(state);
  const target = closeTarget(view, step.side);
  const open = openRoles(view, step.side);
  const detailed = names.map((champion) => {
    const lanes = (LANES[champion] || []).filter((role) => open.includes(role));
    const matches =
      target?.kind === "flex"
        ? coversRoles(champion, target.roles)
        : Boolean(target?.kind === "role" && lanes.includes(target.role));
    return {
      champion,
      roles: candidateRoles(view, step.side, champion, true, knowledge),
      matches,
    };
  });
  const matched = detailed.filter((item) => item.matches);
  const pool = matched.length ? matched : detailed;
  const moves = [];
  for (const item of pool)
    for (const role of item.roles) moves.push({ champion: item.champion, role });
  moves.sort(
    (a, b) =>
      a.champion.localeCompare(b.champion, "fr") ||
      CLOSE_ORDER.indexOf(a.role) - CLOSE_ORDER.indexOf(b.role),
  );
  return moves;
}

function scoreRoster(picks, knowledge) {
  const bag = searchBag(knowledge);
  const key = ROLES.map(
    (role) => `${picks.blue[role] || ""}/${picks.red[role] || ""}`,
  ).join("|");
  if (bag.rosters.has(key)) return bag.rosters.get(key);
  const result = analyzeDraft(
    { blue: { ...picks.blue }, red: { ...picks.red } },
    knowledge,
  );
  const leaf = { blueScore: result.score, signals: result.signals };
  bag.rosters.set(key, leaf);
  return leaf;
}

function exactValue(state, knowledge) {
  const bag = searchBag(knowledge);
  const key = stateKey(state);
  if (bag.exact.has(key)) return bag.exact.get(key);
  const step = DRAFT_STEPS[state.logLength];
  const moves = step ? searchMoves(state, knowledge, step) : [];
  if (!step || !moves.length) {
    const leaf = scoreRoster(state.picks, knowledge);
    bag.exact.set(key, leaf);
    return leaf;
  }
  let best = null;
  for (const move of moves) {
    const child = exactValue(applyState(state, step, move), knowledge);
    const improves =
      !best ||
      (step.side === "blue"
        ? child.blueScore > best.blueScore
        : child.blueScore < best.blueScore);
    if (improves) best = child;
  }
  bag.exact.set(key, best);
  return best;
}

function sideStrength(knowledge, side, champion, role) {
  const bag = searchBag(knowledge);
  const key = `${side}|${champion}|${role}`;
  if (bag.strength.has(key)) return bag.strength.get(key);
  const draft = { blue: emptyPicks(), red: emptyPicks() };
  draft[side][role] = champion;
  const advantage = (side === "blue" ? 1 : -1) * scorePartial(draft, knowledge).score;
  bag.strength.set(key, advantage);
  return advantage;
}

function opponentPeak(knowledge, side, champion) {
  const lanes = LANES[champion]?.length ? LANES[champion] : ROLES;
  let best = -Infinity;
  for (const role of lanes) {
    const value = sideStrength(knowledge, side, champion, role);
    if (value > best) best = value;
  }
  return best;
}

function policyMove(state, knowledge, step) {
  const moves = searchMoves(state, knowledge, step);
  let best = null;
  for (const move of moves) {
    const value =
      step.action === "ban"
        ? opponentPeak(knowledge, other(step.side), move.champion)
        : sideStrength(knowledge, step.side, move.champion, move.role);
    const closer =
      !best ||
      value > best.value ||
      (value === best.value &&
        (move.champion.localeCompare(best.move.champion, "fr") < 0 ||
          (move.champion === best.move.champion &&
            CLOSE_ORDER.indexOf(move.role) < CLOSE_ORDER.indexOf(best.move.role))));
    if (closer) best = { move, value };
  }
  return best?.move ?? null;
}

// A full pool cannot be expanded pick by pick. The searched slice is still
// ordered by finished calculator lines. Everybody else stays listed underneath.
const SEARCH_LIMIT = 8;

function searchedNames(state, knowledge, step, available, exact) {
  if (exact || available.length <= SEARCH_LIMIT) return available;
  if (step.action === "ban") {
    const foe = other(step.side);
    return [...available]
      .sort(
        (a, b) =>
          opponentPeak(knowledge, foe, b) - opponentPeak(knowledge, foe, a) ||
          a.localeCompare(b, "fr"),
      )
      .slice(0, SEARCH_LIMIT);
  }
  const view = viewOf(state);
  const target = closeTarget(view, step.side);
  const open = openRoles(view, step.side);
  const rows = available.map((champion) => {
    const lanes = (LANES[champion] || []).filter((role) => open.includes(role));
    const matches =
      target?.kind === "flex"
        ? coversRoles(champion, target.roles)
        : Boolean(target?.kind === "role" && lanes.includes(target.role));
    const role = candidateRoles(view, step.side, champion, true, knowledge)[0];
    return {
      champion,
      matches,
      strength: role
        ? sideStrength(knowledge, step.side, champion, role)
        : -Infinity,
    };
  });
  const pool = rows.some((row) => row.matches)
    ? rows.filter((row) => row.matches)
    : rows;
  pool.sort(
    (a, b) =>
      b.strength - a.strength || a.champion.localeCompare(b.champion, "fr"),
  );
  return pool.slice(0, SEARCH_LIMIT).map((row) => row.champion);
}

function rollout(state, knowledge) {
  const bag = searchBag(knowledge);
  const key = stateKey(state);
  if (bag.rollout.has(key)) return bag.rollout.get(key);
  let cursor = state;
  while (cursor.logLength < DRAFT_STEPS.length) {
    const step = DRAFT_STEPS[cursor.logLength];
    const move = policyMove(cursor, knowledge, step);
    if (!move) break;
    cursor = applyState(cursor, step, move);
  }
  const leaf = scoreRoster(cursor.picks, knowledge);
  bag.rollout.set(key, leaf);
  return leaf;
}

const adviceCache = new WeakMap();

function adviceKey(session) {
  return [
    session.userSide,
    session.log.length,
    JSON.stringify(session.bans),
    JSON.stringify(session.picks),
  ].join("|");
}

export function advise(session, knowledge, { limit = 5 } = {}) {
  let byState = adviceCache.get(knowledge);
  if (!byState) {
    byState = new Map();
    adviceCache.set(knowledge, byState);
  }
  const key = adviceKey(session);
  if (!byState.has(key)) byState.set(key, rankAdvice(session, knowledge));
  const advice = byState.get(key);
  return { ...advice, options: advice.options.slice(0, limit) };
}

function rankAdvice(session, knowledge) {
  const step = currentStep(session);
  if (!step) {
    const draft = { blue: { ...session.picks.blue }, red: { ...session.picks.red } };
    return {
      done: true,
      step: null,
      options: [],
      result: analyzeDraft(draft, knowledge),
      note: "Les dix champions sont lock. Le verdict ignore les bans et l’ordre, comme le moteur.",
    };
  }
  const state = stateFrom(session);
  const exact = shouldSearchExactly(state, knowledge);
  const valueOf = (next) =>
    exact ? exactValue(next, knowledge) : rollout(next, knowledge);
  const sign = step.side === "blue" ? 1 : -1;
  const available = availableNames(state, knowledge);
  const searched = new Set(
    searchedNames(state, knowledge, step, available, exact),
  );
  const options = [];
  const scorePick = (champion) => {
    const view = viewOf(state);
    let best = null;
    for (const role of candidateRoles(view, step.side, champion, true, knowledge)) {
      const line = valueOf(applyState(state, step, { champion, role }));
      const score = sign * line.blueScore;
      const rank = CLOSE_ORDER.indexOf(role);
      if (!best || score > best.score || (score === best.score && rank < best.rank)) {
        best = {
          role,
          rank,
          score,
          reasons: reasonsFrom(line.signals, step.side, champion),
        };
      }
    }
    return best;
  };
  if (step.action === "ban") {
    const baseline = valueOf({
      bans: state.bans,
      picks: state.picks,
      logLength: state.logLength + 1,
    });
    for (const champion of available) {
      if (!searched.has(champion)) continue;
      const line = valueOf(applyState(state, step, { champion, role: null }));
      options.push({
        champion,
        role: null,
        score: sign * (line.blueScore - baseline.blueScore),
        reasons: reasonsFrom(line.signals, step.side, champion),
      });
    }
  } else {
    for (const champion of available) {
      if (!searched.has(champion)) continue;
      const best = scorePick(champion);
      if (!best) continue;
      options.push({
        champion,
        role: best.role,
        score: best.score,
        reasons: best.reasons,
      });
    }
  }
  const floor = options.reduce((min, option) => Math.min(min, option.score), 0);
  const view = viewOf(state);
  for (const champion of available) {
    if (searched.has(champion)) continue;
    const role =
      step.action === "pick"
        ? candidateRoles(view, step.side, champion, true, knowledge)[0] ?? null
        : null;
    if (step.action === "pick" && !role) continue;
    options.push({
      champion,
      role,
      score: floor - 1,
      reasons: ["hors des lignes complètes cherchées"],
    });
  }
  let target = step.action === "pick" ? closeTarget(session, step.side) : null;
  if (
    target?.kind === "flex" &&
    !options.some((option) => coversRoles(option.champion, target.roles))
  ) {
    const role = [...target.roles].sort(
      (a, b) => CLOSE_ORDER.indexOf(a) - CLOSE_ORDER.indexOf(b),
    )[0];
    target = { kind: "role", role, closing: true };
  }
  const matchesTarget = (option) => {
    if (!target) return false;
    if (target.kind === "flex") return coversRoles(option.champion, target.roles);
    return option.role === target.role;
  };
  options.sort(
    (a, b) =>
      Number(matchesTarget(b)) - Number(matchesTarget(a)) ||
      b.score - a.score ||
      a.champion.localeCompare(b.champion, "fr"),
  );
  const roleNote =
    target?.kind === "flex"
      ? `L’autre côté a blind ${target.champion} en ${ROLE_NAME[target.seat]} (${target.roles.map((role) => ROLE_NAME[role]).join("/")}). Ferme ce poste avec un champion qui couvre les mêmes rôles.`
      : target?.closing
        ? `Ferme le blind sur ${ROLE_NAME[target.role]}.`
        : target
          ? `Aucun blind ouvert. Prochain rôle : ${ROLE_NAME[target.role]} (ADC, jungle, mid, support, top).`
          : "";
  const best = options[0];
  const proposal = !best
    ? ""
    : step.action === "pick"
      ? `Le calculateur propose ${best.champion} en ${ROLE_NAME[best.role]} (${formatSigned(best.score)}) : ${best.reasons[0]}.`
      : `Le calculateur propose de bannir ${best.champion} (${formatSigned(best.score)}).`;
  const turn = step.ours
    ? "Suggestion pour ton tour."
    : "Tour adverse. Le calculateur indique le choix le plus fort pour eux, pas ce que l’équipe va jouer.";
  return {
    done: false,
    step,
    options,
    result: null,
    note: `${roleNote} ${turn} ${proposal} L’ordre des rôles suit les règles de draft. Le chiffre est l’avantage du côté qui joue sur la draft complète, si l’autre côté résiste. Ce n’est pas une probabilité de victoire.`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

// The click does not ask for a role. Answer the open blind when the champion
// plays it; otherwise use that champion's earliest usual lane still open.
// A champion is never dropped onto a role he does not play while someone left plays it.
export function inferPickRole(session, champion, knowledge = null) {
  const step = currentStep(session);
  if (!step || step.action !== "pick") return null;
  const open = new Set(openRoles(session, step.side));
  if (!open.size) return null;
  const lanes = (LANES[champion] || []).filter((role) => open.has(role));
  const target = closeTarget(session, step.side);
  if (target?.kind === "role" && lanes.includes(target.role)) return target.role;
  if (
    target?.kind === "flex" &&
    coversRoles(champion, target.roles) &&
    lanes.includes(target.seat)
  )
    return target.seat;
  if (target?.kind === "flex") {
    const covered = target.roles.filter((role) => lanes.includes(role));
    if (covered.length) {
      const foe = session.picks[other(step.side)];
      const answered = covered.filter((role) => {
        const name = foe[role];
        return (
          name && (LANES[name] || []).some((lane) => target.roles.includes(lane))
        );
      });
      return earliestRole(answered.length ? answered : covered);
    }
  }
  if (lanes.length) return earliestRole(lanes);
  return offroleRole(session, step.side, champion, [...open], knowledge);
}

export function applyAction(session, champion, role = null, knowledge = null) {
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
      : inferPickRole(next, name, knowledge);
  if (!assigned || next.picks[step.side][assigned]) {
    const usual = (LANES[name] || []).filter((lane) => !session.picks[step.side][lane]);
    throw new Error(
      usual.length
        ? "Aucun rôle libre pour ce pick."
        : `${name} ne joue aucun rôle encore ouvert.`,
    );
  }
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
