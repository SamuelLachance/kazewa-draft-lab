/**
 * Professional games already played with the ten champions of a draft.
 *
 * data/pro-results/ holds one small file per key prefix: for each pair of
 * five-champion rosters seen in professional play, the games played with it
 * and which roster won. The site only fetches the file of the draft on
 * screen. A key is a hash of the two rosters, roles and side order aside.
 *
 * This is not Kazewa's opinion. It is used for a draft he did not judge: on
 * the games he did comment, the team he preferred is most often the team that
 * won, and scripts/evaluate.mjs measures how often.
 */
import { ROLES } from "./engine.mjs";

const rosterText = (team) =>
  ROLES.map((role) => team?.[role] ?? "")
    .sort()
    .join("|");

function fnv(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const complete = (draft) =>
  ["blue", "red"].every((side) => ROLES.every((role) => draft?.[side]?.[role]));

/**
 * Key of a draft in the results files, and which of its sides comes first in
 * the stored rows. Null for an incomplete draft.
 */
export function resultKey(draft) {
  if (!complete(draft)) return null;
  const blue = rosterText(draft.blue);
  const red = rosterText(draft.red);
  const blueFirst = blue <= red;
  const text = blueFirst ? `${blue}//${red}` : `${red}//${blue}`;
  return {
    key: fnv(text, 2166136261) + fnv(text, 0x9747b28c).slice(0, 5),
    first: blueFirst ? "blue" : "red",
  };
}

export const SHARD_LENGTH = 2;
export const shardOf = (key) => key.slice(0, SHARD_LENGTH);

/**
 * The games played with this draft, on the sides of the draft on screen.
 * `shard` is the parsed results file of the draft's key prefix. Rows are
 * [first team, second team, winner (0 or 1), date, league, game number].
 *
 * `side` is the side that won, when every game played with these two rosters
 * went the same way; "even" when they did not.
 */
export function playedGames(draft, shard) {
  const found = resultKey(draft);
  const rows = found ? shard?.[found.key] : null;
  if (!rows?.length) return null;
  const second = found.first === "blue" ? "red" : "blue";
  // The source writes "unknown team" where it has no name.
  const named = (name) =>
    typeof name === "string" && !/^unknown team$/i.test(name.trim()) ? name : null;
  const games = rows.map(([firstTeam, secondTeam, winner, date, league, game]) => ({
    teams: { [found.first]: named(firstTeam), [second]: named(secondTeam) },
    winner: winner === 0 ? found.first : second,
    date: date ?? null,
    league: league ?? null,
    game: game ?? null,
  }));
  const wins = { blue: 0, red: 0 };
  for (const game of games) wins[game.winner] += 1;
  return {
    games,
    wins,
    side: wins.blue && wins.red ? "even" : wins.blue ? "blue" : "red",
  };
}
