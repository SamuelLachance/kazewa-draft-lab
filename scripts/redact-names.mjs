/**
 * Removes team and player names from the text of the published data.
 *
 * Team and player names come from the professional match data (Oracle's Elixir
 * CSV files in .cache/oe-new and the match index .cache/oe-games.json). Every
 * string value of the JSON files below is scanned, and each whole word that is a
 * team name becomes "une équipe", each player name "un joueur". Champion names,
 * gameplay words and a few words that are also names are never replaced.
 * Structured team fields (match.teams) are removed.
 *
 * Idempotent: running it again changes nothing once the names are gone.
 *
 *   node scripts/redact-names.mjs            # apply
 *   node scripts/redact-names.mjs --dry-run  # count only, print the most frequent matches
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

// The published files built from Kazewa's records. The records themselves
// (data/kazewa-memory.json and its sources) keep their names: the memory build
// matches his drafts to the professional games by those names.
const FILES = [
  "data/memory-site.json",
  "data/coach.json",
  "data/champion-cards.json",
];

// Keys that hold identifiers, not prose: never rewritten.
export const KEEP_KEYS = new Set(["id", "video", "fingerprint", "url", "ref", "gameId", "date", "ts", "sha", "hash"]);

// Words that look like names but are game or ordinary words.
const NEVER = new Set([
  "Flash", "Ghost", "Catch", "Hyper", "Heal", "Ignite", "Teleport", "Smite", "Barrier", "Exhaust",
  "Cleanse", "Snowball", "Nova", "Mad",
  "Kaze", "Team", "Esports", "Gaming", "Academy", "Rookies", "Prime", "Unknown", "Rising", "Dynamics", "Corp",
  "Sword", "Shield", "Mid", "Top", "Jungle",
  "Blue", "Red", "Only", "Rookie", "Counter", "Broken", "Bans", "Nash", "Can", "Bat",
  // English words that are also player or team names in the data, and that appear in ordinary text.
  "Hard", "Worst", "Small", "Will", "Slow", "Upset", "Follow", "Makes", "Hated", "Force", "Night", "Edge",
  "Void", "Nothing", "Value", "Near", "Low", "Four", "Arrow", "Pillar", "Typical", "Turtle", "Doubtful",
  "Chosen", "Nice", "Wall", "Max", "Tear", "Kick", "Delight", "Beats", "Mobility", "Triple", "Solo", "Rush",
  "Impact", "Guardian", "Style", "Pure", "Sky", "Spike", "Elk", "Blitz", "Menace", "Starter", "Ganks",
  "Smart", "Last", "Giants", "Hydra", "Juggernaut", "Bully", "Mis", "Jerry", "Khan", "Danger", "Ravenous",
  "Valkyrie", "Daisy", "Close", "Stage", "Fight", "Pick", "Ban", "Draft", "Lane", "Game", "Series",
  "Peace", "Wind", "Sun", "Star", "Shot", "Storm", "Power", "Champion", "Legend", "Tiger",
  "Comp", "Test", "Nobody", "Self", "Hands", "Rapid", "Fear", "Seal", "White", "Clear", "Key", "Auto",
  "Burst", "Global", "Macro", "Point", "Champions", "Challenger", "Premier",
  "Crown", "Nemesis",
  "Support", "Carry", "Engage", "Poke", "Split", "Scaling", "Tank", "Frontline", "Dragon", "Baron",
]);

export function loadNames() {
  const teams = new Set();
  const players = new Map();
  const champions = new Set();
  const championParts = new Set();
  const knowledgePath = path.join(root, "data", "knowledge.json");
  if (fs.existsSync(knowledgePath)) {
    const knowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    for (const name of Object.keys(knowledge.champions ?? {})) {
      champions.add(name);
      for (const part of name.split(/[\s.'-]+/)) if (part) championParts.add(part);
    }
  }
  const oeDir = path.join(root, ".cache", "oe-new");
  const csvs = fs.existsSync(oeDir) ? fs.readdirSync(oeDir).filter((f) => f.endsWith(".csv")) : [];
  for (const file of csvs) {
    const lines = fs.readFileSync(path.join(oeDir, file), "utf8").split("\n");
    const header = lines[0].split(",");
    const iPlayer = header.indexOf("playername");
    const iTeam = header.indexOf("teamname");
    if (iPlayer < 0 || iTeam < 0) continue;
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const cells = line.split(",");
      const team = (cells[iTeam] ?? "").trim();
      const player = (cells[iPlayer] ?? "").trim();
      if (team) teams.add(team);
      if (player) players.set(player, (players.get(player) ?? 0) + 1);
    }
  }
  const indexPath = path.join(root, ".cache", "oe-games.json");
  if (fs.existsSync(indexPath)) {
    for (const game of JSON.parse(fs.readFileSync(indexPath, "utf8")))
      for (const side of ["blue", "red"]) {
        const name = game.teams?.[side];
        if (name) teams.add(name);
      }
  }
  // A name is kept only when it is not a champion, not a fragment of one, not a gameplay or
  // common word, and starts with a capital (players, and most teams, do).
  // Official tags of the teams that play in the professional leagues. Not derivable from the
  // names alone ("BLG" is not in "Bilibili Gaming"). Words that are also common in text are left out.
  for (const tag of ["T1", "GEN", "Gen", "HLE", "DRX", "KT", "DK", "DWG", "BLG", "JDG", "TES", "FNC", "G2", "LNG",
    "RNG", "IG", "LGD", "EDG", "FPX", "OMG", "V5", "GAM", "KOI", "VIT", "GX", "RGE", "BDS", "C9", "TSM", "100T", "SEN",
    // Spellings used in video titles.
    "SKT", "GenG", "GENG", "Geng", "KTR", "Gen.G", "Gen G"])
    teams.add(tag);
  // A distinctive word of a team's name is its short name too ("Team Heretics" gives "Heretics").
  for (const team of [...teams]) {
    const words = team.split(/\s+/).filter((w) => !NEVER.has(w) && !championParts.has(w));
    for (const token of words)
      if ((token.length >= 5 && /^\p{Lu}[\p{L}\p{N}.'-]*$/u.test(token)) || /^[\p{Lu}\p{N}]{2,4}$/u.test(token))
        teams.add(token);
    // The tag made of the initials of a name of several words ("Hanwha Life Esports" gives "HLE").
    if (words.length >= 2) {
      const tag = words.map((w) => w[0]).join("").toUpperCase();
      if (tag.length >= 2 && tag.length <= 4) teams.add(tag);
    }
  }
  const usable = (name) =>
    name.length >= 2 &&
    !champions.has(name) &&
    !NEVER.has(name) &&
    !championParts.has(name) &&
    /^\p{Lu}/u.test(name) &&
    /^[\p{L}\p{N}][\p{L}\p{N} .'&-]*$/u.test(name);
  // Without the professional match data (the CI checkout has none) there is no list: nothing is
  // removed, and nothing is claimed to be removed.
  const cached = csvs.length > 0 || fs.existsSync(indexPath);
  if (!cached) return { teams: [], players: [] };
  return {
    teams: [...teams].filter(usable).sort((a, b) => b.length - a.length),
    players: [...players]
      .filter(([name, count]) => usable(name) && name.length >= 3 && count >= 3)
      .flatMap(([name]) => {
      // "ShowMaker" is also written "Showmaker": the form with the same capital is added.
      const plain = name.charAt(0) + name.slice(1).toLowerCase();
      return /[a-z][A-Z]/.test(name) ? [name, plain] : [name];
    })
      .sort((a, b) => b.length - a.length),
  };
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPattern(names) {
  // An empty alternation matches the empty string everywhere: no list, no pattern.
  if (!names.length) return null;
  const body = names.map(escapeRe).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");
}

// "une équipe" / "un joueur", with a capital when the name starts a sentence.
function placeholder(kind, whole, offset) {
  const before = whole.slice(0, offset).trimEnd();
  const starts = before === "" || /[.!?:;»"“—–-]$/.test(before);
  if (kind === "team") return starts ? "Une équipe" : "une équipe";
  return starts ? "Un joueur" : "un joueur";
}

function main() {
  const { teams, players } = loadNames();
  if (!teams.length && !players.length) {
    console.log("Aucune liste de noms : .cache/oe-new et .cache/oe-games.json sont absents, rien à retirer.");
    return;
  }
  // A missing list matches nothing (the pattern that never matches).
  const teamRe = buildPattern(teams) ?? new RegExp("(?!)", "gu");
  const playerRe = buildPattern(players) ?? new RegExp("(?!)", "gu");
  const counts = new Map();
  let changedFiles = 0;
  let removedTeamFields = 0;
  const redact = (value, key) => {
    if (typeof value === "string") {
      if (KEEP_KEYS.has(key)) return value;
      const replaced = value
        .replace(teamRe, (hit, offset, whole) => {
          counts.set(hit, (counts.get(hit) ?? 0) + 1);
          return placeholder("team", whole, offset);
        })
        .replace(playerRe, (hit, offset, whole) => {
          counts.set(hit, (counts.get(hit) ?? 0) + 1);
          return placeholder("player", whole, offset);
        });
      // Grammar after the replacement: "que une équipe" becomes "qu’une équipe".
      return replaced
        .replace(/\bque une équipe\b/g, "qu’une équipe")
        .replace(/\bde une équipe\b/g, "d’une équipe")
        .replace(/\bque un joueur\b/g, "qu’un joueur")
        .replace(/\bde un joueur\b/g, "d’un joueur");
    }
    if (Array.isArray(value)) return value.map((item) => redact(item, key));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        // Structured team fields are dropped, not rewritten.
        if (k === "teams" && (v === null || typeof v === "object")) { removedTeamFields += 1; continue; }
        out[k] = redact(v, k);
      }
      return out;
    }
    return value;
  };
  for (const rel of FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    const cleaned = redact(data, "");
    const text = JSON.stringify(cleaned, null, raw.includes("\n  ") ? 1 : undefined) + (raw.endsWith("\n") ? "\n" : "");
    if (text !== raw) {
      changedFiles += 1;
      if (!dryRun) fs.writeFileSync(file, text);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`${dryRun ? "essai à blanc : " : ""}${total} noms remplacés dans ${changedFiles} fichiers ; ${removedTeamFields} champs d'équipe retirés ; ${teams.length} équipes et ${players.length} joueurs connus`);
  if (dryRun)
    console.log([...counts].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([name, n]) => `${n}\t${name}`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
