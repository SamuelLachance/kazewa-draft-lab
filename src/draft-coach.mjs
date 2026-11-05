/** Turn order, draft rules, and engine-ranked ban/pick advice. The final score still ignores bans. */
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
    if (!champion) continue;
    const roles = (LANES[champion] || []).filter((lane) => open.has(lane));
    if (roles.length) blinds.push({ champion, roles });
  }
  const rank = (roles) =>
    Math.min(...roles.map((role) => CLOSE_ORDER.indexOf(role)));
  blinds.sort(
    (a, b) => rank(a.roles) - rank(b.roles) || a.champion.localeCompare(b.champion, "fr"),
  );
  if (blinds.length) {
    const roles = blinds[0].roles;
    return roles.length > 1
      ? { kind: "flex", roles, closing: true }
      : { kind: "role", role: roles[0], closing: true };
  }
  const role = CLOSE_ORDER.find((item) => open.has(item));
  return role ? { kind: "role", role, closing: false } : null;
}

function boardFrom(session, side = null, champion = null, role = null) {
  const draft = {
    blue: { ...session.picks.blue },
    red: { ...session.picks.red },
  };
  if (side && champion && role) draft[side][role] = champion;
  return draft;
}

function signalKey(signal) {
  return `${signal.id}|${signal.side}|${signal.subject}|${signal.evidence}`;
}

function reasonsFor(before, after, side, champion) {
  const prior = new Set(before.map(signalKey));
  const afterKeys = new Set(after.map(signalKey));
  const added = after.filter((signal) => !prior.has(signalKey(signal)));
  const removed = before.filter(
    (signal) => signal.side !== side && !afterKeys.has(signalKey(signal)),
  );
  const ranked = [
    ...added.map((signal) => ({ signal, text: signal.evidence })),
    ...removed.map((signal) => ({
      signal,
      text: `retire « ${signal.title} »`,
    })),
  ];
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
  if (!reasons.length) reasons.push("le calculateur ne déplace pas le score");
  return reasons;
}

function candidateRoles(session, side, champion, followDraft) {
  const open = openRoles(session, side);
  const lanes = (LANES[champion] || []).filter((role) => open.includes(role));
  if (followDraft) {
    const target = closeTarget(session, side);
    if (target?.kind === "role" && lanes.includes(target.role)) return [target.role];
    if (target?.kind === "flex") {
      const covered = target.roles.filter((role) => lanes.includes(role));
      if (covered.length) return covered;
    }
  }
  if (lanes.length) return lanes;
  if (!followDraft) return [];
  const target = closeTarget(session, side);
  if (target?.kind === "role" && open.includes(target.role)) return [target.role];
  const fallback = earliestRole(open);
  return fallback ? [fallback] : [];
}

function placeChampion(session, knowledge, side, champion, baseline, followDraft) {
  const sign = side === "blue" ? 1 : -1;
  let best = null;
  for (const role of candidateRoles(session, side, champion, followDraft)) {
    const scored = scorePartial(
      boardFrom(session, side, champion, role),
      knowledge,
    );
    const score = Math.round((scored.score - baseline.score) * sign * 100) / 100;
    const rank = CLOSE_ORDER.indexOf(role);
    if (
      !best ||
      score > best.score ||
      (score === best.score && rank < best.rank)
    ) {
      best = {
        role,
        rank,
        score,
        reasons: reasonsFor(baseline.signals, scored.signals, side, champion),
      };
    }
  }
  return best;
}

function picksBefore(session, side) {
  const upcoming = DRAFT_STEPS.slice(session.log.length);
  const pick = upcoming.findIndex(
    (step) => step.action === "pick" && step.side === side,
  );
  return pick === -1 ? 99 : pick;
}

let adviceCache = null;

function adviceKey(session, knowledge) {
  return [
    knowledge?.version ?? "",
    session.userSide,
    session.log.length,
    JSON.stringify(session.bans),
    JSON.stringify(session.picks),
  ].join("|");
}

export function advise(session, knowledge, { limit = 5 } = {}) {
  const key = adviceKey(session, knowledge);
  if (!adviceCache || adviceCache.key !== key)
    adviceCache = { key, advice: rankAdvice(session, knowledge) };
  const advice = adviceCache.advice;
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
  const unavailable = taken(session);
  const available = Object.keys(knowledge.champions)
    .filter((name) => !unavailable.has(name))
    .sort();
  const baseline = scorePartial(boardFrom(session), knowledge);
  const options = [];
  if (step.action === "ban") {
    const opponent = other(step.side);
    const wePickFirst =
      picksBefore(session, step.side) < picksBefore(session, opponent);
    const valuedByUs = available
      .map((champion) => ({
        champion,
        placed: placeChampion(
          session,
          knowledge,
          step.side,
          champion,
          baseline,
          false,
        ),
      }))
      .filter((entry) => entry.placed)
      .sort((a, b) => b.placed.score - a.placed.score);
    const keep = new Set(
      wePickFirst ? valuedByUs.slice(0, 5).map((entry) => entry.champion) : [],
    );
    for (const champion of available) {
      if (keep.has(champion)) continue;
      const threat = placeChampion(
        session,
        knowledge,
        opponent,
        champion,
        baseline,
        false,
      );
      if (!threat) continue;
      const sideName = opponent === "blue" ? "le bleu" : "le rouge";
      options.push({
        champion,
        role: null,
        score: threat.score,
        reasons: [
          `le calculateur le valorise pour ${sideName} en ${ROLE_NAME[threat.role]} (${threat.score > 0 ? "+" : ""}${threat.score})`,
          wePickFirst
            ? "tu peux encore prendre tes priorités au pick"
            : "il peut le prendre avant toi",
          ...(threat.reasons[0] ? [threat.reasons[0]] : []),
        ].slice(0, 3),
      });
    }
  } else {
    for (const champion of available) {
      const placed = placeChampion(
        session,
        knowledge,
        step.side,
        champion,
        baseline,
        true,
      );
      if (!placed) continue;
      options.push({
        champion,
        role: placed.role,
        score: placed.score,
        reasons: placed.reasons,
      });
    }
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
      ? "L’autre côté a blind un flex. Réponds avec un champion qui couvre les mêmes rôles encore ouverts."
      : target?.closing
        ? `Ferme le blind sur ${ROLE_NAME[target.role]}.`
        : target
          ? `Aucun blind ouvert. Prochain rôle : ${ROLE_NAME[target.role]} (ADC, jungle, mid, support, top).`
          : "";
  const best = options[0];
  const proposal = !best
    ? ""
    : step.action === "pick"
      ? `Le calculateur propose ${best.champion} en ${ROLE_NAME[best.role]} (${best.score > 0 ? "+" : ""}${best.score}) : ${best.reasons[0]}.`
      : `Le calculateur propose de bannir ${best.champion} (${best.score > 0 ? "+" : ""}${best.score}).`;
  const turn = step.ours
    ? "Suggestion pour ton tour."
    : "Tour adverse. Le calculateur indique le choix le plus fort pour eux, pas ce que l’équipe va jouer.";
  return {
    done: false,
    step,
    options,
    result: null,
    note: `${roleNote} ${turn} ${proposal} L’ordre des rôles suit les règles de draft. Le classement vient du calculateur. Ce n’est pas une probabilité de victoire.`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

// The click does not ask for a role. Answer the open blind when the champion
// plays it; otherwise use that champion's earliest usual lane still open.
export function inferPickRole(session, champion) {
  const step = currentStep(session);
  if (!step || step.action !== "pick") return null;
  const open = new Set(openRoles(session, step.side));
  if (!open.size) return null;
  const lanes = (LANES[champion] || []).filter((role) => open.has(role));
  const target = closeTarget(session, step.side);
  if (target?.kind === "role" && lanes.includes(target.role)) return target.role;
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
  if (target?.kind === "role" && open.has(target.role)) return target.role;
  if (target?.kind === "flex")
    return earliestRole(target.roles.filter((role) => open.has(role)));
  return earliestRole([...open]);
}

export function applyAction(session, champion, role = null) {
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
      : inferPickRole(next, name);
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
