/** Turn order and structural ban/pick advice. The final score still ignores bans. */
import { analyzeDraft, ROLES, SYNERGIES } from "./engine.mjs";
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
const FIRST_PICK_MARKS = new Set([
  "Caitlyn",
  "Varus",
  "Aphelios",
  "Jinx",
  "Xayah",
]);

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

function profiles(session, knowledge, side) {
  return ROLES.flatMap((role) => {
    const name = session.picks[side][role];
    const profile = name ? knowledge.champions[name] : null;
    return profile ? [{ ...profile, role }] : [];
  });
}

function needs(session, knowledge, side) {
  const ours = profiles(session, knowledge, side);
  const enemy = profiles(session, knowledge, other(side));
  const frontline = ours.reduce((sum, profile) => sum + profile.frontline, 0);
  const dps = ours
    .filter((profile) => profile.role !== "sup")
    .reduce((sum, profile) => sum + profile.dps, 0);
  const peel = ours.reduce((sum, profile) => sum + profile.peel, 0);
  return {
    frontline: frontline < 2,
    dps: dps < 2,
    engage: !ours.some((profile) => profile.engage >= 2),
    peel:
      ours.some((profile) => profile.scaling >= 2 && profile.dps >= 1) &&
      peel < 2,
    enemyImmobile: enemy.filter((profile) => profile.immobile >= 1).length,
    enemyEngage: enemy.filter((profile) => profile.engage >= 2).length,
    enemyDash: enemy.reduce((sum, profile) => sum + profile.dashs, 0),
  };
}

function laneFit(champion, role) {
  const lanes = LANES[champion];
  if (!lanes?.length) return { bonus: 0, rank: 50, onLane: false };
  const rank = lanes.indexOf(role);
  if (rank === -1) return { bonus: -4, rank: 90, onLane: false };
  return { bonus: 2.4, rank, onLane: true };
}

function synergyBonus(champion, allies) {
  const partners = [];
  for (const synergy of SYNERGIES) {
    if (!synergy.pair.includes(champion)) continue;
    const partner = synergy.pair.find((name) => name !== champion);
    if (allies.has(partner)) partners.push(partner);
  }
  return partners;
}

function scoreForRole(
  profile,
  role,
  gap,
  allies,
  { firstBluePick = false, repair = false } = {},
) {
  const reasons = [];
  let score = 0;
  const frontlineWeight = role === "sup" && profile.champion !== "Alistar" ? 0.65 : 1;
  if (repair && gap.frontline && profile.frontline > 0) {
    score += profile.frontline * frontlineWeight * 3;
    reasons.push("ferme le trou de frontline");
  }
  if (repair && gap.dps && role !== "sup" && profile.dps > 0) {
    score += profile.dps * 3;
    reasons.push("apporte des dégâts soutenus");
  }
  if (repair && gap.engage && profile.engage >= 2) {
    score += 2.2;
    reasons.push("donne un vrai engage");
  }
  if (repair && gap.peel && profile.peel > 0) {
    score += profile.peel * 1.6;
    reasons.push("protège le carry");
  }
  if (repair && gap.enemyImmobile >= 2 && profile.catch >= 2) {
    score += 1.8;
    reasons.push("punit les immobiles déjà lock");
  }
  if (repair && gap.enemyEngage >= 1 && profile.disengage + profile.peel >= 2) {
    score += 1.4;
    reasons.push("répond aux engages adverses");
  }
  if (repair && gap.enemyDash >= 4 && profile.champion === "Poppy") {
    score += 2;
    reasons.push("répond aux dashs adverses");
  }
  score +=
    profile.dps * (role === "sup" ? 0.25 : 0.8) +
    profile.frontline * frontlineWeight * 0.7 +
    profile.engage * 0.55 +
    profile.catch * 0.45 +
    profile.peel * 0.4 +
    profile.scaling * 0.35 +
    profile.global * 0.3;
  const partners = synergyBonus(profile.champion, allies);
  if (partners.length) {
    score += 2.4;
    reasons.push(`synergie avec ${partners[0]}`);
  }
  const lane = laneFit(profile.champion, role);
  score += lane.bonus;
  if (lane.onLane) reasons.push("rôle habituel");
  if (firstBluePick && (role === "bot" || role === "jng")) {
    score += 0.8;
    reasons.push("tes notes ouvrent le first pick bleu sur l’ADC ou la jungle");
  }
  if (firstBluePick && role === "bot" && FIRST_PICK_MARKS.has(profile.champion)) {
    score += 1.4;
    reasons.push("ADC prioritaire de tes notes de first pick");
  }
  return {
    score: Math.round(score * 100) / 100,
    reasons: [...new Set(reasons)].slice(0, 3),
  };
}

function bestPlacement(session, knowledge, side, champion, extra = {}) {
  const profile = knowledge.champions[champion];
  const gap = needs(session, knowledge, side);
  const allies = new Set(profiles(session, knowledge, side).map((p) => p.champion));
  const repair = 5 - openRoles(session, side).length >= 2;
  extra = { ...extra, repair };
  let best = null;
  for (const role of openRoles(session, side)) {
    const scored = scoreForRole(profile, role, gap, allies, extra);
    const rank = laneFit(champion, role).rank;
    if (
      !best ||
      scored.score > best.score ||
      (scored.score === best.score && rank < best.rank)
    )
      best = { role, rank, ...scored };
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

export function advise(session, knowledge, { limit = 5 } = {}) {
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
  const firstBluePick =
    step.action === "pick" &&
    step.side === "blue" &&
    openRoles(session, "blue").length === 5;
  const options = [];
  if (step.action === "ban") {
    const opponent = other(step.side);
    const wePickFirst =
      picksBefore(session, step.side) < picksBefore(session, opponent);
    const valuedByUs = available
      .map((champion) => ({
        champion,
        placed: bestPlacement(session, knowledge, step.side, champion, {
          firstBluePick:
            step.side === "blue" && openRoles(session, "blue").length === 5,
        }),
      }))
      .filter((entry) => entry.placed)
      .sort((a, b) => b.placed.score - a.placed.score);
    const keep = new Set(
      wePickFirst ? valuedByUs.slice(0, 5).map((entry) => entry.champion) : [],
    );
    for (const champion of available) {
      if (keep.has(champion)) continue;
      const threat = bestPlacement(session, knowledge, opponent, champion);
      if (!threat) continue;
      options.push({
        champion,
        role: null,
        score: threat.score,
        reasons: [
          `fort pour ${opponent === "blue" ? "le bleu" : "le rouge"} en ${ROLE_NAME[threat.role]}`,
          wePickFirst
            ? "tu peux encore prendre tes priorités au pick"
            : "il peut le prendre avant toi",
          ...(threat.reasons[0] ? [threat.reasons[0]] : []),
        ].slice(0, 3),
      });
    }
  } else {
    for (const champion of available) {
      const placed = bestPlacement(session, knowledge, step.side, champion, {
        firstBluePick,
      });
      if (placed)
        options.push({
          champion,
          role: placed.role,
          score: placed.score,
          reasons: placed.reasons.length
            ? placed.reasons
            : ["complète le plan déjà lock"],
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
  return {
    done: false,
    step,
    options: options.slice(0, limit),
    result: null,
    note: step.ours
      ? `${roleNote} Suggestion pour ton tour. Elle suit l’ordre de draft, le rôle habituel du champion et les profils du moteur. Ce n’est pas une probabilité de victoire.`.trim()
      : `${roleNote} Tour adverse. Le modèle indique seulement le choix structurel le plus fort, pas ce que l’équipe va jouer.`.trim(),
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
