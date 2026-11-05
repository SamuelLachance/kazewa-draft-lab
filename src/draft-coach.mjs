/** Whose turn it is still follows the twenty draft steps. Which champion and
 * role to play is not taken from that script: a training run ranks actions by
 * the shipped calculator score, with the opponent raising its own score. */
import { analyzeDraft, ROLES } from "./engine.mjs";
import { tieRank, trainDraftPolicy, trainingReturn } from "./draft-train.mjs";

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
  if (!reasons.length) reasons.push("draft complète selon le calculateur");
  return reasons;
}

function formatSigned(score) {
  if (!Number.isFinite(score) || Object.is(score, -0)) return "0";
  return score > 0 ? `+${score}` : String(score);
}

const policyCache = new WeakMap();

function remainingPickSides(session) {
  return DRAFT_STEPS.slice(session.log.length)
    .filter((step) => step.action === "pick")
    .map((step) => step.side);
}

function loadPolicy(session, knowledge, { seed = 1, focus = null, episodes } = {}) {
  let byState = policyCache.get(knowledge);
  if (!byState) {
    byState = new Map();
    policyCache.set(knowledge, byState);
  }
  const turns = remainingPickSides(session);
  const key = JSON.stringify({
    seed,
    focus,
    episodes: episodes ?? null,
    turns,
    bans: session.bans,
    picks: session.picks,
  });
  if (!byState.has(key)) {
    const step = currentStep(session);
    byState.set(
      key,
      trainDraftPolicy(knowledge, {
        seed,
        focus,
        episodes,
        picks: session.picks,
        remaining: remainingNames(session, knowledge),
        side: step?.side ?? turns[0] ?? null,
        turns,
      }),
    );
  }
  return byState.get(key);
}

function rankedActions(policy, side, knowledge) {
  return policy.actions
    .map((action) => {
      const result = analyzeDraft(action.line, knowledge);
      const score = trainingReturn(action.line, side, knowledge);
      return {
        champion: action.champion,
        role: action.role,
        score,
        line: action.line,
        reasons: reasonsFrom(result.signals, side, action.champion),
      };
    })
    .filter((action) => action.score !== null)
    .sort((a, b) => {
      const score = b.score - a.score;
      if (score) return score;
      const name = a.champion.localeCompare(b.champion, "fr");
      if (name) return name;
      return tieRank(policy.seed, a.champion, a.role) - tieRank(policy.seed, b.champion, b.role);
    });
}

function rankAdvice(session, knowledge, options) {
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
    const options = remainingNames(session, knowledge)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((champion) => ({
        champion,
        role: null,
        score: 0,
        reasons: ["Un ban ne change pas le score du calculateur."],
      }));
    return {
      done: false,
      step,
      options,
      result: null,
      note: "Un ban ne change pas le score du calculateur. Il retire seulement un champion du pool.",
    };
  }
  const policy =
    options.policy ??
    loadPolicy(session, knowledge, { seed: options.seed ?? 1, episodes: options.episodes });
  const ranked = rankedActions(policy, step.side, knowledge);
  const best = ranked[0];
  const turn = step.ours
    ? "Suggestion pour ton tour."
    : "Tour adverse. Le calculateur indique le choix le plus fort pour eux.";
  const proposal = best
    ? `Le calculateur propose ${best.champion} en ${ROLE_NAME[best.role]} (${formatSigned(best.score)}).`
    : "";
  return {
    done: false,
    step,
    options: ranked,
    result: null,
    note: `Politique entraînée sur le score du calculateur. ${turn} ${proposal} Le chiffre est ce score sur la draft complète, si l’autre côté joue pour son propre score. Ce n’est pas une probabilité de victoire.`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

const adviceCache = new WeakMap();

function adviceKey(session, options) {
  return JSON.stringify({
    seed: options.seed ?? 1,
    episodes: options.episodes ?? null,
    supplied: Boolean(options.policy),
    userSide: session.userSide,
    log: session.log.length,
    bans: session.bans,
    picks: session.picks,
  });
}

export function advise(session, knowledge, options = {}) {
  const limit = options.limit ?? 5;
  if (options.policy) {
    const advice = rankAdvice(session, knowledge, options);
    return { ...advice, options: advice.options.slice(0, limit) };
  }
  let byState = adviceCache.get(knowledge);
  if (!byState) {
    byState = new Map();
    adviceCache.set(knowledge, byState);
  }
  const key = adviceKey(session, options);
  if (!byState.has(key)) byState.set(key, rankAdvice(session, knowledge, options));
  const advice = byState.get(key);
  return { ...advice, options: advice.options.slice(0, limit) };
}

// A click does not ask for a role. It plays the role already ranked for the
// suggestion. A second training pass with that champion forced in must not
// replace the quoted role with another one.
export function inferPickRole(session, champion, knowledge = null) {
  const step = currentStep(session);
  if (!step || step.action !== "pick" || !knowledge) return null;
  const open = ROLES.filter((role) => !session.picks[step.side][role]);
  if (!open.length) return null;
  const ranked = rankedActions(loadPolicy(session, knowledge, { seed: 1 }), step.side, knowledge);
  const shown = ranked.filter((action) => action.champion === champion);
  if (shown.length) return shown[0].role;
  const focused = rankedActions(
    loadPolicy(session, knowledge, { seed: 1, focus: champion }),
    step.side,
    knowledge,
  ).filter((action) => action.champion === champion);
  return focused[0]?.role ?? null;
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
