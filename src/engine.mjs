/** Composition-only, deterministic expert model. No team identity or game outcome enters this module. */
export const ROLES = Object.freeze(["top", "jng", "mid", "bot", "sup"]);
const SIDES = ["blue", "red"];
const other = (side) => (side === "blue" ? "red" : "blue");
const sum = (arr, key) => arr.reduce((n, p) => n + (Number(p[key]) || 0), 0);
const count = (arr, key, min = 1) =>
  arr.filter((p) => (Number(p[key]) || 0) >= min).length;
const folded = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const aliases = {
  monkeyking: "wukong",
  renata: "renataglasc",
  nunu: "nunuwillump",
  jarvan: "jarvaniv",
  jarvan4: "jarvaniv",
  mundo: "drmundo",
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n) => Math.round(n * 100) / 100;
// Context groups come from the method and category definitions. These never overwrite raw profiles.
const RANGED_DPS = new Set([
  "Aphelios",
  "Ashe",
  "Azir",
  "Caitlyn",
  "Cassiopeia",
  "Corki",
  "Draven",
  "Ezreal",
  "Jinx",
  "Kai'Sa",
  "Kalista",
  "Karthus",
  "Kog'Maw",
  "Ryze",
  "Senna",
  "Sivir",
  "Smolder",
  "Tristana",
  "Twitch",
  "Varus",
  "Vayne",
  "Viktor",
  "Xayah",
  "Yunara",
  "Zeri",
]);
const HYPERCARRIES = new Set([
  "Aphelios",
  "Azir",
  "Cassiopeia",
  "Jinx",
  "Kai'Sa",
  "Kayle",
  "Kog'Maw",
  "Ryze",
  "Sivir",
  "Smolder",
  "Tristana",
  "Twitch",
  "Vayne",
  "Xayah",
  "Zeri",
]);
const ANTI_TANK = new Set([
  "Cassiopeia",
  "Darius",
  "Fiora",
  "Gwen",
  "Kai'Sa",
  "Kayle",
  "Kog'Maw",
  "Lillia",
  "Smolder",
  "Trundle",
  "Varus",
  "Vayne",
]);
const LONG_RANGE = new Set([
  "Azir",
  "Caitlyn",
  "Corki",
  "Ezreal",
  "Hwei",
  "Jayce",
  "Lux",
  "Senna",
  "Seraphine",
  "Varus",
  "Vel'Koz",
  "Xerath",
  "Ziggs",
  "Zoe",
]);
const FOLLOWUPS = new Set([
  "Annie",
  "Cassiopeia",
  "Galio",
  "Hwei",
  "Kennen",
  "Miss Fortune",
  "Orianna",
  "Rumble",
  "Xayah",
  "Yasuo",
]);
const GUARDIANS = new Set(["Galio", "Lissandra", "Shen", "Tahm Kench"]);
const FALSE_IMMOBILES = new Set(["Aphelios", "Jhin", "Karma", "Xayah"]);
const LOCKERS = new Set([
  "Camille",
  "Jarvan IV",
  "Nautilus",
  "Nocturne",
  "Pantheon",
  "Skarner",
  "Vi",
  "Zac",
]);

export function normalizeChampion(name, knowledge) {
  if (typeof name !== "string") return null;
  // Uncertainty is data, not punctuation to discard during provider alias matching.
  if (name.includes("?")) return null;
  let key = folded(name);
  key = aliases[key] ?? key;
  return (
    Object.keys(knowledge?.champions ?? {}).find((c) => folded(c) === key) ??
    null
  );
}

function summarize(team) {
  const list = ROLES.map((r) => team[r]);
  const has = (...names) =>
    names.some((n) => list.some((p) => p.champion === n));
  const trueTanks = count(list, "frontline", 2),
    offTanks = list.filter((p) => p.frontline === 1).length;
  const peel = sum(list, "peel"),
    disengage = sum(list, "disengage");
  // A support tank has a smaller resource budget; Alistar is Kazewa's explicit exception.
  const frontlineDepth = list.reduce(
    (n, p) =>
      n +
      p.frontline * (p.role === "sup" && p.champion !== "Alistar" ? 0.65 : 1),
    0,
  );
  const coreFrontline = list.filter(
    (p) => p.role !== "sup" && p.frontline >= 1,
  ).length;
  const effectiveFrontline =
    frontlineDepth >= 1.8 ||
    (coreFrontline >= 1 && peel >= 2) ||
    (offTanks >= 2 && peel >= 1);
  const primary = list.filter((p) => p.role !== "sup");
  const primaryDps = sum(primary, "dps");
  const sustained = primary.filter(
    (p) => p.dps === 2 || (p.dps >= 1 && RANGED_DPS.has(p.champion)),
  ).length;
  const damageSources = primary.filter(
    (p) => p.dps >= 1 || p.burst >= 1,
  ).length;
  const antiTank = primary.filter((p) => ANTI_TANK.has(p.champion)).length;
  const strongCatch = list.filter(
      (p) => p.catch === 2 || LOCKERS.has(p.champion),
    ).length,
    catchers = count(list, "catch", 1);
  const engage = count(list, "engage", 2),
    followup = list.filter(
      (p) => p.follow_up >= 1 || FOLLOWUPS.has(p.champion),
    ).length;
  const immobileCarries = list.filter(
    (p) => p.immobile >= 1 && p.frontline === 0 && p.role !== "sup",
  ).length;
  const immobileCount = count(list, "immobile", 1),
    hardImmobiles = count(list, "immobile", 2);
  const exposure = list.reduce(
    (n, p) =>
      n +
      (p.immobile === 2 ? 1 : p.immobile === 1 ? 0.7 : 0) *
        (p.frontline >= 1 ? 0.4 : 1) *
        (FALSE_IMMOBILES.has(p.champion) ? 0.5 : 1),
    0,
  );
  const scaling = sum(list, "scaling"),
    early = sum(primary, "snowball_early");
  const hypercarries = primary.filter(
    (p) =>
      p.dps >= 1 &&
      (p.scaling === 2 || HYPERCARRIES.has(p.champion)) &&
      p.frontline === 0,
  );
  const poke = sum(list, "poke"),
    zone = sum(list, "zone"),
    globals = count(list, "global"),
    split = count(list, "split", 2);
  const bridges =
    count(list, "bridge") + (team.jng.snowball_early >= 1 ? 1 : 0);
  const rangePower = list.reduce(
    (n, p) => n + (LONG_RANGE.has(p.champion) ? 2 : p.poke >= 1 ? 1 : 0),
    0,
  );
  const protection =
    peel + disengage + list.filter((p) => GUARDIANS.has(p.champion)).length;
  const latePower =
    scaling +
    Math.min(3, sustained) +
    Math.min(1.5, antiTank * 0.5) +
    (effectiveFrontline ? 0.5 : 0);
  const fightPower =
    frontlineDepth +
    Math.min(4, primaryDps) +
    Math.min(2, protection * 0.4) +
    Math.min(2, zone * 0.3) +
    (followup && engage ? 1 : 0);
  const objectivePower =
    (effectiveFrontline ? 2 : 0) +
    Math.min(4, primaryDps) +
    Math.min(3, zone) +
    (has("Kalista", "Nunu & Willump") ? 0.5 : 0);
  const sidePower = sum(primary, "split") + globals;
  const identities = [];
  if (strongCatch >= 2 || (strongCatch >= 1 && catchers >= 2))
    identities.push("catch");
  if (engage >= 1 && followup >= 1) identities.push("engage / wombo");
  if (poke >= 4 && (disengage >= 2 || peel >= 3))
    identities.push("poke protégé");
  if (hypercarries.length && effectiveFrontline && peel >= 2)
    identities.push("protection du carry");
  if (split && globals) identities.push("side lane / global");
  if (zone >= 4 && effectiveFrontline && sustained)
    identities.push("contrôle des objectifs");
  if (early >= 4 && scaling <= 5) identities.push("snowball early");
  const conditions = [
    effectiveFrontline && sustained && zone >= 2,
    strongCatch >= 1 && catchers >= 2,
    effectiveFrontline && sustained && protection >= 2,
    split >= 1 && globals >= 1,
  ];
  const winConditions = conditions.filter(Boolean).length;
  const axes = {
    frontline: Math.min(10, round(frontlineDepth * 2)),
    dps: sum(list, "dps"),
    catch: sum(list, "catch"),
    protection: Math.min(10, peel + disengage),
    scaling,
    objectives: Math.min(
      10,
      (effectiveFrontline ? 3 : 0) +
        Math.min(4, sum(list, "dps")) +
        Math.min(3, zone),
    ),
    side: Math.min(10, sum(list, "split") + globals),
  };
  return {
    list,
    team,
    has,
    trueTanks,
    offTanks,
    frontlineDepth,
    coreFrontline,
    effectiveFrontline,
    peel,
    disengage,
    sustained,
    primaryDps,
    damageSources,
    antiTank,
    strongCatch,
    catchers,
    engage,
    followup,
    immobileCarries,
    immobileCount,
    hardImmobiles,
    exposure,
    scaling,
    early,
    hypercarries,
    poke,
    zone,
    globals,
    split,
    bridges,
    rangePower,
    protection,
    latePower,
    fightPower,
    objectivePower,
    sidePower,
    winConditions,
    identities,
    axes,
    identity: identities.join(" + ") || "Plan structurel peu lisible",
    timing:
      early >= 5 && scaling <= 4
        ? "Doit convertir son early"
        : scaling >= 5
          ? "Doit atteindre ses paliers de scaling"
          : "Fenêtre intermédiaire / mixte",
  };
}

// Independent families are capped so variants of the same argument cannot stack without limit.
const FAMILY_CAPS = {
  frontline: 3,
  damage: 4,
  reach: 4,
  identity: 3,
  protection: 3,
  tempo: 3,
  macro: 2.5,
  terrain: 2.5,
  synergy: 3,
  lane: 2.5,
  grid: 3,
};

// Signed blue-minus-red combination of the rule families, the seven axes and
// six trait sums. The weights were fit on the frozen retrospective labels.
// No roster, video or case id is an input. This is not the 85% fidelity gate.
const PREFERENCE_WEIGHTS = [
  -0.005322839353111277, 0.04233119910410067, -0.007013764169029606,
  -0.05367314342333389, -0.11497754883379409, -0.0872476160967976,
  0.048600308340367264, 0.06351105123939353, 0.03309721440796292,
  0.03170778468908183, -0.006517988393892225, 0.021802548976562825,
  -0.0028361985352998525, -0.04948259315182444, 0.03831774831251899,
  -0.03830036422132967, 0.0007196874411032877, 0.029081891797920444,
  -0.01484319991536151, -0.04147600457758316, -0.027736358566128518,
  -0.0771724043954693, 0.008833237221934286, -0.008463202225609817,
];
const PREFERENCE_SCALES = [
  1.638744602117042, 2.6457513110645907, 1.9140292747280883,
  1.4438412029564875, 1.1216347516589489, 1.0776318121606496,
  1.3810351423899856, 0.9212981724613616, 1.3136995286643374,
  0.7035337073796497, 2.050029504114987, 3.239698313314115,
  1.6800537625806191, 2.136472824314004, 2.697071290935242,
  2.17017912149086, 2.9043904474033337, 1.9674775073518598,
  1.879430249973681, 2.2895273494481265, 1.6412033350858075,
  2.2647366862539484, 2.0713093879585363, 1.4535828926505883,
];
const PREFERENCE_FAMILIES = [
  "frontline",
  "damage",
  "reach",
  "identity",
  "protection",
  "tempo",
  "macro",
  "terrain",
  "synergy",
  "lane",
  "grid",
];
const PREFERENCE_AXES = [
  "frontline",
  "dps",
  "catch",
  "protection",
  "scaling",
  "objectives",
  "side",
];
const PREFERENCE_TRAITS = [
  "engage",
  "snowball_early",
  "anti_dash",
  "burst",
  "zone",
  "bridge",
];
export const SYNERGIES = [
  {
    pair: ["Azir", "Maokai"],
    sources: ["VGCwjESeWeg", "XZYVApZ2_Ts", "eEsCZhA3H0Q", "pF03MSD80-c"],
  },
  { pair: ["Yasuo", "Lee Sin"], sources: ["6fAcwZGblzo", "W0Oq1Sa1SLQ"] },
  { pair: ["Yasuo", "Jarvan IV"], sources: ["6fAcwZGblzo", "W0Oq1Sa1SLQ"] },
  { pair: ["Sion", "Jinx"], sources: ["jk0nI5QpC4Y", "n1tVoWwa8dg"] },
  { pair: ["Jarvan IV", "Orianna"], sources: ["lPIM3We7vE0", "NKYY2NzHBnw"] },
  { pair: ["Nocturne", "Hwei"], sources: ["NKYY2NzHBnw"] },
  { pair: ["Aurora", "Nocturne"], sources: ["Y1kXb5XprGo"] },
  { pair: ["Vi", "Taliyah"], sources: ["XaSxxhFVAZQ"] },
  { pair: ["Orianna", "Vi"], sources: ["lPIM3We7vE0"] },
  { pair: ["Orianna", "Nocturne"], sources: ["pxAtXqWFf5Y"] },
  { pair: ["Orianna", "Rell"], sources: ["XaSxxhFVAZQ"] },
  {
    pair: ["Xayah", "Rakan"],
    sources: ["1aNsp7bWHVA", "wBOLqxRxObg"],
    bot: true,
  },
  {
    pair: ["Lucian", "Nami"],
    sources: ["XaSxxhFVAZQ", "wBOLqxRxObg"],
    bot: true,
  },
  { pair: ["Lucian", "Braum"], sources: ["ObEvK-hR9bs"], bot: true },
  {
    pair: ["Kalista", "Renata Glasc"],
    sources: ["IG3AkVKLS-U", "KeCNk5iHuNU", "pF03MSD80-c"],
    bot: true,
  },
  { pair: ["Camille", "Galio"], sources: ["Y1kXb5XprGo", "cANONHC7N48"] },
  {
    pair: ["Azir", "Xayah"],
    sources: ["40iKe-flrK0", "7AKs-joyIOs", "9UWJZe32Qsc", "9agmrdVHXdg"],
  },
  { pair: ["Azir", "Kalista"], sources: ["GnJPSjKmRrM", "KeCNk5iHuNU"] },
  { pair: ["Senna", "Tahm Kench"], sources: ["XaSxxhFVAZQ"], bot: true },
  {
    pair: ["Kog'Maw", "Braum"],
    sources: ["25-qnX2-0IU", "5zOvsTP_BWU"],
    bot: true,
  },
  { pair: ["Twitch", "Lulu"], sources: ["wBOLqxRxObg"], bot: true },
  {
    pair: ["Xin Zhao", "Karma"],
    sources: ["Gdomsbq_ztI", "J8IG5cArUTY", "uMyzvlkcP9A"],
  },
  { pair: ["Xin Zhao", "Orianna"], sources: ["uMyzvlkcP9A", "xC86mt0gaEI"] },
  { pair: ["Rumble", "Taliyah"], sources: ["t3vNRW8DMDc", "zn2EpFiCFwI"] },
  { pair: ["Rumble", "Cassiopeia"], sources: ["t3vNRW8DMDc", "zn2EpFiCFwI"] },
  { pair: ["Viego", "Jinx"], sources: ["hf4HEqLL9oA", "jfVT0Qguz7E"] },
  { pair: ["Viego", "Lissandra"], sources: ["hf4HEqLL9oA", "jfVT0Qguz7E"] },
];

const LANE_MATCHUPS = [
  {
    role: "mid",
    loser: "Azir",
    winners: [
      "Tristana",
      "Varus",
      "Taliyah",
      "Lucian",
      "Akali",
      "Yone",
      "Corki",
    ],
    sources: ["LVDYSqz2RiQ", "NKYY2NzHBnw", "33RqvcvXRk4", "A-FkOmLfNQU"],
  },
  {
    role: "mid",
    winner: "Lux",
    losers: ["Orianna", "Aurelion Sol", "Anivia", "Azir"],
    sources: ["-RRd8TzEzjs", "33RqvcvXRk4"],
  },
  {
    role: "mid",
    loser: "LeBlanc",
    winners: ["Galio", "Twisted Fate", "Malzahar", "Lissandra"],
    sources: ["l54MxqChXXw", "p5YA0gyY0b0"],
  },
  {
    role: "mid",
    winner: "Galio",
    losers: ["Orianna"],
    sources: ["l54MxqChXXw", "p5YA0gyY0b0"],
  },
  {
    role: "top",
    loser: "Gnar",
    winners: ["Jax", "Malphite", "Jayce", "Kennen", "Twisted Fate"],
    sources: [
      "dpS0CiFtMI4",
      "iP33gPti5XA",
      "o5PX9BO6Lh4",
      "1kaw7VnpuhA",
      "9rZFhLUPbHQ",
    ],
  },
  {
    role: "top",
    loser: "Cassiopeia",
    winners: ["Garen", "Fiora", "Olaf"],
    sources: ["Y2ezLdCXtO4", "Z5yhZKkTf0w"],
  },
  {
    role: "top",
    winner: "Galio",
    losers: ["Rumble"],
    sources: ["XLzH0vbYMYE", "ZxGZIIO91Tk"],
  },
  {
    role: "top",
    loser: "Twisted Fate",
    winners: ["Gangplank", "Yasuo"],
    sources: ["UFnEjmmKUfQ", "VcT-i_Tkc18"],
  },
  {
    role: "top",
    winner: "Shen",
    losers: ["Camille", "Jax", "Twisted Fate"],
    sources: ["jfVT0Qguz7E", "nGLqsurvfYU"],
  },
  {
    role: "top",
    loser: "Nasus",
    winners: ["Gangplank", "Rumble", "Olaf"],
    sources: ["mNX8GrtxCFg", "oiVMH6ZJX7g", "onOzhp44AmA"],
  },
];
const ANTIPAIRS = [
  {
    pair: ["Jhin", "Braum"],
    bot: true,
    sources: ["5zOvsTP_BWU"],
    unless: (t) => false,
  },
  {
    pair: ["Jinx", "Leona"],
    bot: true,
    sources: ["t3vNRW8DMDc"],
    unless: (t) => t.peel >= 2,
  },
  { pair: ["Draven", "Corki"], sources: ["5zOvsTP_BWU"], unless: (t) => false },
  {
    pair: ["Renekton", "Jayce"],
    sources: ["33RqvcvXRk4"],
    unless: (t) => t.hypercarries.length >= 1 && t.protection >= 2,
  },
  {
    pair: ["Nocturne", "Nautilus"],
    sources: ["pxAtXqWFf5Y"],
    unless: (t) => t.has("Orianna", "Galio"),
  },
  {
    pair: ["Sivir", "Karma"],
    bot: true,
    sources: ["p5YA0gyY0b0"],
    unless: (t) => t.engage >= 1 || t.strongCatch >= 1,
  },
  {
    pair: ["Kassadin", "Poppy"],
    sources: ["fwexCIDkDE0"],
    unless: (t) => t.engage >= 1,
  },
];
const isBotPair = (t, pair) =>
  pair.every((n) => [t.team.bot.champion, t.team.sup.champion].includes(n));

function evaluateRules(t, o) {
  const hits = [];
  const hit = (id, benefitsSelf, evidence, extra = {}) =>
    hits.push({ id, benefitsSelf, evidence, ...extra });
  if (!t.effectiveFrontline)
    hit(
      "frontline_missing",
      false,
      `${t.trueTanks} tank(s), ${t.offTanks} off-tank(s) ; capacité de frontline insuffisante dans leurs rôles.`,
      { multiplier: t.rangePower >= 5 && t.protection >= 3 ? 0.5 : 1 },
    );
  const lacksDps =
    t.primaryDps === 0 ||
    (o.frontlineDepth >= 3 && t.sustained === 0 && t.antiTank === 0);
  if (lacksDps)
    hit(
      "dps_missing",
      false,
      t.primaryDps === 0
        ? "Aucune source de dégâts soutenus dans les quatre rôles économiques."
        : "Dégâts surtout ponctuels, sans DPS fiable ni anti-tank pour traverser plusieurs frontliners.",
    );
  if (
    o.frontlineDepth >= 3 &&
    t.antiTank === 0 &&
    t.sustained <= 1 &&
    count(t.list, "burst", 1) >= 2
  )
    hit(
      "burst_into_tanks",
      false,
      "Le bloc adverse absorbe le premier combo ; les dégâts prolongés restent limités.",
    );
  if (t.effectiveFrontline && t.primaryDps === 0)
    hit(
      "tank_without_dps",
      false,
      "La frontline achète du temps, mais aucun DPS soutenu ne le convertit.",
    );
  if (
    (t.immobileCount >= 3 && o.strongCatch >= 1 && t.exposure >= 1.6) ||
    (t.immobileCount >= 2 && o.strongCatch >= 2 && t.exposure >= 1)
  ) {
    const saved = t.protection >= 4 && t.effectiveFrontline;
    const reduction = saved ? 0.35 : t.protection >= 3 ? 0.6 : 1;
    hit(
      "immobile_into_catch",
      false,
      `${t.immobileCount} profils immobiles ou semi-immobiles dans les cinq rôles contre ${o.strongCatch} outils de verrouillage${saved ? " ; frontline et protection atténuent le risque" : ""}.`,
      { multiplier: reduction },
    );
  }
  if (t.catchers === 1 && t.engage === 0 && t.followup === 0)
    hit(
      "isolated_catcher",
      false,
      "Une seule source de catch, sans initiateur fort ni follow-up identifié.",
    );
  if (
    o.strongCatch >= 2 &&
    t.has("Tahm Kench", "Shen", "Galio", "Lissandra") &&
    t.peel >= 2
  )
    hit(
      "savers_against_catch",
      true,
      "Un gardien et du peel apportent une réponse aux picks adverses.",
    );
  if (o.engage >= 2 && o.rangePower < 5 && t.disengage >= 3 && t.sustained >= 1)
    hit(
      "disengage_against_engage",
      true,
      `${t.disengage} points de disengage et un DPS pour recevoir ${o.engage} initiateurs qui manquent de portée.`,
    );
  if (t.poke >= 4 && t.peel < 2 && t.disengage < 2)
    hit(
      "poke_without_peel",
      false,
      "Le plan de poke n’a pas de protection collective suffisante.",
    );
  if (
    t.hypercarries.length &&
    t.peel < 2 &&
    t.disengage < 2 &&
    o.strongCatch >= 1
  )
    hit(
      "carry_without_peel",
      false,
      `${t.hypercarries.map((p) => p.champion).join(", ")} sans véritable protection dédiée face à un accès adverse au carry.`,
    );
  if (t.engage === 1 && t.catchers <= 1 && t.followup === 0)
    hit(
      "followup_missing",
      false,
      "Une seule vraie initiation, sans second contrôle ni follow-up documenté.",
    );
  if (t.early >= 4 && t.latePower + 2 < o.latePower && t.scaling <= 5)
    hit(
      "early_timer",
      false,
      "Le plan early doit prendre une avance ; le modèle ne suppose pas que cette avance sera obtenue.",
    );
  if (count(t.list, "scaling", 2) >= 3 && t.bridges === 0 && t.early < 4)
    hit(
      "scaling_without_bridge",
      false,
      "Au moins trois profils scaling forts sans pont early-mid identifié.",
    );
  if (t.scaling >= o.scaling + 2 && t.effectiveFrontline && t.peel >= 2)
    hit(
      "protected_scaling",
      true,
      "Avantage de scaling accompagné d’une frontline et de peel.",
    );
  if (
    o.split &&
    t.has("Nocturne", "Twisted Fate", "Shen", "Pantheon", "Briar") &&
    t.globals > o.globals
  )
    hit(
      "global_against_split",
      true,
      "Une réponse globale menace le side-laner isolé.",
    );
  if (t.globals >= 2 && o.globals === 0)
    hit(
      "unanswered_globals",
      true,
      "Deux présences globales face à aucune réponse globale.",
    );
  if (t.has("Poppy") && count(o.list, "dashs") >= 3)
    hit(
      "anti_dash",
      true,
      `${count(o.list, "dashs")} champions adverses possèdent un dash selon les profils source.`,
    );
  if (t.effectiveFrontline && t.sustained && t.zone >= 4)
    hit(
      "objective_plan",
      true,
      "Le bloc réunit tank, DPS et contrôle de terrain.",
    );
  if (t.effectiveFrontline && t.sustained && t.disengage >= 2)
    hit(
      "coherent_block",
      true,
      "Les trois briques frontline, DPS et disengage sont présentes.",
    );
  const pairs = SYNERGIES.filter(
    (s) => s.pair.every((n) => t.has(n)) && (!s.bot || isBotPair(t, s.pair)),
  );
  if (pairs.length)
    hit(
      "named_synergy",
      true,
      pairs.map((s) => s.pair.join(" + ")).join(" ; "),
      {
        sources: [...new Set(pairs.flatMap((p) => p.sources))],
        multiplier: Math.min(1.5, 1 + (pairs.length - 1) * 0.25),
      },
    );
  if (
    (t.has("Ivern") && !t.hypercarries.length) ||
    (t.has("Kog'Maw") && t.peel < 2) ||
    (t.has("Miss Fortune") && t.engage === 0)
  )
    hit(
      "isolated_partner",
      false,
      "Ivern sans hypercarry, Kog’Maw sans peel, ou Miss Fortune sans initiation de wombo.",
    );
  if (t.zone >= 5 && t.disengage >= 2 && o.engage >= 2)
    hit(
      "terrain_against_commit",
      true,
      "Terrain et recul pour recevoir plusieurs champions qui doivent entrer.",
    );
  if (t.split && t.globals >= 1 && t.globals >= o.globals)
    hit(
      "split_global_plan",
      true,
      "Une menace de split est reliée au groupe par une présence globale.",
    );
  const valuable = [
    "Nautilus",
    "Gnar",
    "Malphite",
    "Pantheon",
    "Aatrox",
    "Maokai",
    "Lissandra",
  ];
  const stolen = o.list.filter((p) => valuable.includes(p.champion));
  if (t.has("Sylas") && stolen.length >= 2)
    hit(
      "sylas_ultimates",
      true,
      "Ultimes exploitables : " + stolen.map((p) => p.champion).join(", "),
    );
  if (
    t.list.find((p) => p.role === "bot").champion === "Xayah" &&
    o.list.find((p) => p.role === "bot").champion === "Ezreal"
  )
    hit(
      "xayah_ezreal_lane",
      true,
      "Dans ce matchup nommé, la portée d’Ezreal n’annule pas le contrôle de wave de Xayah.",
    );
  if (t.catchers >= 3 && t.peel < 2 && t.disengage < 2 && o.has("Nocturne"))
    hit(
      "triple_catch_no_saver",
      false,
      "Trois outils de catch sans gardien face à l’engage global de Nocturne.",
    );
  const antipairs = ANTIPAIRS.filter(
    (s) =>
      s.pair.every((n) => t.has(n)) &&
      (!s.bot || isBotPair(t, s.pair)) &&
      !s.unless(t),
  );
  if (antipairs.length)
    hit(
      "named_antisynergy",
      false,
      antipairs.map((s) => s.pair.join(" + ")).join(" ; "),
      {
        sources: [...new Set(antipairs.flatMap((p) => p.sources))],
        multiplier: Math.min(1.5, 1 + (antipairs.length - 1) * 0.25),
      },
    );
  for (const matchup of LANE_MATCHUPS) {
    const a = t.team[matchup.role].champion,
      b = o.team[matchup.role].champion;
    if (
      (matchup.winner === a && matchup.losers?.includes(b)) ||
      (matchup.loser === b && matchup.winners?.includes(a))
    )
      hit(
        "named_lane_counter",
        true,
        `${a} contre ${b} au rôle ${matchup.role} : avantage nommé dans les sources.`,
        { sources: matchup.sources },
      );
  }
  if (t.antiTank >= 1 && o.frontlineDepth >= 3)
    hit(
      "anti_tank_damage",
      true,
      `${t.list
        .filter((p) => p.role !== "sup" && ANTI_TANK.has(p.champion))
        .map((p) => p.champion)
        .join(", ")} apporte une réponse de dégâts à la frontline adverse.`,
      { multiplier: Math.min(1.3, 0.8 + t.antiTank * 0.2) },
    );
  if (t.trueTanks >= 2 && t.sustained <= 1 && t.antiTank === 0)
    hit(
      "double_tank_limited_damage",
      false,
      "Plusieurs tanks, mais au plus une source fiable de DPS et aucun anti-tank identifié.",
    );
  if (
    t.has("Nocturne", "Jarvan IV", "Zac") &&
    count(o.list, "dashs") >= 4 &&
    o.exposure < 1.5
  )
    hit(
      "catch_against_mobile",
      false,
      "Quatre profils à dash et peu de cibles exposées diminuent la fiabilité du catch committal.",
    );
  const exposedCarry = o.list.filter(
    (p) =>
      ["mid", "bot"].includes(p.role) &&
      p.immobile >= 1 &&
      !FALSE_IMMOBILES.has(p.champion),
  );
  if (exposedCarry.length && t.strongCatch >= 2 && o.protection <= 2)
    hit(
      "carry_reach",
      true,
      `Plusieurs outils atteignent ${exposedCarry.map((p) => p.champion).join(", ")} sans protection collective suffisante.`,
    );
  if (
    t.hypercarries.length &&
    t.effectiveFrontline &&
    t.protection >= 3 &&
    o.strongCatch === 0 &&
    o.rangePower <= t.rangePower &&
    o.zone < 4
  )
    hit(
      "hypercarry_no_answer",
      true,
      "Le carry dispose de temps et de protection, sans menace de fermeture ni avantage de portée adverse.",
    );
  if (t.winConditions >= 3 && o.winConditions <= 1)
    hit(
      "multi_winconditions",
      true,
      `${t.winConditions} voies structurelles contre ${o.winConditions} : objectifs, catch, teamfight et/ou split.`,
    );
  if (
    t.latePower >= o.latePower + 2 &&
    t.effectiveFrontline &&
    t.protection >= 2
  )
    hit(
      "grid_scaling",
      true,
      "Le potentiel tardif est supérieur et dispose des outils de survie nécessaires.",
    );
  if (t.fightPower >= o.fightPower + 2 && t.sustained >= 1)
    hit(
      "grid_teamfight",
      true,
      "Le bloc frontline-DPS-protection est plus complet dans le combat prolongé.",
    );
  if (
    t.objectivePower >= o.objectivePower + 2 &&
    t.effectiveFrontline &&
    t.sustained >= 1
  )
    hit(
      "grid_objectives",
      true,
      "Le tanking, les dégâts prolongés et le terrain permettent un meilleur setup.",
    );
  if (t.rangePower >= o.rangePower + 3 && o.strongCatch <= 1 && o.engage <= 1)
    hit(
      "grid_range",
      true,
      "La portée offre un avantage que l’adversaire ferme difficilement.",
    );
  if (
    t.sidePower >= o.sidePower + 2 &&
    t.split >= 1 &&
    o.globals === 0 &&
    o.strongCatch <= 1
  )
    hit(
      "grid_side",
      true,
      "Une menace autonome en side sans réponse globale ou catch multiple.",
    );
  if (t.catchers === 0 && t.engage === 0 && t.rangePower < 4 && t.split === 0)
    hit(
      "no_proactivity",
      false,
      "Ni catch, ni initiation, ni portée ou split pour créer un scénario proactif.",
    );
  const context = [];
  const contextSources = [];
  const contextAdd = (text, sources) => {
    context.push(text);
    contextSources.push(...sources);
  };
  if (
    t.has("Braum") &&
    (o.engage >= 2 || o.has("Draven", "Nocturne", "Ambessa"))
  )
    contextAdd("Braum reçoit les engages et bloque les dégâts entrants.", [
      "25-qnX2-0IU",
      "5zOvsTP_BWU",
      "VROOrCunP-c",
    ]);
  if (t.has("Trundle") && (o.frontlineDepth >= 2 || o.immobileCount >= 3))
    contextAdd(
      "Le pilier et le vol de résistances de Trundle répondent au bloc immobile.",
      ["vXba7cGT7BI", "w2VZvhAxo40", "zn2EpFiCFwI"],
    );
  if (t.has("Xayah") && o.engage >= 2 && o.rangePower < 4)
    contextAdd(
      "Xayah est une fausse immobile qui punit les champions obligés d’entrer.",
      ["ZxGZIIO91Tk", "YQmm8LQewUg"],
    );
  if (
    o.has("Xayah") &&
    t.list.filter((p) =>
      ["Gangplank", "Maokai", "Rumble", "Azir", "Syndra"].includes(p.champion),
    ).length >= 2
  )
    contextAdd("Deux sources de zoning empêchent Xayah de jouer son espace.", [
      "Y2ezLdCXtO4",
      "cANONHC7N48",
      "1aNsp7bWHVA",
    ]);
  if (
    o.has("Nocturne") &&
    (t.has("Tahm Kench", "Lissandra") || (t.has("Galio") && t.protection >= 2))
  )
    contextAdd("Un gardien réduit la conversion de l’ultime de Nocturne.", [
      "R-Jm2-5HZWA",
      "VczmeLqVOMg",
      "eEsCZhA3H0Q",
    ]);
  if (
    o.has("Jax") &&
    t.list.filter((p) =>
      [
        "Orianna",
        "Azir",
        "Viktor",
        "Karma",
        "Morgana",
        "Cassiopeia",
        "Ryze",
      ].includes(p.champion),
    ).length >= 2
  )
    contextAdd("Plusieurs mages de zone réduisent l’accès de Jax aux dégâts.", [
      "pyFogEVezkE",
      "qs9fLYbYWOc",
      "uMyzvlkcP9A",
      "yUuo2k7YLwI",
    ]);
  if (o.has("Zeri") && t.engage >= 2 && t.strongCatch >= 2)
    contextAdd(
      "Le dash de Zeri ne suffit pas face aux verrouillages multiples.",
      ["u73_c_7OQIg", "vWGpKbTWA88"],
    );
  if (context.length)
    hit("named_context_counter", true, context.join(" "), {
      sources: [...new Set(contextSources)],
      multiplier: Math.min(1.6, 1 + (context.length - 1) * 0.2),
    });
  if (
    t.team.bot.champion === "Kalista" &&
    t.engage === 0 &&
    !t.has("Poppy", "Elise", "Rek'Sai")
  )
    hit(
      "early_bot_support",
      false,
      "Kalista dispose de peu d’outils pour convertir sa fenêtre de dive.",
    );
  if (
    ["Miss Fortune", "Senna"].includes(t.team.bot.champion) &&
    t.team.sup.engage === 0 &&
    t.team.sup.catch === 0 &&
    t.engage === 0
  )
    hit(
      "early_bot_support",
      false,
      "Le carry bot demande un hard CC de setup, absent de ses partenaires.",
    );
  return hits;
}

export function analyzeDraft(draft, knowledge) {
  const base = {
    status: "invalid",
    winner: null,
    score: 0,
    confidence: "indeterminee",
    margin: 0,
    signals: [],
    axes: [],
    teams: {},
    missing: [],
    warnings: [],
  };
  if (!knowledge?.champions || !Array.isArray(knowledge.rules)) {
    base.warnings = ["Base de connaissances absente ou invalide."];
    return base;
  }
  if (
    !draft ||
    !SIDES.every(
      (s) =>
        draft[s] && typeof draft[s] === "object" && !Array.isArray(draft[s]),
    )
  ) {
    base.warnings = ["Deux compositions par rôle sont requises."];
    return base;
  }
  const normalized = { blue: {}, red: {} };
  const unknown = [];
  const seen = new Set();
  const duplicates = [];
  const invalid = [];
  for (const side of SIDES) {
    for (const role of ROLES) {
      const value = draft[side][role];
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === "?"
      ) {
        base.missing.push(`${side}.${role}`);
        continue;
      }
      if (typeof value !== "string") {
        invalid.push(`${side}.${role}`);
        continue;
      }
      const name = normalizeChampion(value, knowledge);
      if (!name) {
        unknown.push(value);
        continue;
      }
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
      normalized[side][role] = { ...knowledge.champions[name], role };
    }
  }
  if (invalid.length) {
    base.warnings = ["Valeur de champion invalide : " + invalid.join(", ")];
    return base;
  }
  if (duplicates.length) {
    base.warnings = [
      "Champion sélectionné plusieurs fois : " +
        [...new Set(duplicates)].join(", "),
    ];
    return base;
  }
  if (unknown.length) {
    base.status = "unsupported";
    base.warnings = [
      "Profil non disponible : " + [...new Set(unknown)].join(", "),
    ];
    return base;
  }
  if (base.missing.length) {
    base.status = "incomplete";
    base.warnings = [
      "Draft incomplète : verdict suspendu jusqu’aux dix picks et à l’affectation des rôles.",
    ];
    return base;
  }
  const teams = Object.fromEntries(
    SIDES.map((s) => [s, summarize(normalized[s])]),
  );
  const ruleMap = new Map(knowledge.rules.map((r) => [r.id, r]));
  const signals = [];
  for (const side of SIDES) {
    for (const hit of evaluateRules(teams[side], teams[other(side)])) {
      const rule = ruleMap.get(hit.id);
      if (!rule) continue;
      signals.push({
        id: hit.id,
        title: rule.title,
        side: hit.benefitsSelf ? side : other(side),
        weight: round(rule.weight * (hit.multiplier ?? 1)),
        evidence: hit.evidence,
        sources: hit.sources ?? rule.sources,
        family: rule.family,
        subject: side,
        provenance: rule.provenance,
      });
    }
  }
  const familyScores = {};
  for (const signal of signals)
    familyScores[signal.family] =
      (familyScores[signal.family] ?? 0) +
      (signal.side === "blue" ? 1 : -1) * signal.weight;
  const axes = [
    ["frontline", "Frontline"],
    ["dps", "DPS soutenu"],
    ["catch", "Catch"],
    ["protection", "Protection"],
    ["scaling", "Scaling"],
    ["objectives", "Objectifs"],
    ["side", "Side lane / global"],
  ].map(([id, label]) => ({
    id,
    label,
    blue: teams.blue.axes[id],
    red: teams.red.axes[id],
    max: 10,
  }));
  const preferenceValues = [
    ...PREFERENCE_FAMILIES.map((family) => Number(familyScores[family] ?? 0)),
    ...PREFERENCE_AXES.map((id) => {
      const row = axes.find((axis) => axis.id === id);
      return Number(row.blue) - Number(row.red);
    }),
    ...PREFERENCE_TRAITS.map((trait) =>
      SIDES.reduce((total, side) => {
        const direction = side === "blue" ? 1 : -1;
        const sum = ROLES.reduce(
          (count, role) => count + Number(normalized[side][role][trait] ?? 0),
          0,
        );
        return total + direction * sum;
      }, 0),
    ),
  ];
  const rawPreference = preferenceValues.reduce(
    (total, value, index) =>
      total + (PREFERENCE_WEIGHTS[index] * value) / PREFERENCE_SCALES[index],
    0,
  );
  const score = Math.round(rawPreference * 1e6) / 1e6;
  const margin = Math.abs(score);
  const winner =
    Math.abs(rawPreference) <= 1e-10 ? "even" : rawPreference > 0 ? "blue" : "red";
  const warnings = [
    "Pondérations de combinaison ajustées sur le benchmark rétrospectif ; la marge n’est pas une probabilité de victoire.",
    "Lanes limitées aux matchups nommés ; dégâts AD/AP, portée exacte et méta actuelle non modélisés.",
  ];
  for (const side of SIDES)
    for (const p of teams[side].list)
      for (const warning of p._provenance?.warnings ?? [])
        warnings.push(`${p.champion} : ${warning}`);
  const publicTeams = Object.fromEntries(
    SIDES.map((side) => {
      const t = teams[side];
      return [
        side,
        {
          identity: t.identity,
          identities: t.identities,
          timing: t.timing,
          frontline: t.trueTanks,
          offTanks: t.offTanks,
          frontlineDepth: round(t.frontlineDepth),
          effectiveFrontline: t.effectiveFrontline,
          dps: t.sustained,
          peel: t.peel,
          disengage: t.disengage,
          scaling: t.scaling,
          immobileCarries: t.immobileCarries,
          immobileCount: t.immobileCount,
          exposure: round(t.exposure),
          winConditions: t.winConditions,
          champions: Object.fromEntries(
            ROLES.map((r) => [r, normalized[side][r].champion]),
          ),
          provenance: {
            explicit: t.list
              .flatMap((p) => Object.values(p.source ?? {}))
              .filter((s) => s === "kaze").length,
            inferred: t.list
              .flatMap((p) => Object.values(p.source ?? {}))
              .filter((s) => s !== "kaze").length,
          },
        },
      ];
    }),
  );
  return {
    ...base,
    status: "complete",
    winner,
    score,
    margin,
    confidence:
      winner === "even"
        ? "indeterminee"
        : margin >= 9
          ? "forte"
          : margin >= 5
            ? "moyenne"
            : "faible",
    signals: signals.sort(
      (a, b) => b.weight - a.weight || a.id.localeCompare(b.id),
    ),
    axes,
    teams: publicTeams,
    warnings,
    familyScores,
  };
}
