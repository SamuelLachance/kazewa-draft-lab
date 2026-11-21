/**
 * Builds data/method.json: what the two coaches teach about drafting, in a
 * form the site can apply.
 *
 *   rules      every rule taken from their videos, with its video and moment
 *              (research/method-extraction.json: each rule was read back
 *              against the note of the video it cites);
 *   champions  Shanei's families for each champion (cited by him, or deduced
 *              from his definitions and marked so), his first-pick and
 *              never-blind lists, the flex roles he names, and kit facts
 *              (tank, damage type, engage…) from an analyst grid;
 *   pairs      the duos he calls a combo or an anti-synergy, from his videos
 *              and from the course table data/COMBOS DE CHAMPIONS.txt;
 *   bans       his ban lists by family of composition.
 *
 * Needs only committed files:
 *   node scripts/build-method.mjs [--lists]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChampion } from "../src/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const knowledge = read("data/knowledge.json");
const source = read("research/method-extraction.json");
const catalogue = new Set(Object.keys(knowledge.champions));
const ROLE = { top: "top", jungle: "jng", mid: "mid", bot: "bot", support: "sup" };

/* ------------------------------- text ------------------------------- */
// "1:40:40–1:50:40" or "0:22:11, 0:18:08": the first moment, in seconds.
function seconds(text) {
  const found = /(\d+):(\d\d):(\d\d)/.exec(String(text ?? ""));
  return found ? Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]) : null;
}
// French elisions get a typographic apostrophe; champion names keep theirs.
const french = (text) =>
  String(text ?? "").replace(/\b(l|d|qu|n|s|j|c|m|t|jusqu|lorsqu|puisqu|quelqu|aujourd)'/gi, "$1’");
// The notes point to other videos by their number in the playlist ("vid. 29
// [2:12:39]", "vidéo 35, 0:40:19–0:46:20"). A reader of the site has no such
// list: the pointer is removed, the sentence stays, and the link shown is the
// rule's own video.
const CLOCK = String.raw`\d+:\d\d(?::\d\d)?(?:\s*[–-]\s*\d+:\d\d(?::\d\d)?)?`;
const MOMENT = String.raw`(?:\s*,?\s*(?:\[[^\]]*\]|${CLOCK}))`;
const ONE = String.raw`vid(?:éo|eo)?s?\.?\s*\d\d${MOMENT}*`;
const POINTER = String.raw`${ONE}(?:\s*(?:,|et)\s*(?:${ONE}|\d\d${MOMENT}*))*`;
function unpointed(text) {
  return String(text ?? "")
    .replace(new RegExp(String.raw`\s*\(\s*${POINTER}\s*\)`, "gi"), "")
    .replace(new RegExp(String.raw`\s*,\s*${POINTER}(?=\s*[);.,:]|\s*$)`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\b${POINTER}`, "gi"), "")
    .replace(/\s*\[\d+:\d\d(?::\d\d)?[^\]]*\]/g, "")
    .replace(/\(\s*[,;:]?\s*\)/g, "")
    .replace(/\(\s*[,;:]\s*/g, "(")
    // What a removed pointer leaves dangling: "(…; flexable support d’après)".
    .replace(/[;,]\s*[^();,]*\b(?:d’après|cité à)\s*(?=\))/g, "")
    .replace(/\(qui /g, "(il ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ------------------------------- rules ------------------------------- */
// Statements that only stood with their pointer to another video: said again
// without it, word for word otherwise.
const RESTATED = {
  "sf-80": "Prends Rell + Miss Fortune dès que l'option existe ; l'entourage est un bonus, pas une condition : idéalement un jungler qui prolonge le combo (Jarvan IV, Amumu, Zac, Diana, Wukong).",
  "sp-21": "Question non tranchée : dans une vidéo il préfère first pick un ADC neutre et juge les flex (Gragas, Pantheon, Volibear) risqués car l'adversaire peut répondre par un flex qui te counter, alors que d'autres vidéos font du flex l'idéal ; retenir l'ADC sûr pour une draft simple (niveau 1) et le flex pour un niveau avancé (niveau 3), sans le tenir pour obligatoire ni forcément plus fort.",
  "sp-83": "Interdis en équipe les champions trop durs à setup avec lesquels les joueurs trollent : Gnar (y compris en jungle, qualifié de trap) et Jayce, la seule exception étant un vrai OTP Jayce ; plus largement ne drafte pas en supposant que tes joueurs sont des cracks.",
  "sp-84": "Membres incertains (nom douteux dans le transcript) de la liste des picks interdits en équipe : Nilah (par ailleurs déconseillée sans réserve, trop bizarre à drafter) et Azir (liste des picks interdits ou à ne prendre qu'en dernier en toute conscience, où Taliyah, Nidalee, Renekton et Jayce sont, eux, cités sans doute).",
  "kp-18": "Ne jamais blind un champion qui se fait counter : un Jax pické en aveugle se fait contre-picker ; il se prend en contre-pick, ou dans une compo de sa famille, jamais en aveugle isolé.",
};
const rules = {};
for (const rule of source.rules) {
  const shanei = rule.coach === "shanei";
  const video = shanei ? source.playlist[rule.video]?.id : rule.video;
  if (!/^[A-Za-z0-9_-]{11}$/.test(video ?? "")) throw Error(`Règle ${rule.id} : vidéo inconnue (${rule.video}).`);
  rules[rule.id] = {
    coach: rule.coach,
    topic: rule.topic,
    stage: rule.stage,
    text: unpointed(french(RESTATED[rule.id] ?? rule.statement)),
    champions: rule.champions.filter((name) => catalogue.has(name)),
    families: rule.families,
    video,
    ts: seconds(rule.ts),
    title: shanei ? source.playlist[rule.video].title : null,
    uncertain: Boolean(rule.uncertain),
    strength: rule.strength,
  };
}
// A pointer still there, a raw video id, or what a removed pointer leaves behind.
const leftover = Object.entries(rules).filter(([, rule]) =>
  /\bvid(?:éo)?s?\.? ?\d\d\b|\[\d+:\d\d|\b(?:de la|comme la)\s*[,)]|\bvidéo [A-Za-z0-9_-]{11}\b/i.test(rule.text),
);

/* ----------------------------- champions ----------------------------- */
// What he says himself about who counts as the tank of a composition, and
// who engages; the rest of these two flags comes from the kit grid.
const SAID_TANK = new Set(["Trundle", "Dr. Mundo", "Tahm Kench", "Galio", "Cho'Gath", "Sion", "Nautilus", "Volibear", "Udyr"]);
const SAID_NOT_TANK = new Set(["Jarvan IV", "Diana", "Ashe"]);
const SAID_ENGAGE = new Set(["Jarvan IV", "Vi", "Xin Zhao"]);
// He says they do not engage: they zone, cut the fight or send divers back.
const SAID_NOT_ENGAGE = new Set(["Nunu & Willump", "Neeko", "Poppy"]);
// Enchanters he does not want next to a given carry.
const NOT_WITH = { Soraka: ["Bel'Veth", "Samira"], Janna: ["Jinx"], Nami: ["Samira"] };
// Not in the analyst grid.
const KIT_BY_HAND = {
  Briar: { ad: 1, ap: 0, true: 0, class: "skirmisher", tankiness: 3, engage: 4, disengage: 0, poke: 0, global_presence: 2, waveclear: 3, mobility: 4, range: 1, sustained_dps: 4, burst: 3, power_late: 4, power_lvl1_3: 3, blind_pick_safety: 2 },
};
// The rule of his that says it, champion by champion, read one by one: a
// rule that merely names the champion is not one that says it.
const FIRST_RULE = {
  Aphelios: "sp-15", Caitlyn: "sp-15", Cassiopeia: "sp-29",
  Darius: "sp-37", Ezreal: "sp-16", Gangplank: "sp-40",
  Gwen: "sp-23", "Jarvan IV": "sp-11", Jinx: "sp-15", Karma: "sp-22", Karthus: "sp-31",
  LeBlanc: "sp-35", Maokai: "sp-19", "Miss Fortune": "sp-16", Pantheon: "sp-28", Ryze: "sp-20",
  Samira: "sp-16", Shen: "sp-41", Sylas: "sp-39", Trundle: "sp-28",
  Varus: "sp-17", Viktor: "sp-35", Wukong: "sp-20", Xayah: "sp-15",
};
const BLIND_RULE = {
  Darius: "sp-37", Gangplank: "sp-40", Shen: "sp-41", LeBlanc: "sp-35", Sylas: "sp-39",
  Janna: "sp-12", "Jarvan IV": "sp-11", Samira: "sp-16",
};
// The role each of those statements is about. The clauses of his champion
// sheets all come from his list of tops he refuses to blind.
const BLIND_ROLE = { Darius: "top", Gangplank: "top", Shen: "top", LeBlanc: "mid", Janna: "sup", Samira: "bot" };
const FLEX_RULE = {
  Karma: "sp-22", Pantheon: "sp-28", Trundle: "sp-28", Maokai: "sp-28", Udyr: "sp-28",
  Kennen: "sp-28", Rumble: "sp-28", Zilean: "sp-28", Smolder: "sp-28", Mel: "sp-28",
  Cassiopeia: "sp-29", Ashe: "sp-31", Brand: "sp-31", "Cho'Gath": "sp-31",
  Galio: "sp-31", "Dr. Mundo": "sp-31", Karthus: "sp-31", Twitch: "sp-31", Varus: "sp-31",
};
// He names them both ways (Ashe: "OK, pas OP en blind"; Volibear: "viable mais
// risqué", in a rule the notes mark uncertain): no first-pick flag.
// Gragas: listed "en retrait", he does not like him jungle. Smolder: a first
// pick he calls good and dangerous in the same breath.
const FIRST_UNSETTLED = new Set(["Ashe", "Volibear", "Gragas", "Smolder"]);
// The roles the flex rule itself gives, where it is narrower than his sheet.
const FLEX_ROLES = { "Cho'Gath": ["top", "mid"] };
for (const [table, map] of Object.entries({ FIRST_RULE, BLIND_RULE, FLEX_RULE }))
  for (const [name, id] of Object.entries(map)) {
    if (!rules[id]) throw Error(`${table} : règle inconnue ${id}`);
    if (rules[id].uncertain) throw Error(`${table} : ${id} est une règle incertaine`);
    if (!rules[id].champions.includes(name)) throw Error(`${table} : ${id} ne nomme pas ${name}`);
  }
// When no rule says it, the clause of his champion sheet that does, with the
// video that clause points to. No clause, no sentence.
function saidAbout(comment, pattern) {
  for (const clause of String(comment ?? "").split(/ ; | — /)) {
    if (!pattern.test(clause)) continue;
    const pointer = /vid(?:éo)?s?\.? ?(\d\d)(?:\s*\[(\d+:\d\d:\d\d)\])?/i.exec(clause);
    const video = pointer ? source.playlist[pointer[1]] : null;
    if (!video) continue;
    const text = unpointed(french(clause)).replace(/[.;,]+$/, "");
    if (text.length < 8) continue;
    return { text, video: video.id, ts: seconds(pointer[2]), title: video.title };
  }
  return null;
}
// The roles the first clause of his description gives the champion.
function rolesOf(piece, flexRoles) {
  // The words before the first bracket or colon: what the champion is, not
  // what it goes with.
  const first = String(piece).split(/ ; | — |[(:]/)[0].toLowerCase();
  const found = new Set(flexRoles);
  if (/\bjungl/.test(first)) found.add("jng");
  if (/\bsupports?\b/.test(first)) found.add("sup");
  if (/\bmid\b/.test(first)) found.add("mid");
  if (/\badc\b|\bbot\b/.test(first)) found.add("bot");
  if (/\btop\b/.test(first)) found.add("top");
  return [...found];
}
const champions = {};
for (const entry of source.champions) {
  const name = entry.champion;
  if (!catalogue.has(name)) throw Error(`Champion hors catalogue : ${name}`);
  const kit = source.kit[name] ?? KIT_BY_HAND[name];
  if (!kit) throw Error(`Pas de grille de kit pour ${name}.`);
  const families = entry.families.filter((family) => family !== "none");
  const piece = unpointed(french(entry.piece));
  const enchanter = kit.class === "enchanter";
  const tank =
    !SAID_NOT_TANK.has(name) &&
    (SAID_TANK.has(name) || ((kit.class === "tank" || kit.class === "warden") && kit.tankiness >= 4));
  const physical = kit.ad + (kit.true ?? 0);
  const cited = entry.basis === "cited" && source.playlist[entry.video];
  const flexRoles = FLEX_ROLES[name] ?? entry.flexRoles.map((role) => ROLE[role]).filter(Boolean);
  const firstSaid = FIRST_RULE[name] ? null : saidAbout(entry.comment, /first.?pick|premier pick/i);
  // Malphite: his sheet says it in half a clause, with its own video.
  const blindSaid = BLIND_RULE[name]
    ? null
    : name === "Malphite"
      ? { text: "blind Malphite top interdit, il finit jungle", video: source.playlist["33"].id, ts: null, title: source.playlist["33"].title }
      : saidAbout(entry.comment, /\bblind|lock|on le prend tard/i);
  const neverBlind = (Boolean(entry.neverBlind) || name === "Malphite") && Boolean(BLIND_RULE[name] || blindSaid);
  // A flag stays only with something to cite for it.
  const firstPick =
    entry.firstPick === "unsaid" || FIRST_UNSETTLED.has(name) || !(FIRST_RULE[name] || firstSaid)
      ? null
      : entry.firstPick;
  const notHyper = /pas un hypercarry/i.test(`${entry.piece} ${entry.comment}`);
  champions[name] = {
    families,
    piece,
    basis: cited ? "cited" : "deduced",
    source: cited ? { video: source.playlist[entry.video].id, ts: seconds(entry.ts), title: source.playlist[entry.video].title } : null,
    firstPick,
    firstRule: FIRST_RULE[name] ?? null,
    firstSaid: firstPick ? firstSaid : null,
    neverBlind,
    blindRule: BLIND_RULE[name] ?? null,
    blindSaid: neverBlind ? blindSaid : null,
    // The role the statement is about; null: whatever the role.
    blindRole: neverBlind ? (BLIND_ROLE[name] ?? (blindSaid ? "top" : null)) : null,
    flexRoles,
    flexRule: flexRoles.length >= 2 ? (FLEX_RULE[name] ?? null) : null,
    roles: rolesOf(piece, flexRoles),
    comment: unpointed(french(entry.comment || "")),
    // 2: he calls it a hypercarry. 1: it becomes one next to an enchanter
    // ("Caitlyn, poke ou hypercarry"). Never when he says it is not one.
    carry: /^hypercarry/i.test(piece)
      ? 2
      : cited && families.includes("hypercarry") && !notHyper && !enchanter && !tank && ["marksman", "skirmisher"].includes(kit.class)
        ? 1
        : 0,
    // The enchanter he builds a hypercarry with: he describes it as one.
    hyper: enchanter && families.includes("hypercarry") && /^enchanteur/i.test(piece),
    notWith: NOT_WITH[name] ?? [],
    // From the kit grid: an analyst's reading of the spells, not his words.
    enchanter,
    tank,
    damage: kit.ap >= 0.65 ? "ap" : physical >= 0.65 ? "ad" : "mixed",
    engage: !SAID_NOT_ENGAGE.has(name) && (kit.engage >= 4 || SAID_ENGAGE.has(name)),
    disengage: families.includes("disengage") || kit.disengage >= 4,
    poker: families.includes("poke") && kit.poke >= 3,
    global: kit.global_presence >= 4,
    waveclear: kit.waveclear >= 4,
    mobile: kit.mobility >= 4,
    assassin: kit.class === "assassin",
  };
}
for (const name of catalogue) if (!champions[name]) throw Error(`Champion sans famille : ${name}`);

/* ------------------------------- pairs ------------------------------- */
const pairs = [];
const seen = new Map();
// `soft`: he says the duo is overrated or brings nothing, not that it hurts.
function pair(a, b, good, rule, origin = "video", soft = false, more = null) {
  if (!catalogue.has(a) || !catalogue.has(b)) throw Error(`Duo hors catalogue : ${a} + ${b}`);
  if (rule && !rules[rule]) throw Error(`Règle inconnue : ${rule}`);
  if (rule && !(rules[rule].champions.includes(a) && rules[rule].champions.includes(b)))
    throw Error(`${rule} ne nomme pas ${a} + ${b}`);
  const key = [a, b].sort().join("|");
  const known = seen.get(key);
  // What he says in a video comes before the course table.
  if (known) {
    if (known.good !== good && origin === "video" && known.origin === "video")
      throw Error(`Duo jugé dans les deux sens : ${key}`);
    return;
  }
  const entry = { a, b, good, rule, origin };
  if (soft) entry.soft = true;
  if (more) Object.assign(entry, more);
  if (rule && rules[rule].uncertain) entry.uncertain = true;
  seen.set(key, entry);
  pairs.push(entry);
}
const each = (list, rule, good = true, soft = false) => {
  for (const [a, b] of list) pair(a, b, good, rule, "video", soft);
};
// Anti-synergies he names.
each([["Viktor", "Zac"]], "sr-20", false);
each([["Orianna", "Gragas"]], "sr-21", false);
// "Milio avec un Varus poke n’existe pas": not when the composition is a hypercarry one.
pair("Milio", "Varus", false, "sr-24", "video", false, { unless: "hypercarry" });
each([["Jarvan IV", "Ezreal"]], "sr-13", false);
each([["Ezreal", "Leona"]], "sf-52", false);
each([["Bel'Veth", "Rakan"]], "sf-37", false);
each([["Malphite", "Karthus"]], "sf-82", false);
// Duos he calls overrated or empty: said, not held against the draft.
each([["Xayah", "Rakan"]], "sr-22", false, true);
each([["Xin Zhao", "Orianna"]], "sr-23", false, true);
// Combos he names.
each([["Nocturne", "Twisted Fate"], ["Braum", "Nocturne"], ["Camille", "Nocturne"], ["Camille", "Twisted Fate"]], "sf-76");
each([["Kog'Maw", "Lulu"], ["Kog'Maw", "Milio"], ["Twitch", "Yuumi"], ["Bel'Veth", "Lulu"], ["Briar", "Lulu"], ["Jax", "Lulu"]], "sf-79");
each([["Rell", "Miss Fortune"]], "sf-80");
each([["Malphite", "Orianna"], ["Jarvan IV", "Orianna"], ["Wukong", "Orianna"]], "sf-81");
each([["Malphite", "Lissandra"], ["Malphite", "Aurora"], ["Malphite", "LeBlanc"], ["Malphite", "Viktor"]], "sf-82");
each([["Vi", "Orianna"], ["Vi", "LeBlanc"]], "sf-83");
each([["Nocturne", "Ashe"]], "sf-84");
each([["Draven", "Janna"], ["Draven", "Nautilus"]], "sf-85");
each([["Xerath", "Jhin"], ["Xerath", "Nocturne"], ["Jhin", "Nocturne"]], "sf-86");
each([["Elise", "Renekton"], ["Renekton", "Syndra"], ["Elise", "Syndra"], ["Elise", "Lissandra"], ["Renekton", "Lissandra"], ["Sylas", "Sejuani"], ["Rell", "Jarvan IV"]], "sf-87");
each([["Miss Fortune", "Wukong"], ["Miss Fortune", "Jarvan IV"]], "sf-88");
each([["Gwen", "Lulu"], ["Camille", "Lulu"], ["Fiora", "Lulu"]], "sf-41");
each([["Sivir", "Karma"], ["Sivir", "Hecarim"], ["Karma", "Hecarim"]], "sr-50");
each([["Twitch", "Leona"], ["Taliyah", "Pantheon"], ["Orianna", "Nocturne"]], "sr-65");
each([["Zilean", "Udyr"], ["Zilean", "Vladimir"]], "sr-66");
each([["Viktor", "Jarvan IV"], ["Pantheon", "Akali"]], "sr-67");
each([["Yone", "Sejuani"], ["Yone", "Lulu"], ["Olaf", "Yuumi"]], "sr-68");
// A duo of the bot lane: it is one only with both champions there.
pair("Varus", "Karma", true, "sr-68", "video", false, { lanes: { Varus: "bot", Karma: "sup" } });
each([["Miss Fortune", "Amumu"], ["Miss Fortune", "Zac"], ["Miss Fortune", "Diana"]], "sr-70");
each([["Amumu", "Diana"]], "sr-72");
each([["Nasus", "Nocturne"], ["Nasus", "Wukong"]], "sr-75");
each([["Orianna", "Zac"]], "sr-76");
each([["Alistar", "Xerath"]], "sr-62");
each([["Taliyah", "Caitlyn"]], "sr-59");

// The course table: "PIVOT : partner / partner / …".
const ALIAS = {
  naut: "Nautilus", noc: "Nocturne", mf: "Miss Fortune", j4: "Jarvan IV", jarvan: "Jarvan IV",
  cassio: "Cassiopeia", heca: "Hecarim", tf: "Twisted Fate", ww: "Warwick", belveth: "Bel'Veth",
  khazix: "Kha'Zix", yi: "Master Yi", kata: "Katarina", ez: "Ezreal", vlad: "Vladimir",
  lilia: "Lillia", malz: "Malzahar", morg: "Morgana", fiddle: "Fiddlesticks", turndle: "Trundle",
  gnarr: "Gnar", mundo: "Dr. Mundo", kog: "Kog'Maw", gp: "Gangplank", liss: "Lissandra",
  pant: "Pantheon", chogath: "Cho'Gath", nunu: "Nunu & Willump", lee: "Lee Sin", renek: "Renekton",
  heimer: "Heimerdinger", xin: "Xin Zhao", "shaco ap": "Shaco", "gp mid": "Gangplank",
};
const named = (text) => {
  const plain = text
    .replace(/\*+/g, "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!plain) return null;
  return ALIAS[plain] ?? normalizeChampion(plain, knowledge);
};
// Headings of a family list, not of a duo line.
const FAMILY_LIST = /^(wombo combo|globals?|splitpusher|assassin jungle|r clicker mid|hypercarry jgl|globals? \/ enchanteur|famille combo.*|pivot|combo)$/i;
const course = fs.readFileSync(path.join(root, "data", "COMBOS DE CHAMPIONS.txt"), "utf8");
let fromCourse = 0;
const skipped = [];
for (const line of course.split(/\r?\n/)) {
  const at = line.indexOf(":");
  if (at < 0) continue;
  const title = line.slice(0, at).trim();
  const heads = title.split("/").map(named);
  if (heads.some((head) => !head)) {
    if (!FAMILY_LIST.test(title.replace(/\*+/g, "").trim())) skipped.push(`ligne « ${title} »`);
    continue;
  }
  // Partners are split by "/", and by a wide gap where the slash was forgotten.
  for (const part of line.slice(at + 1).split(/\/|\s{3,}/)) {
    const cleaned = part.replace(/\betc\b.*/i, "");
    const partner = named(cleaned);
    if (!partner) {
      if (cleaned.trim() && !/^r clickers?$/i.test(cleaned.trim())) skipped.push(`${title} : ${part.trim()}`);
      continue;
    }
    for (const head of heads)
      if (head !== partner) {
        const before = pairs.length;
        pair(head, partner, true, null, "course");
        fromCourse += pairs.length - before;
      }
  }
}

/* -------------------------------- bans -------------------------------- */
// `mine`: the family I play. `theirs`: the family they show. `with`: a
// champion of mine the ban protects. `against`: a champion of theirs.
// `immobiles`: how many immobile champions I hold. `champions`: what he bans.
const bans = [
  { rule: "sp-50", with: ["Draven", "Samira"], champions: ["Braum"] },
  { rule: "sp-57", mine: "all-in", champions: ["Braum", "Taric", "Tahm Kench"] },
  { rule: "sf-56", mine: "all-in", champions: ["Tahm Kench", "Xayah", "Morgana"] },
  { rule: "sf-54", mine: "all-in", champions: ["Xayah", "Tahm Kench", "Galio"] },
  { rule: "sp-58", with: ["Hecarim"], champions: ["Nami", "Karma", "Lissandra", "Vladimir", "Ahri"] },
  { rule: "sp-59", mine: "hypercarry", champions: ["Twisted Fate", "Gangplank", "Shen", "Zyra", "Vel'Koz", "Neeko"] },
  { rule: "sr-34", mine: "hypercarry", champions: ["Pyke", "Elise"] },
  { rule: "sp-60", mine: "poke", champions: ["Pyke", "Blitzcrank", "Fiora", "Camille"] },
  { rule: "sp-61", theirs: "poke", champions: ["Azir", "Xerath"] },
  { rule: "sp-62", theirs: "hypercarry", champions: ["Braum", "Milio", "Lulu"] },
  { rule: "sp-63", against: ["Smolder"], champions: ["Karma"] },
  { rule: "sp-64", immobiles: 2, champions: ["Miss Fortune", "Jarvan IV", "Rell"] },
];
for (const ban of bans) {
  const rule = rules[ban.rule];
  if (!rule) throw Error(`Règle de ban inconnue : ${ban.rule}`);
  if (rule.uncertain) throw Error(`Règle de ban incertaine : ${ban.rule}`);
  for (const name of [...ban.champions, ...(ban.with ?? []), ...(ban.against ?? [])]) {
    if (!catalogue.has(name)) throw Error(`Ban hors catalogue : ${name}`);
    if (!rule.champions.includes(name)) throw Error(`${ban.rule} ne nomme pas ${name}`);
  }
}

const method = {
  version: 1,
  note: "Ce que Shanei et Kazewa enseignent sur la draft. 'rules' : leurs règles, chacune avec sa vidéo ; 'uncertain' : la fiche de la vidéo marque le passage comme mal transcrit ou non tranché. 'champions' : les familles de Shanei (basis 'cited' : il classe lui-même le champion ; 'deduced' : classé d’après ses définitions), ses listes de first picks et de picks à ne pas blind avec la règle ou la phrase de sa fiche qui le dit, et des faits de kit (tank, enchanteur, type de dégâts, engage, désengage, poke, global, waveclear, mobilité, assassin) tirés d’une grille d’analyste, pas de ses mots. 'pairs' : les duos qu’il nomme (origin 'video') ou qui figurent dans la table des combos de son cours (origin 'course') ; 'soft' : un duo qu’il dit surcoté ou vide. 'bans' : ses listes de bans par famille.",
  rules,
  champions,
  pairs,
  bans,
};
fs.writeFileSync(path.join(root, "data", "method.json"), JSON.stringify(method) + "\n");
const count = (test) => Object.values(champions).filter(test).length;
console.log(
  `${Object.keys(rules).length} règles (${Object.values(rules).filter((r) => r.coach === "shanei").length} Shanei, ${Object.values(rules).filter((r) => r.coach === "kazewa").length} Kazewa) ; ${Object.keys(champions).length} champions dont ${count((c) => c.basis === "cited")} classés par Shanei lui-même ; ${pairs.length} duos dont ${fromCourse} de la table du cours ; ${bans.length} listes de bans`,
);
console.log(`tanks ${count((c) => c.tank)} · enchanteurs ${count((c) => c.enchanter)} dont ${count((c) => c.hyper)} d’hypercarry · hypercarries ${count((c) => c.carry === 2)} (+${count((c) => c.carry === 1)} avec enchanteur) · globaux ${count((c) => c.global)}`);
if (skipped.length) console.log(`Table du cours, non reconnu : ${skipped.join(" | ")}`);
if (leftover.length) console.log(`Renvois à une autre vidéo restés dans le texte : ${leftover.map(([id]) => id).join(", ")}`);
if (process.argv.includes("--lists")) {
  for (const flag of ["tank", "enchanter", "hyper", "carry", "global", "engage", "disengage", "poker"])
    console.log(flag, ":", Object.keys(champions).filter((name) => champions[name][flag]).map((name) => (flag === "carry" && champions[name].carry === 1 ? `(${name})` : name)).join(", "));
  for (const flag of ["firstPick", "neverBlind", "flexRule"])
    console.log(flag, ":", Object.keys(champions).filter((name) => champions[name][flag]).map((name) => `${name}${flag === "firstPick" ? `=${champions[name].firstPick}` : ""}[${champions[name][flag === "neverBlind" ? "blindRule" : flag === "firstPick" ? "firstRule" : "flexRule"] ?? "fiche"}]`).join(", "));
}
