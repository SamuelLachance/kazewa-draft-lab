/** Whose turn it is still follows the twenty draft steps. Which champion to
 * play is the shipped calculator on the locks already on the board: every
 * remaining champion is scored with that champion added, and the higher score
 * comes first. A ban ranks the same way for the other side. */
import { analyzeDraft, ROLES, scorePartial } from "./engine.mjs";
import { LANES } from "./lanes.mjs";

const SIDES = ["blue", "red"];
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

function remainingNames(session, knowledge) {
  const used = taken(session);
  return Object.keys(knowledge.champions).filter((name) => !used.has(name));
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
  if (!reasons.length) reasons.push("Score du calculateur sur la draft actuelle.");
  return reasons;
}

function formatSigned(score) {
  if (!Number.isFinite(score) || Object.is(score, -0)) return "0";
  return score > 0 ? `+${score}` : String(score);
}

function signedPartial(picks, side, knowledge) {
  const result = scorePartial(picks, knowledge);
  if (!Number.isFinite(result.score)) return null;
  const score = side === "blue" ? result.score : -result.score;
  return { score: Object.is(score, -0) ? 0 : score, result };
}

// Usual lanes only break ties and keep a support tank from being dumped in
// top when the support seat is discounted. A higher score off that lane still
// wins when the calculator adds a role-specific reason, such as a named
// matchup.
const ROLE_REASONS = new Set([
  "named_lane_counter",
  "hook_into_milio",
  "yone_into_aatrox",
  "named_synergy",
  "named_antisynergy",
  "early_bot_support",
]);

function rolePreference(champion, role) {
  const lanes = LANES[champion] || [];
  const usual = lanes.indexOf(role);
  if (usual !== -1) return usual;
  return lanes.length + ROLES.indexOf(role);
}

function placementBeats(current, next) {
  if (!current) return true;
  if (next.score !== current.score) return next.score > current.score;
  return next.preference < current.preference;
}

function offRoleJustified(usual, off) {
  if (!usual || off.score <= usual.score) return false;
  const seen = new Set(
    usual.result.signals.map((signal) => `${signal.id}|${signal.evidence}`),
  );
  return off.result.signals.some(
    (signal) => ROLE_REASONS.has(signal.id) && !seen.has(`${signal.id}|${signal.evidence}`),
  );
}

function rankSide(session, knowledge, side) {
  const open = ROLES.filter((role) => !session.picks[side][role]);
  if (!open.length) return [];
  const rows = [];
  for (const champion of remainingNames(session, knowledge)) {
    const lanes = LANES[champion] || [];
    let usualBest = null;
    const offs = [];
    for (const role of open) {
      const picks = {
        blue: { ...session.picks.blue },
        red: { ...session.picks.red },
      };
      picks[side][role] = champion;
      const scored = signedPartial(picks, side, knowledge);
      if (!scored) continue;
      const candidate = {
        role,
        score: scored.score,
        preference: rolePreference(champion, role),
        result: scored.result,
      };
      if (lanes.includes(role)) {
        if (placementBeats(usualBest, candidate)) usualBest = candidate;
      } else offs.push(candidate);
    }
    let best = usualBest;
    if (usualBest) {
      for (const off of offs) {
        if (offRoleJustified(usualBest, off) && placementBeats(best, off)) best = off;
      }
    } else {
      for (const off of offs) {
        if (placementBeats(best, off)) best = off;
      }
    }
    if (!best) continue;
    const atBest = [...(usualBest ? [usualBest] : []), ...offs].filter(
      (candidate) => candidate.score === best.score,
    );
    const usualAtBest = atBest.some((candidate) => lanes.includes(candidate.role));
    rows.push({
      champion,
      role: best.role,
      flex: !usualAtBest && atBest.length > 1,
      score: best.score,
      reasons: reasonsFrom(best.result.signals, side, champion),
    });
  }
  rows.sort(
    (a, b) => b.score - a.score || a.champion.localeCompare(b.champion, "fr"),
  );
  return rows;
}

const boardCache = new WeakMap();

function cachedRank(session, knowledge, side) {
  let byState = boardCache.get(knowledge);
  if (!byState) {
    byState = new Map();
    boardCache.set(knowledge, byState);
  }
  const key = JSON.stringify({ side, bans: session.bans, picks: session.picks });
  if (!byState.has(key)) byState.set(key, rankSide(session, knowledge, side));
  return byState.get(key);
}

function rankAdvice(session, knowledge) {
  const step = currentStep(session);
  if (!step) {
    return {
      done: true,
      step: null,
      options: [],
      result: analyzeDraft(session.picks, knowledge),
      note: "Draft complète. Le score est celui du calculateur sur les dix champions.",
    };
  }
  if (step.action === "ban") {
    const foe = step.side === "blue" ? "red" : "blue";
    const options = cachedRank(session, knowledge, foe).map((row) => ({
      champion: row.champion,
      role: null,
      score: row.score,
      reasons: row.reasons,
    }));
    const best = options[0];
    const proposal = best
      ? `La plus grosse menace est ${best.champion} (${formatSigned(best.score)}).`
      : "";
    return {
      done: false,
      step,
      options,
      result: null,
      note: `Classement du pool entier, du plus fort au plus faible, selon le score du calculateur si l’autre côté prenait ce champion sur la draft actuelle. ${proposal} Ce chiffre bouge quand un champion est lock.`
        .replace(/\s+/g, " ")
        .trim(),
    };
  }
  const options = cachedRank(session, knowledge, step.side);
  const best = options[0];
  const turn = step.ours
    ? "Suggestion pour ton tour."
    : "Tour adverse. Le calculateur indique le choix le plus fort pour eux.";
  const proposal = best
    ? `${best.champion} ${best.flex ? "sur un rôle libre" : `en ${ROLE_NAME[best.role]}`} (${formatSigned(best.score)}).`
    : "";
  return {
    done: false,
    step,
    options,
    result: null,
    note: `Classement du pool entier, du plus fort au plus faible, selon le calculateur sur la draft actuelle. ${turn} ${proposal} Le chiffre ajoute ce champion à l’état en cours et change dès qu’un champion est lock. Ce n’est pas une probabilité de victoire.`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

const adviceCache = new WeakMap();

function adviceKey(session) {
  return JSON.stringify({
    userSide: session.userSide,
    bans: session.bans,
    picks: session.picks,
    log: session.log.length,
  });
}

export function advise(session, knowledge, options = {}) {
  const limit = options.limit ?? 5;
  let byState = adviceCache.get(knowledge);
  if (!byState) {
    byState = new Map();
    adviceCache.set(knowledge, byState);
  }
  const key = adviceKey(session);
  if (!byState.has(key)) byState.set(key, rankAdvice(session, knowledge));
  const advice = byState.get(key);
  return {
    ...advice,
    pool: advice.options,
    options: advice.options.slice(0, limit),
  };
}

// A click does not ask for a role. It plays the role already ranked for this
// champion on the current board. There is no second pass that can replace it.
export function inferPickRole(session, champion, knowledge = null) {
  const step = currentStep(session);
  if (!step || step.action !== "pick" || !knowledge) return null;
  const ranked = cachedRank(session, knowledge, step.side);
  return ranked.find((action) => action.champion === champion)?.role ?? null;
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
  if (!assigned || next.picks[step.side][assigned])
    throw new Error("Aucun rôle libre pour ce pick.");
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
