/** Self-play on the shipped calculator. The only return is that score for the
 * side that just acted. Pick order, bans, blinds, flex covers and usual lanes
 * are not part of the return and are not used to rank an action. */
import { analyzeDraft, ROLES } from "./engine.mjs";

const EXACT_LIMIT = 400;
const EPISODES = 16;
const CANDIDATES = 12;

export function trainingReturn(picks, side, knowledge) {
  const result = analyzeDraft(picks, knowledge);
  if (result.status !== "complete" || !Number.isFinite(result.score)) return null;
  return side === "blue" ? result.score : -result.score;
}

function emptyPicks() {
  return {
    blue: Object.fromEntries(ROLES.map((role) => [role, null])),
    red: Object.fromEntries(ROLES.map((role) => [role, null])),
  };
}

function clonePicks(picks) {
  return { blue: { ...picks.blue }, red: { ...picks.red } };
}

function assign(picks, side, role, champion) {
  const next = clonePicks(picks);
  next[side][role] = champion;
  return next;
}

function openRoles(picks, side) {
  return ROLES.filter((role) => !picks[side][role]);
}

function legalActions(picks, remaining, side) {
  const open = openRoles(picks, side);
  const actions = [];
  for (const champion of remaining) {
    for (const role of open) actions.push({ champion, role });
  }
  return actions;
}

function without(remaining, champion) {
  return remaining.filter((name) => name !== champion);
}

function treeSize(picks, remaining, turns) {
  let size = 1;
  let rem = remaining.length;
  const cursor = clonePicks(picks);
  for (const who of turns) {
    const open = openRoles(cursor, who);
    if (!open.length || rem <= 0) return EXACT_LIMIT + 1;
    const branch = rem * open.length;
    if (size > EXACT_LIMIT / branch) return EXACT_LIMIT + 1;
    size *= branch;
    cursor[who][open[0]] = "_";
    rem -= 1;
  }
  return size;
}

function mix(seed, text) {
  let hash = seed >>> 0;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function tieRank(seed, champion, role) {
  return mix(seed, `${champion}|${role}`);
}

function prefer(side, score, champion, role, best, seed) {
  if (!best) return true;
  if (score !== best.blueScore)
    return side === "blue" ? score > best.blueScore : score < best.blueScore;
  const name = champion.localeCompare(best.champion, "fr");
  if (name !== 0) return name < 0;
  return tieRank(seed, champion, role) < tieRank(seed, best.champion, best.role);
}

function terminalBlueScore(knowledge, picks) {
  return trainingReturn(picks, "blue", knowledge);
}

function exactPolicy(knowledge, picks, remaining, turns, seed) {
  const memo = new Map();
  const solve = (statePicks, stateRemaining, stateTurns) => {
    const who = stateTurns[0] ?? null;
    const key = `${stateTurns.join(".")}|${ROLES.map((role) => statePicks.blue[role] || "").join(",")}|${ROLES.map((role) => statePicks.red[role] || "").join(",")}|${stateRemaining.join("\u0000")}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (!who) {
      const blueScore = terminalBlueScore(knowledge, statePicks);
      const leaf = { blueScore, picks: statePicks };
      memo.set(key, leaf);
      return leaf;
    }
    let best = null;
    for (const action of legalActions(statePicks, stateRemaining, who)) {
      const child = solve(
        assign(statePicks, who, action.role, action.champion),
        without(stateRemaining, action.champion),
        stateTurns.slice(1),
      );
      if (child.blueScore === null) continue;
      if (prefer(who, child.blueScore, action.champion, action.role, best, seed)) {
        best = {
          blueScore: child.blueScore,
          picks: child.picks,
          champion: action.champion,
          role: action.role,
        };
      }
    }
    const settled = best
      ? { blueScore: best.blueScore, picks: best.picks }
      : { blueScore: null, picks: statePicks };
    memo.set(key, settled);
    return settled;
  };
  const who = turns[0];
  const actions = [];
  for (const action of legalActions(picks, remaining, who)) {
    const child = solve(
      assign(picks, who, action.role, action.champion),
      without(remaining, action.champion),
      turns.slice(1),
    );
    if (child.blueScore === null) continue;
    actions.push({
      champion: action.champion,
      role: action.role,
      line: child.picks,
      blueScore: child.blueScore,
    });
  }
  return { seed, exact: true, side: who, actions };
}

function rngOf(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function actionKey(side, action) {
  return `${side}|${action.champion}|${action.role}`;
}

function playOut(knowledge, picks, remaining, turns, choose) {
  const roster = clonePicks(picks);
  let pool = remaining;
  const played = [];
  for (const who of turns) {
    const actions = legalActions(roster, pool, who);
    if (!actions.length) break;
    const action = choose(actions, who, roster, pool);
    played.push({ side: who, action });
    roster[who][action.role] = action.champion;
    pool = without(pool, action.champion);
  }
  const blueScore = terminalBlueScore(knowledge, roster);
  return { played, roster, blueScore };
}

function boundedPolicy(knowledge, picks, remaining, turns, seed, episodes, focus) {
  const values = new Map();
  for (let episode = 0; episode < episodes; episode += 1) {
    const rng = rngOf(mix(seed, `episode:${episode}`));
    const { played, blueScore } = playOut(knowledge, picks, remaining, turns, (actions, who) => {
      if (rng() < 0.4) return actions[Math.floor(rng() * actions.length)];
      let best = null;
      for (const action of actions) {
        const row = values.get(actionKey(who, action));
        const value = row ? row.sum / row.n : 0;
        const hash = mix(seed, actionKey(who, action));
        if (!best || value > best.value || (value === best.value && hash < best.hash))
          best = { action, value, hash };
      }
      return best.action;
    });
    if (blueScore === null) continue;
    for (const step of played) {
      const key = actionKey(step.side, step.action);
      const row = values.get(key) ?? { sum: 0, n: 0 };
      row.sum += step.side === "blue" ? blueScore : -blueScore;
      row.n += 1;
      values.set(key, row);
    }
  }
  const who = turns[0];
  const shuffled = [...legalActions(picks, remaining, who)];
  const rng = rngOf(mix(seed, "candidates"));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const selected = shuffled.slice(0, CANDIDATES);
  if (focus) {
    for (const action of legalActions(picks, remaining, who)) {
      if (action.champion !== focus) continue;
      if (!selected.some((item) => item.champion === action.champion && item.role === action.role))
        selected.push(action);
    }
  }
  const greedy = (actions, actor) => {
    let best = null;
    for (const action of actions) {
      const row = values.get(actionKey(actor, action));
      const value = row ? row.sum / row.n : 0;
      const hash = mix(seed, actionKey(actor, action));
      if (!best || value > best.value || (value === best.value && hash < best.hash))
        best = { action, value, hash };
    }
    return best.action;
  };
  const actions = selected.map((action) => {
    const childTurns = turns.slice(1);
    const { roster, blueScore } = playOut(
      knowledge,
      assign(picks, who, action.role, action.champion),
      without(remaining, action.champion),
      childTurns,
      greedy,
    );
    if (blueScore === null) return null;
    return { champion: action.champion, role: action.role, line: roster, blueScore };
  }).filter(Boolean);
  return { seed, exact: false, side: who, actions };
}

export function trainDraftPolicy(knowledge, spec = {}) {
  const seed = spec.seed ?? 1;
  const picks = spec.picks ? clonePicks(spec.picks) : emptyPicks();
  const remaining = [...(spec.remaining ?? Object.keys(knowledge.champions))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  const turns = spec.turns ?? [];
  const episodes = spec.episodes ?? EPISODES;
  if (!turns.length || !remaining.length)
    return { seed, exact: true, side: spec.side ?? null, actions: [] };
  if (treeSize(picks, remaining, turns) <= EXACT_LIMIT)
    return exactPolicy(knowledge, picks, remaining, turns, seed);
  return boundedPolicy(knowledge, picks, remaining, turns, seed, episodes, spec.focus ?? null);
}
