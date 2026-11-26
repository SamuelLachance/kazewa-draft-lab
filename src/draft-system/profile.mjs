/**
 * What a champion brings to a team, from the accumulated profiles
 * (data/knowledge.json). Each profile flag is 0, 1 or 2 and is written from
 * Kazewa's statements and his champion families. Nothing here reads a
 * professional game, a team, a player or a statistic of a match.
 */
export const FUNCTIONS = Object.freeze([
  "frontline", "dps", "engage", "catch", "disengage", "peel", "poke", "scaling",
  "snowball_early", "bridge", "burst", "global", "split", "zone", "immobile",
  "dashs", "anti_dash", "follow_up",
]);

export function zeroVector() {
  return Object.fromEntries(FUNCTIONS.map((name) => [name, 0]));
}

/** The functions of one champion, read from its profile (0 when the profile lacks a flag). */
export function vectorOf(profile) {
  const v = zeroVector();
  if (!profile) return v;
  for (const name of FUNCTIONS) v[name] = Number(profile[name] ?? 0) || 0;
  return v;
}

export function addInto(total, vector) {
  for (const name of FUNCTIONS) total[name] += vector[name];
  return total;
}

/** The summed functions of a list of champion names. Unknown names add nothing. */
export function teamVector(names, champions) {
  const total = zeroVector();
  for (const name of names) if (name) addInto(total, vectorOf(champions[name]));
  return total;
}
