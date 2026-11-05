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

function damerau(left, right) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let row = 0; row < rows; row++) dp[row][0] = row;
  for (let col = 0; col < cols; col++) dp[0][col] = col;
  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost,
      );
      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      )
        dp[row][col] = Math.min(dp[row][col], dp[row - 2][col - 2] + 1);
    }
  }
  return dp[left.length][right.length];
}

function uniqueName(keys, exact) {
  const names = new Set(keys.map((key) => exact.get(key)));
  return names.size === 1 ? [...names][0] : null;
}

// Exact names win earlier. A unique prefix of 3+ letters ("Xin") or one
// unique edit ("Xin Zaho" → Xin Zhao) resolves the token. "Mal" stays unknown.
function resolveLoose(folded, exact, keys) {
  if (!folded) return null;
  if (folded.length >= 3) {
    const prefixed = uniqueName(
      keys.filter((key) => key.startsWith(folded)),
      exact,
    );
    if (prefixed) return prefixed;
  }
  if (folded.length < 4) return null;
  let best = [];
  let bestDistance = Infinity;
  for (const key of keys) {
    if (Math.abs(key.length - folded.length) > 1) continue;
    const distance = damerau(folded, key);
    if (distance > 1 || distance > bestDistance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [key];
    } else best.push(key);
  }
  return bestDistance <= 1 ? uniqueName(best, exact) : null;
}

export function parseChampions(text, knowledge) {
  const exact = dictionary(knowledge);
  const keys = [...exact.keys()];
  const champions = [];
  const unknown = [];
  const duplicates = [];
  const chars = [...String(text ?? "")];
  const hardBreak = (ch) => ch === undefined || /[,;\n/|+]/.test(ch);
  const remember = (name) => {
    if (champions.includes(name)) duplicates.push(name);
    else champions.push(name);
  };
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
      remember(last.name);
      i = last.next;
      continue;
    }
    let end = i;
    while (end < chars.length && !hardBreak(chars[end])) end++;
    const words = chars.slice(i, end).join("").trim().split(/\s+/).filter(Boolean);
    let resolved = null;
    let consumed = 0;
    for (let count = Math.min(3, words.length); count >= 1; count--) {
      const name = resolveLoose(
        foldChampion(words.slice(0, count).join(" ")),
        exact,
        keys,
      );
      if (!name) continue;
      resolved = name;
      consumed = count;
      break;
    }
    if (resolved) {
      remember(resolved);
      let cursor = i;
      let left = consumed;
      while (cursor < end && left > 0) {
        while (cursor < end && /\s/.test(chars[cursor])) cursor++;
        while (
          cursor < end &&
          !/\s/.test(chars[cursor]) &&
          !hardBreak(chars[cursor])
        )
          cursor++;
        left--;
      }
      i = cursor;
      continue;
    }
    const trimmed = chars.slice(i, end).join("").trim();
    if (trimmed) unknown.push(trimmed);
    i = end;
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

export function swapRoles(picks, roleA, roleB) {
  if (!ROLES.includes(roleA) || !ROLES.includes(roleB) || roleA === roleB)
    return { ...picks };
  const next = { ...picks };
  const held = next[roleA] || "";
  next[roleA] = next[roleB] || "";
  next[roleB] = held;
  return next;
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
