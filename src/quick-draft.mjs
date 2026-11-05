/** Turn a loose champion list into five roles. The final score still comes from the engine. */
import { ROLES } from "./engine.mjs";
import { LANES } from "./lanes.mjs";

const FOLD_ALIASES = {
  monkeyking: "wukong",
  renata: "renataglasc",
  nunu: "nunuwillump",
  jarvan: "jarvaniv",
  jarvan4: "jarvaniv",
  mundo: "drmundo",
};

export function foldChampion(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function dictionary(knowledge) {
  const byFold = new Map();
  for (const name of Object.keys(knowledge?.champions ?? {}))
    byFold.set(foldChampion(name), name);
  for (const [alias, target] of Object.entries(FOLD_ALIASES)) {
    const name = byFold.get(target);
    if (name) byFold.set(alias, name);
  }
  return byFold;
}

export function parseChampions(text, knowledge) {
  const exact = dictionary(knowledge);
  const keys = [...exact.keys()];
  const champions = [];
  const unknown = [];
  const duplicates = [];
  const chars = [...String(text ?? "")];
  const hardBreak = (ch) => ch === undefined || /[,;\n/|+]/.test(ch);
  let i = 0;
  while (i < chars.length) {
    while (i < chars.length && /[\s,;\n/|+·•]/.test(chars[i])) i++;
    if (i >= chars.length) break;
    let foldedBuf = "";
    let last = null;
    for (let j = i; j < chars.length; j++) {
      if (hardBreak(chars[j]) && foldedBuf) break;
      const piece = foldChampion(chars[j]);
      if (!piece) continue;
      foldedBuf += piece;
      if (exact.has(foldedBuf))
        last = { name: exact.get(foldedBuf), next: j + 1, buf: foldedBuf };
      if (!keys.some((key) => key.startsWith(foldedBuf))) break;
    }
    if (last) {
      if (champions.includes(last.name)) duplicates.push(last.name);
      else champions.push(last.name);
      i = last.next;
      continue;
    }
    let token = "";
    while (i < chars.length && !hardBreak(chars[i])) token += chars[i++];
    const trimmed = token.trim();
    if (trimmed) unknown.push(trimmed);
  }
  return { champions, unknown, duplicates };
}

function roleCost(champion, role) {
  const lanes = LANES[champion] || [];
  const index = lanes.indexOf(role);
  if (index !== -1) return index;
  if (lanes.length <= 1) return 10;
  if (lanes.length === 2) return 8;
  return 6;
}

export function assignRoles(champions) {
  const names = champions.filter(Boolean);
  const picks = Object.fromEntries(ROLES.map((role) => [role, ""]));
  if (!names.length) return { picks, placements: [] };
  let best = null;
  const used = new Set();
  const assignment = {};
  const search = (index, cost) => {
    if (index === names.length) {
      if (!best || cost < best.cost) best = { cost, assignment: { ...assignment } };
      return;
    }
    const champion = names[index];
    const order = [...ROLES].sort(
      (a, b) =>
        roleCost(champion, a) - roleCost(champion, b) ||
        ROLES.indexOf(a) - ROLES.indexOf(b),
    );
    for (const role of order) {
      if (used.has(role)) continue;
      used.add(role);
      assignment[role] = champion;
      search(index + 1, cost + roleCost(champion, role));
      used.delete(role);
      delete assignment[role];
    }
  };
  search(0, 0);
  Object.assign(picks, best.assignment);
  const placements = names.map((champion) => {
    const role = ROLES.find((item) => picks[item] === champion);
    const lanes = LANES[champion] || [];
    return { champion, role, usual: !lanes.length || lanes.includes(role) };
  });
  return { picks, placements };
}

export function compositionFromText(text, knowledge) {
  const parsed = parseChampions(text, knowledge);
  const used = parsed.champions.slice(0, 5);
  const { picks, placements } = assignRoles(used);
  return {
    ...parsed,
    champions: used,
    overflow: parsed.champions.slice(5),
    picks,
    placements,
  };
}
