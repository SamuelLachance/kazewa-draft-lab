import { normalizeChampion, ROLES } from "./src/engine.mjs";
import { compositionFromText, foldChampion, swapRoles } from "./src/quick-draft.mjs";
import {
  advise,
  applyAction,
  coachContext,
  createSession,
  undo,
} from "./src/draft-coach.mjs";
import { playableRoles, presence } from "./src/coach.mjs";
import { LANES } from "./src/lanes.mjs";
import { championReads, indexMemory } from "./src/memory.mjs";
import { cardRelations } from "./src/relations.mjs";
import { playedGames, resultKey, shardOf } from "./src/results.mjs";
import { judgeDraft } from "./src/verdict.mjs";
import {
  emptyDraft,
  validateEndpoint,
  draftFromHash,
  buildDraftHash,
  validateClientSnapshot,
  getLiveReadiness,
  displayedVerdict,
} from "./src/presentation.mjs";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const SIDE_LABEL = { blue: "Côté bleu", red: "Côté rouge" };
const ROLE_LABEL = {
  top: "TOP",
  jng: "JUNGLE",
  mid: "MID",
  bot: "ADC",
  sup: "SUPP",
};
const STATUS_LABEL = {
  draft: "DRAFT EN COURS",
  in_game: "EN PARTIE",
  finished: "TERMINÉ",
};
const fallbackConfig = {
  liveApiUrl: "",
  pollIntervalMs: 15000,
  staleAfterMs: 90000,
  assetPatch: "16.21.1",
};
let knowledge,
  evaluation,
  memory,
  memoryIndex = null,
  model = null,
  cards = null,
  relations = null,
  coachData = null,
  coachBrain = null,
  championAssets,
  config = fallbackConfig;
let cardChampion = null;
let view = "lab",
  labMode = "roles",
  coach = createSession("first"),
  coachFocus = "self",
  coachQuery = "",
  coachLane = "all",
  draft = emptyDraft(),
  quickParsed = { blue: null, red: null },
  quickSwap = null,
  origin = "",
  snapshot = null,
  selectedMatchId = null;
let endpoint = "",
  pollTimer = null,
  freshnessTimer = null,
  toastTimer = null,
  fetchController = null;
let feedError = null,
  exampleIndex = -1,
  requestGeneration = 0;
const defaultEndpoint = () =>
  config.liveApiUrl ||
  (location.hostname.endsWith(".github.io")
    ? ""
    : new URL("./api/live", location.href).href);

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3500);
}
async function getJSON(url, optional = false) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}

const videoLinks = (ids, limit = 3) =>
  (ids || [])
    .filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id))
    .slice(0, limit)
    .map(
      (id, i) =>
        `<a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener noreferrer" aria-label="Source vidéo ${i + 1}, ${esc(id)}">↗ ${esc(id)}</a>`,
    )
    .join("");
const TIMING_LABEL = {
  draft: "Avis donné pendant la draft",
  review: "Avis donné dans sa revue du match",
  late: "Avis donné après coup",
};
const TAG_LABEL = {
  frontline: "Frontline",
  damage: "Dégâts",
  range: "Portée",
  engage: "Engage",
  disengage_peel: "Peel et disengage",
  answer: "Réponse à la menace",
  identity_clear: "Plan de jeu",
  identity_matchup: "Identité contre identité",
  scaling: "Scaling",
  early: "Early",
  lane: "Matchup de lane",
  jungle: "Jungle",
  synergy: "Synergie",
  meta_strong: "Pick fort",
  meta_weak: "Pick faible",
  pick_order: "Ordre des picks",
  players_team: "Joueurs",
  other: "Remarque",
};
const CONFIDENCE_LABEL = {
  high: "élevée",
  medium: "moyenne",
  low: "faible",
  derived: "déduite du kit",
};
function sourceLinks(sources, limit = 2) {
  return (sources || [])
    .filter((source) => /^[a-zA-Z0-9_-]{11}$/.test(source?.video || ""))
    .slice(0, limit)
    .map((source) => {
      const at =
        Number.isFinite(source.ts) && source.ts > 0
          ? `&t=${Math.floor(source.ts)}s`
          : "";
      return `<a href="https://www.youtube.com/watch?v=${esc(source.video)}${at}" target="_blank" rel="noopener noreferrer">↗ ${esc(source.title || "Vidéo de Kazewa")}${at ? " · au moment du verdict" : ""}</a>`;
    })
    .join("");
}
// Results of professional games already played, fetched one small file at a
// time for the draft on screen. A draft is judged at once with what is loaded;
// when its file arrives the current view is drawn again.
const resultFiles = new Map();
const resultLoading = new Set();
const resultRetryAt = new Map();
function playedFor(value) {
  const found = resultKey(value);
  if (!found) return null;
  const name = shardOf(found.key);
  if (resultFiles.has(name)) return playedGames(value, resultFiles.get(name));
  if (!resultLoading.has(name) && Date.now() >= (resultRetryAt.get(name) ?? 0)) {
    resultLoading.add(name);
    getJSON(`./data/pro-results/${name}.json`, true).then((data) => {
      resultLoading.delete(name);
      // Not loaded: nothing is stored, and the next verdict asks again, but
      // not before a moment has passed.
      if (!data) {
        resultRetryAt.set(name, Date.now() + 30000);
        return;
      }
      resultFiles.set(name, data);
      refreshVerdict();
    });
  }
  return null;
}
function refreshVerdict() {
  if (view === "lab") {
    const judgement = judge(draft);
    renderQuickVerdict(judgement);
    renderResult(judgement);
  } else if (view === "coach") renderCoach();
  else if (view === "live") renderLive();
}
// `live`: the draft comes from a game in progress. Another game played with
// the same ten champions says nothing about this one: no result reading.
function judge(value, { live = false } = {}) {
  return judgeDraft(value, {
    knowledge,
    memory: memoryIndex,
    model,
    relations,
    played: live ? null : playedFor,
  });
}
const frenchDate = (text) => {
  const date = new Date(text + "T12:00:00Z");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
// "T1 vs Gen.G · LCK · 14 avril 2024 · partie 3", blue side first.
function playedLine(game) {
  const parts = [];
  if (game?.teams?.blue && game?.teams?.red)
    parts.push(`${game.teams.blue} vs ${game.teams.red}`);
  if (game?.league) parts.push(game.league);
  if (game?.date && frenchDate(game.date)) parts.push(frenchDate(game.date));
  if (game?.game) parts.push(`partie ${game.game}`);
  return parts.join(" · ");
}
function sidePhrase(side, kazewa, names = SIDE_LABEL) {
  const plain = side === "blue" ? "le côté bleu" : "le côté rouge";
  const custom =
    names[side] && names[side] !== SIDE_LABEL[side]
      ? names[side]
      : kazewa?.teams?.[side];
  return custom
    ? `la draft de ${custom} (${side === "blue" ? "côté bleu" : "côté rouge"})`
    : plain;
}
function matchLine(kazewa) {
  const parts = [];
  if (kazewa?.teams?.blue && kazewa?.teams?.red)
    parts.push(`${kazewa.teams.blue} vs ${kazewa.teams.red}`);
  if (kazewa?.match?.league) parts.push(kazewa.match.league);
  if (kazewa?.match?.date && frenchDate(kazewa.match.date))
    parts.push(frenchDate(kazewa.match.date));
  if (kazewa?.match?.patch) parts.push(`patch ${kazewa.match.patch}`);
  if (kazewa?.match?.game) parts.push(`partie ${kazewa.match.game}`);
  return parts.join(" · ");
}
function canonicalDraft(value) {
  const result = emptyDraft();
  for (const side of ["blue", "red"])
    for (const role of ROLES) {
      const name = value?.[side]?.[role];
      result[side][role] =
        normalizeChampion(name, knowledge) ||
        (typeof name === "string" ? name : "");
    }
  return result;
}
function assetId(name) {
  return (
    championAssets?.champions?.find((c) => c.name === name)?.id ||
    {
      Wukong: "MonkeyKing",
      "Nunu & Willump": "Nunu",
      "Renata Glasc": "Renata",
      "K'Sante": "KSante",
      "Bel'Veth": "Belveth",
      "Cho'Gath": "Chogath",
      "Kai'Sa": "Kaisa",
      "Kha'Zix": "Khazix",
      "Kog'Maw": "KogMaw",
      "Vel'Koz": "Velkoz",
      "Rek'Sai": "RekSai",
      LeBlanc: "Leblanc",
      Fiddlesticks: "Fiddlesticks",
    }[name] ||
    name.replace(/[^a-zA-Z0-9]/g, "")
  );
}
function portrait(name) {
  const initials = name ? name.slice(0, 1) : "+";
  return `<span class="champion-portrait"><span aria-hidden="true">${esc(initials)}</span>${name ? `<img src="https://ddragon.leagueoflegends.com/cdn/${esc(config.assetPatch)}/img/champion/${esc(assetId(name))}.png" alt="" width="39" height="39" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
function handleImageErrors(root = document) {
  for (const img of root.querySelectorAll(".champion-portrait img"))
    img.addEventListener("error", () => img.classList.add("image-failed"), {
      once: true,
    });
}
function profileLine(name) {
  const p = knowledge.champions[name];
  if (!p) return "En attente du pick";
  const tag = cards?.[name]?.tag;
  if (tag) return tag;
  // No card loaded: describe the profile from every trait it carries.
  const strong = [];
  const light = [];
  const traits = [
    ["frontline", "Vrai tank", "Off-tank"],
    ["catch", "Catch", "Catch d’appoint"],
    ["engage", "Engage", "Engage court"],
    ["dps", "DPS", "Dégâts soutenus"],
    ["burst", "Burst", "Burst"],
    ["scaling", "Scaling", "Scaling"],
    ["peel", "Peel", "Peel"],
    ["poke", "Poke", "Poke"],
    ["zone", "Zone", "Zone"],
    ["split", "Split", "Side lane"],
    ["snowball_early", "Early", "Early"],
    ["disengage", "Disengage", "Disengage"],
    ["follow_up", "Follow-up", "Follow-up"],
    ["global", "Global", "Global"],
  ];
  for (const [key, high, low] of traits) {
    if (p[key] >= 2) strong.push(high);
    else if (p[key] === 1) light.push(low);
  }
  return [...strong, ...light].slice(0, 3).join(" · ") || "Profil généraliste";
}
function teamHTML(
  side,
  picks,
  { readonly = false, name = SIDE_LABEL[side] } = {},
) {
  const count = ROLES.filter((role) => picks?.[role]).length;
  const selected = new Set(
    ["blue", "red"]
      .flatMap((s) => Object.values(draft[s] || {}))
      .filter(Boolean),
  );
  const options = Object.keys(knowledge.champions).sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  return `<div class="team-heading"><div class="team-name-group"><span class="team-icon" aria-hidden="true">${side === "blue" ? "◇" : "◈"}</span><div><span class="team-side">${side === "blue" ? "BLUE SIDE" : "RED SIDE"}</span><h3 class="team-name">${esc(name)}</h3></div></div><span class="pick-count">${count} / 5</span></div>${ROLES.map(
    (role) => {
      const champion = picks?.[role] || "",
        canonical = normalizeChampion(champion, knowledge);
      const select = readonly
        ? `<div class="live-champion-name">${esc(champion || "Pick à venir")}</div>`
        : `<select class="champion-select" data-side="${side}" data-role="${role}" aria-label="${ROLE_LABEL[role]} — ${SIDE_LABEL[side]}"><option value="">Choisir un champion</option>${champion && !canonical ? `<option value="${esc(champion)}" selected>${esc(champion)} (hors corpus)</option>` : ""}${options.map((n) => `<option value="${esc(n)}"${n === champion ? " selected" : ""}${selected.has(n) && n !== champion ? " disabled" : ""}>${esc(n)}</option>`).join("")}</select>`;
      const card =
        !readonly && canonical && cards?.[canonical]
          ? `<button type="button" class="card-button${cardChampion === canonical ? " is-active" : ""}" data-card="${esc(canonical)}" aria-label="Fiche Kazewa de ${esc(canonical)}" aria-pressed="${cardChampion === canonical}">fiche</button>`
          : "";
      return `<div class="champion-row"><span class="role-name">${ROLE_LABEL[role]}</span>${portrait(canonical || champion)}<div class="champion-field">${select}<div class="champion-subtitle">${esc(champion ? (canonical ? profileLine(canonical) : "Champion inconnu") : "En attente du pick")}</div></div>${card}</div>`;
    },
  ).join("")}`;
}
function renderTeams() {
  for (const side of ["blue", "red"])
    $(`#${side}-team`).innerHTML = teamHTML(side, draft[side]);
  handleImageErrors();
  $("#draft-origin").textContent =
    origin || "Choisis les dix champions par rôle.";
  renderChampionCard();
}
function renderChampionCard() {
  const node = $("#champion-card");
  if (!node) return;
  const inDraft = ["blue", "red"].some((side) =>
    Object.values(draft[side] || {}).includes(cardChampion),
  );
  if (!inDraft) cardChampion = null;
  const card = cardChampion ? cards?.[cardChampion] : null;
  if (!card || view !== "lab" || labMode === "quick") {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const line = (label, text) =>
    text ? `<p><strong>${label}</strong> ${esc(text)}</p>` : "";
  const reads = championReads(cardChampion, memoryIndex, { limit: 4 });
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>${esc(cardChampion)} · ${esc(card.tag)}</h3><button type="button" class="icon-button" data-close-card aria-label="Fermer la fiche">×</button></div><p>${esc(card.job)}</p>${card.identities.length ? `<ul class="card-identities">${card.identities.map((item) => `<li><strong>${esc(item.identity)}</strong> ${esc(item.text)}</li>`).join("")}</ul>` : ""}${line("Bon avec, bon quand :", card.good)}${line("Puni par :", card.bad)}${line("Tempo :", card.tempo)}${line("En draft :", card.draft)}${reads.length ? `<h4>Ses lectures dans les drafts qu’il a jugées</h4><ul class="card-reads">${reads.map((read) => `<li>${esc(read.read)} <span class="source-links">${sourceLinks([{ video: read.video, title: read.title, ts: read.ts }], 1)}</span></li>`).join("")}</ul>` : ""}<p class="fine-print">${card.sources > 0 ? `Fiche résumée à partir de ${esc(card.sources)} extrait${card.sources > 1 ? "s" : ""} de ses vidéos · fiabilité ${esc(CONFIDENCE_LABEL[card.confidence] || card.confidence)}.` : "Kazewa n’a pas commenté ce champion dans le corpus : fiche déduite de son kit."}</p>`;
}
function renderVerdictCard(judgement, names) {
  const kazewa = judgement.kazewa;
  const lean = judgement.lean;
  const near = judgement.near;
  const all = judgement.reliability;
  const said = judgement.argumentLean;
  const saidCount = said
    ? `${said.blue} pour le bleu, ${said.red} pour le rouge`
    : "";
  const range = (r) =>
    r ? `entre ${formatPct(r.low)} et ${formatPct(r.high)}` : "";
  const side = lean.side;
  let eyebrow,
    badge,
    title,
    description,
    margin,
    marginLabel,
    note,
    splitLine = "",
    bar = 50;
  if (lean.basis === "memory") {
    eyebrow = "KAZEWA A JUGÉ CETTE DRAFT";
    badge = TIMING_LABEL[kazewa.verdict.timing] || "Avis de Kazewa";
    title = `Kazewa préfère ${sidePhrase(side, kazewa, names)}.`;
    description = kazewa.label || "";
    margin = `${kazewa.verdict.confidence} / 3`;
    marginLabel = "SA CONFIANCE";
    note = "Verdict repris de sa vidéo · ce n’est pas une prédiction";
    bar = 50 + (side === "blue" ? 1 : -1) * (10 + 10 * kazewa.verdict.confidence);
  } else if (lean.basis === "undecided") {
    eyebrow = "KAZEWA A COMMENTÉ CETTE DRAFT SANS TRANCHER";
    badge = kazewa.verdict.conflict ? "Deux avis opposés" : "Pas de préférence";
    title = kazewa.verdict.conflict
      ? "Deux avis opposés selon la vidéo."
      : "Kazewa ne donne pas de préférence.";
    description =
      kazewa.label || "Il commente cette draft sans dire quel côté il préfère.";
    margin = "—";
    marginLabel = "SON VERDICT";
    note = "Il ne tranche pas · le site non plus";
  } else if (lean.basis === "result") {
    const r = all?.result;
    const played = judgement.played;
    const games = played.games;
    const last = games[games.length - 1];
    // Team names only when every game played with these champions has the same ones.
    const sameTeams = games.every(
      (game) => game.teams.blue === last.teams.blue && game.teams.red === last.teams.red,
    );
    const winner = sameTeams ? last.teams[side] : null;
    const opposed = evaluation?.unseen?.matchResult?.withArguments?.oppositeSides;
    const together = evaluation?.unseen?.matchResult?.withArguments?.sameSide;
    eyebrow = "PARTIE DÉJÀ JOUÉE · PAS D’AVIS DE KAZEWA EN MÉMOIRE";
    badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après le résultat du match";
    title = `Verdict estimé : ${sidePhrase(side, winner ? { teams: last.teams } : null, names)}.`;
    description = [
      games.length === 1
        ? `Ces dix champions sont ceux d’une partie pro déjà jouée : ${playedLine(last)}. ${winner ? `${winner} a gagné.` : `Le ${side === "blue" ? "côté bleu" : "côté rouge"} a gagné.`}`
        : `Ces dix champions ont été joués dans ${games.length} parties pro, la dernière : ${playedLine(last)}. Le même côté a gagné chaque fois.`,
      r
        ? `Sur ${r.n} parties qu’il a commentées, il préférait la draft de l’équipe gagnante ${formatPct(r.agreement)} du temps (${range(r)})${r.draftTiming?.n ? `, et ${formatPct(r.draftTiming.agreement)} quand son avis est donné pendant la draft` : ""}.`
        : "",
      said.side !== "even" && said.side !== side && opposed?.n
        ? `Ses arguments sur ces champions penchent pour l’autre côté (${saidCount}) : sur ${opposed.n} drafts dans ce cas, le résultat désignait son verdict ${opposed.resultRight} fois.`
        : said.side === side && together?.n
          ? `Ses arguments sur ces champions vont dans le même sens (${saidCount}) : dans ce cas l’accord mesuré est de ${formatPct(together.agreement)}.`
          : "",
      "Ce n’est pas son avis, et ce n’est pas un jugement sur la draft : c’est le résultat du match.",
    ]
      .filter(Boolean)
      .join(" ");
    margin = r ? formatPct(r.agreement) : "—";
    marginLabel = "FIABILITÉ MESURÉE";
    bar = side === "blue" ? 70 : 30;
    note = "D’après le résultat du match · il préfère le plus souvent le vainqueur";
  } else {
    const split = judgement.played?.side === "even" ? judgement.played : null;
    eyebrow = split
      ? "DÉJÀ JOUÉE, RÉSULTATS PARTAGÉS · KAZEWA NE L’A PAS JUGÉE"
      : "DRAFT INÉDITE · KAZEWA NE L’A PAS JUGÉE";
    splitLine = split
      ? `Ces dix champions ont été joués dans ${split.games.length} parties pro et chaque côté a gagné : le résultat ne départage pas.`
      : "";
    const nearLine = near
      ? `Sur la draft la plus proche qu’il a jugée (${near.sharedChampions} champions sur 10 en commun), il préférait ${sidePhrase(near.verdict.side, null, names)}.`
      : "";
    title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
    marginLabel = "FIABILITÉ MESURÉE";
    if (lean.basis === "arguments") {
      const r = all?.arguments;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après ses arguments";
      description = [
        `D’après ses arguments sur ces champions, donnés dans d’autres drafts (${saidCount}).`,
        r
          ? `Sur ${r.n} drafts qu’il a jugées, le côté désigné par ses arguments venus d’autres vidéos est son verdict ${formatPct(r.agreement)} du temps (${range(r)})${r.sideOnly ? ` ; répondre toujours le même côté donne ${formatPct(r.sideOnly.agreement)} sur ces drafts` : ""}.`
          : "",
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      bar = side === "blue" ? 62 : 38;
      note = "Estimation · sa prochaine vidéo peut dire l’inverse";
    } else if (lean.basis === "cards") {
      const r = all?.cards;
      const fromCards = judgement.cardReading;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après ses fiches champion";
      description = [
        `${said.blue + said.red > 0 ? `Ses arguments sur ces champions se partagent (${saidCount}) : ils ne départagent pas.` : "Aucun argument précis de Kazewa ne s’applique à ces champions dans ces rôles."} Lecture d’après ses fiches champion, qui disent qui est bon avec qui et qui prend le dessus sur qui : ${fromCards.blue} élément${fromCards.blue > 1 ? "s" : ""} pour le bleu, ${fromCards.red} pour le rouge.`,
        r
          ? `Sur ${r.n} drafts tirées de vidéos que ses fiches n’ont jamais vues, cette lecture désigne son verdict ${formatPct(r.agreement)} du temps (${range(r)}) : ${r.low > 0.5 ? "un peu mieux qu’une pièce lancée" : "l’écart avec une pièce lancée n’est pas établi"}.`
          : "",
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      bar = side === "blue" ? 58 : 42;
      note = "Lecture d’après ses fiches · moins sûre que ses arguments";
    } else if (lean.basis === "principles") {
      const r = all?.principles;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après ses principes";
      description = [
        "Ni ses arguments ni ses fiches champion ne départagent ces deux compositions (aucun élément, ou autant de chaque côté). Lecture de dernier recours d’après ses principes de composition (frontline, dégâts soutenus, catch, scaling, détaillés plus bas).",
        r
          ? `Sur ${r.n} drafts qu’il a jugées et que ce calculateur n’avait jamais vues, il désigne son verdict ${formatPct(r.agreement)} du temps : c’est une pièce lancée.`
          : "",
        nearLine,
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      bar = side === "blue" ? 54 : 46;
      note = "Dernier recours · à prendre comme une description";
    } else {
      badge = "Équilibre";
      title = "Deux drafts à l’équilibre.";
      description = `Ni ses arguments, ni ses fiches champion, ni ses principes de composition ne départagent ces deux drafts. ${nearLine}`.trim();
      margin = "=";
      marginLabel = "VERDICT ESTIMÉ";
      note = "Rien ne sépare les deux compositions";
    }
  }
  $("#verdict-card").dataset.side = side;
  $("#verdict-card").dataset.source = judgement.source;
  $("#verdict-eyebrow").textContent = eyebrow;
  $("#confidence-badge").textContent = badge;
  $("#verdict-title").textContent = title;
  $("#verdict-description").textContent = [splitLine, description].filter(Boolean).join(" ");
  $("#verdict-margin").textContent = margin;
  $("#verdict-margin-label").textContent = marginLabel;
  $("#track-note").textContent = note;
  $("#advantage-bar").style.width = `${bar}%`;
}
function renderKazewaPanel(judgement, names) {
  const node = $("#kazewa-panel");
  const kazewa = judgement.kazewa;
  if (!kazewa) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const facts = [];
  if (kazewa.winner)
    facts.push(
      `Résultat de la partie : victoire pour ${sidePhrase(kazewa.winner, kazewa, names)}.`,
    );
  facts.push(
    kazewa.rosterVerified
      ? "Compositions vérifiées sur les données du match."
      : "Compositions telles que relevées dans sa vidéo.",
  );
  if (kazewa.rolesDiffer)
    facts.push(
      "Mêmes dix champions que dans sa vidéo, rangés ici dans d’autres rôles : les compositions affichées dans ses raisons suivent les rôles réels.",
    );
  if (kazewa.realSidesKnown && !kazewa.mapSides)
    facts.push(
      "Les côtés bleu et rouge de cette page sont inversés par rapport au match réel : « blue side » et « red side » dans ses raisons désignent les côtés de la carte.",
    );
  if (kazewa.verdict.draftPhaseUndecided && kazewa.verdict.side !== "even")
    facts.push("Pendant la draft il ne tranchait pas ; l’avis vient de sa revue.");
  if (kazewa.disagreements?.length)
    facts.push(
      `Un autre passage (${kazewa.disagreements.map((d) => (TIMING_LABEL[d.timing] || d.timing).toLowerCase()).join(", ")}) penche pour l’autre côté.`,
    );
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>Ses raisons</h3><span class="mono">${esc(matchLine(kazewa))}</span></div>${kazewa.reasons?.length ? `<ol class="kazewa-reasons">${kazewa.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ol>` : '<p class="fine-print">Il donne son côté sans détailler ses raisons dans ce passage.</p>'}${kazewa.reads?.length ? `<h4>Ses lectures de champions</h4><ul class="kazewa-reads">${kazewa.reads.map((read) => `<li data-side="${esc(read.side)}"><strong>${esc(read.champion)}</strong> ${esc(read.read)}</li>`).join("")}</ul>` : ""}<p class="fine-print">${esc(facts.join(" "))}</p><div class="source-links">${sourceLinks(kazewa.sources, 3)}</div>`;
}
function renderArguments(judgement) {
  const node = $("#arguments-panel");
  const list = judgement.arguments || [];
  if (!list.length) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const blue = list.filter((item) => item.favours === "blue").length;
  const shown = list.slice(0, 8);
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>Ce qu’il a dit de ces champions</h3><span class="mono">${blue} BLEU · ${list.length - blue} ROUGE</span></div><p class="fine-print">Arguments donnés dans d’autres drafts où ces champions étaient dans la même relation et les mêmes rôles. Le côté indiqué est celui que l’argument avantage ici.${list.length > shown.length ? ` Les ${shown.length} premiers sur ${list.length}.` : ""}</p>${shown
    .map(
      (item, i) =>
        `<article class="signal" data-side="${esc(item.favours)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${esc(TAG_LABEL[item.tag] || "Argument")} · ${esc(item.champions.join(" + "))}<span class="side-tag">${item.favours === "blue" ? "BLEU" : "ROUGE"}</span></h4><p>${esc(item.detail)}</p><div class="source-links">${sourceLinks(item.sources, 2)}</div></div></article>`,
    )
    .join("")}`;
}
// "la fiche de Gwen", "la fiche d’Aurora".
const cardOf = (name) =>
  (/^[AEIOUYH]/i.test(name) ? "la fiche d’" : "la fiche de ") + name;
function renderCardsPanel(judgement) {
  const node = $("#cards-panel");
  const reading = judgement.cardReading;
  if (!reading?.items?.length) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const shown = reading.items.slice(0, 8);
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>Ce que disent ses fiches champion</h3><span class="mono">${reading.blue} BLEU · ${reading.red} ROUGE</span></div><p class="fine-print">Chaque fiche résume ce qu’il dit d’un champion dans ses vidéos : avec qui il va bien ou mal, sur qui il prend le dessus, par qui il est puni. Le côté indiqué est celui que la remarque avantage ici.${reading.items.length > shown.length ? ` Les ${shown.length} premières sur ${reading.items.length}.` : ""}</p>${shown
    .map((item, i) => {
      const heading =
        item.kind === "counter"
          ? `${esc(item.other)} contre ${esc(item.champion)}`
          : `${esc(item.champion)} + ${esc(item.other)}`;
      const sentence =
        item.kind === "synergy"
          ? "ces deux champions vont bien ensemble."
          : item.kind === "antisynergy"
            ? "ces deux champions vont mal ensemble."
            : `${esc(item.other)} prend le dessus sur ${esc(item.champion)}.`;
      return `<article class="signal" data-side="${esc(item.favours)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${heading}<span class="side-tag">${item.favours === "blue" ? "BLEU" : "ROUGE"}</span></h4><p>D’après ${esc(cardOf(item.card))}, ${sentence}</p></div></article>`;
    })
    .join("")}`;
}
function renderPrecedents(judgement) {
  const node = $("#precedents-panel");
  const list = judgement.precedents || [];
  if (!list.length) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>Les drafts proches qu’il a jugées</h3><span class="mono">${list.length} PRÉCÉDENT${list.length > 1 ? "S" : ""}</span></div><p class="fine-print">Le côté indiqué est celui de ta draft auquel ressemble la composition qu’il préférait.</p>${list
    .map((item, i) => {
      const lanes = item.sharedLanes?.length
        ? `, lane${item.sharedLanes.length > 1 ? "s" : ""} identique${item.sharedLanes.length > 1 ? "s" : ""} : ${item.sharedLanes.map((role) => ROLE_LABEL[role]).join(", ")}`
        : "";
      const title = matchLine(item) || "Draft jugée par Kazewa";
      const comp = (side) => ROLES.map((role) => item[side][role]).join(", ");
      return `<article class="signal" data-side="${esc(item.verdict.side)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${esc(title)}<span class="side-tag">${item.verdict.side === "blue" ? "BLEU" : "ROUGE"} · ${esc(item.verdict.confidence)}/3</span></h4><p>${esc(item.sharedChampions)} champions en commun${esc(lanes)}. ${esc(item.label || "")}</p><p class="precedent-comps"><span data-side="blue">${esc(comp("blue"))}</span> contre <span data-side="red">${esc(comp("red"))}</span></p><div class="source-links"><button type="button" class="text-button" data-load-case="${esc(item.id)}">Voir cette draft <span aria-hidden="true">↗</span></button>${sourceLinks(item.sources, 1)}</div></div></article>`;
    })
    .join("")}`;
}
function renderStructure(result, names) {
  const verdict = displayedVerdict(result);
  const calc = evaluation?.unseen?.structuralCalculator?.neverSeen;
  $("#calculator-note").textContent =
    `Règles tirées du corpus, appliquées aux deux compositions. ${calc?.n ? `Sur ${calc.n} drafts de Kazewa que ce calculateur n’a jamais vues, son côté est le même ${formatPct(calc.agreement)} du temps : c’est une description, pas un verdict.` : "C’est une description, pas un verdict."}`;
  $("#signal-count").textContent = `${result.signals.length} SIGNAUX`;
  const signals = result.signals;
  const sumLine = verdict
    ? `<p class="signal-sum">Somme des signaux : ${esc(formatSignedScore(verdict.score))} (positif : côté bleu). Score du calculateur, sans valeur de verdict.</p>`
    : "";
  $("#reasons").innerHTML = signals.length
    ? signals
        .map(
          (signal, i) =>
            `<article class="signal" data-side="${esc(signal.side)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${esc(signal.title)}<span class="side-tag">${signal.side === "blue" ? "BLEU" : "ROUGE"} +${esc(formatSignedScore(signal.weight).replace(/^\+/, ""))}</span></h4><p>${esc(signal.evidence)}</p><div class="source-links">${videoLinks(signal.sources, 2)}</div></div></article>`,
        )
        .join("") + sumLine
    : `<p class="fine-print">Aucun signal structurel détecté par les règles actuelles.</p>${sumLine}`;
  $("#axes").innerHTML = result.axes
    .map(
      (a) =>
        `<div class="axis-row"><div class="axis-header"><span>${esc(a.label)}</span><span class="axis-values">${esc(a.blue)} <span>/ ${esc(a.red)}</span></span></div><div class="axis-bars"><div class="axis-bar"><i style="width:${Math.max(0, Math.min(100, (a.blue / a.max) * 100))}%"></i></div><div class="axis-bar red"><i style="width:${Math.max(0, Math.min(100, (a.red / a.max) * 100))}%"></i></div></div></div>`,
    )
    .join("");
  $("#plans").innerHTML = ["blue", "red"]
    .map(
      (side) =>
        `<article class="plan-card ${side}"><span class="eyebrow">${esc(names[side] || SIDE_LABEL[side])} / PLAN DE JEU</span><h3>${esc(result.teams[side]?.identity || "Plan non identifié")}</h3><p>${esc(result.teams[side]?.timing || "Fenêtre de puissance incertaine.")}</p></article>`,
    )
    .join("");
  $("#warnings-panel").hidden = !result.warnings?.length;
  $("#warning-count").textContent = result.warnings?.length || 0;
  $("#warnings").innerHTML = (result.warnings || [])
    .map((w) => `<li>${esc(w)}</li>`)
    .join("");
}
function renderResult(
  judgement,
  { blocked = null, names = SIDE_LABEL } = {},
) {
  if (blocked || judgement.status !== "complete") {
    $("#result-section").hidden = true;
    $("#empty-result").hidden = false;
    $("#empty-result h3").textContent = blocked
      ? "Le verdict attend des données fiables."
      : judgement.status === "incomplete"
        ? "Les dix picks racontent une histoire."
        : "Cette draft demande une vérification.";
    $("#empty-result p").textContent =
      blocked ||
      (judgement.status === "incomplete"
        ? "Complète les deux compositions : si Kazewa a jugé cette draft, son verdict s’affiche."
        : judgement.warnings?.[0]) ||
      "Complète les deux compositions.";
    const count = ["blue", "red"]
      .flatMap((s) => Object.values(draft[s]))
      .filter(Boolean).length;
    $("#picks-progress").textContent =
      view === "live" ? "VERDICT SUSPENDU" : `${count} / 10 PICKS`;
    return;
  }
  $("#result-section").hidden = false;
  $("#empty-result").hidden = true;
  renderVerdictCard(judgement, names);
  renderKazewaPanel(judgement, names);
  renderArguments(judgement);
  renderCardsPanel(judgement);
  renderPrecedents(judgement);
  renderStructure(judgement.structure, names);
}
function draftLine(side) {
  return ROLES.map((role) => draft[side][role]).filter(Boolean).join(", ");
}
function refreshQuickFields() {
  for (const side of ["blue", "red"]) {
    const field = $(`#quick-${side}`);
    if (!field || document.activeElement === field) continue;
    field.value = draftLine(side);
    quickParsed[side] = null;
  }
}
function usualLane(champion, role) {
  const lanes = LANES[champion] || [];
  return !lanes.length || lanes.includes(role);
}
function renderQuickReadout() {
  for (const side of ["blue", "red"]) {
    const node = $(`#quick-${side}-readout`);
    if (!node) return;
    const parsed = quickParsed[side];
    const filled = ROLES.some((role) => draft[side][role]);
    const rows = filled
      ? ROLES.map((role) => {
          const champion = draft[side][role] || "";
          return {
            role,
            champion,
            usual: !champion || usualLane(champion, role),
          };
        })
      : parsed
        ? parsed.placements
        : [];
    const chips = rows.length
      ? rows
          .map((row) => {
            const selected =
              quickSwap?.side === side && quickSwap.role === row.role;
            return `<button type="button" class="${row.usual ? "" : "is-offlane"}${selected ? " is-selected" : ""}" data-quick-side="${side}" data-quick-role="${row.role}" aria-pressed="${selected}"><em>${ROLE_LABEL[row.role]}</em>${row.champion ? esc(row.champion) : "—"}</button>`;
          })
          .join("")
      : `<span class="quick-empty">Aucun champion reconnu</span>`;
    const notes = [];
    if (parsed?.unknown.length) notes.push(`Inconnu : ${parsed.unknown.join(", ")}`);
    if (parsed?.duplicates.length)
      notes.push(`Déjà saisi : ${parsed.duplicates.join(", ")}`);
    if (parsed?.overflow.length)
      notes.push(`Au-delà de cinq : ${parsed.overflow.join(", ")}`);
    const off = rows
      .filter((row) => !row.usual)
      .map((row) => `${row.champion} en ${ROLE_LABEL[row.role]}`);
    if (off.length) notes.push(`Hors rôle habituel : ${off.join(", ")}`);
    node.innerHTML = `<div class="quick-chips">${chips}</div>${notes.length ? `<p>${esc(notes.join(" · "))}</p>` : ""}`;
  }
}
function setLabMode(mode) {
  labMode = mode === "quick" ? "quick" : "roles";
  for (const button of document.querySelectorAll("[data-lab-mode]")) {
    const active = button.dataset.labMode === labMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#quick-draft").hidden = labMode !== "quick";
  $("#draft-grid").hidden = labMode === "quick";
  if (labMode === "quick") refreshQuickFields();
  analyzeManual();
}
function applyQuick(side) {
  const parsed = compositionFromText($(`#quick-${side}`).value, knowledge);
  quickParsed[side] = parsed;
  draft[side] = { ...parsed.picks };
  if (quickSwap?.side === side) quickSwap = null;
  origin =
    "Saisie rapide · les rôles suivent le rôle habituel de chaque champion.";
  analyzeManual();
}
function chooseQuickRole(side, role) {
  if (!ROLES.includes(role)) return;
  if (!quickSwap || quickSwap.side !== side || quickSwap.role === role) {
    quickSwap =
      quickSwap?.side === side && quickSwap.role === role
        ? null
        : { side, role };
    renderQuickReadout();
    return;
  }
  draft[side] = swapRoles(draft[side], quickSwap.role, role);
  quickSwap = null;
  origin = "Saisie rapide · les champions ont été échangés de rôle.";
  analyzeManual();
}
function formatSignedScore(score) {
  if (!Number.isFinite(score) || Object.is(score, -0) || score === 0) return "0";
  const rounded = Math.round(score * 100) / 100;
  const text = Math.abs(rounded).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });
  return rounded > 0 ? `+${text}` : `−${text}`;
}
function renderQuickVerdict(judgement) {
  const node = $("#quick-verdict");
  if (!node) return;
  if (labMode !== "quick" || judgement.status !== "complete") {
    node.hidden = true;
    node.textContent = "";
    delete node.dataset.side;
    return;
  }
  const lean = judgement.lean;
  let sentence;
  if (lean.basis === "memory")
    sentence = `Kazewa a jugé cette draft : il préfère ${sidePhrase(lean.side, judgement.kazewa)}. Confiance ${judgement.kazewa.verdict.confidence}/3.`;
  else if (lean.basis === "undecided")
    sentence = "Kazewa a commenté cette draft sans trancher.";
  else if (lean.basis === "balance")
    sentence =
      "Draft inédite. Verdict estimé : équilibre, rien ne départage les deux compositions.";
  else {
    const all = judgement.reliability ?? {};
    const source = {
      result: ["le résultat du match", all.result],
      arguments: ["ses arguments sur ces champions", all.arguments],
      cards: ["ses fiches champion", all.cards],
      principles: ["ses principes de composition", all.principles],
    }[lean.basis] ?? ["son corpus", null];
    sentence = `${lean.basis === "result" ? "Partie pro déjà jouée, sans avis de lui en mémoire." : judgement.played?.side === "even" ? "Draft déjà jouée, chaque côté a gagné." : "Draft inédite."} Verdict estimé d’après ${source[0]} : ${sidePhrase(lean.side, null)}${source[1] ? ` (fiabilité mesurée ${formatPct(source[1].agreement)})` : ""}.`;
  }
  node.hidden = false;
  node.dataset.side = lean.side;
  node.textContent = sentence;
}
function analyzeManual() {
  const judgement = judge(draft);
  if (labMode === "quick") renderQuickReadout();
  else renderTeams();
  const note = $("#draft-origin");
  if (note) note.textContent = origin || "Choisis les dix champions par rôle.";
  renderQuickVerdict(judgement);
  renderResult(judgement);
}
function setView(next, { scroll = false } = {}) {
  view = next;
  document.body.dataset.view = next;
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === next;
    button.classList.toggle("is-active", active);
    if (button.hasAttribute("aria-pressed"))
      button.setAttribute("aria-pressed", String(active));
  }
  $("#lab-view").hidden = next !== "lab";
  $("#coach-view").hidden = next !== "coach";
  $("#live-view").hidden = next !== "live";
  $("#method-view").hidden = next !== "method";
  $("#workspace-title").textContent =
    next === "live"
      ? "La scène pro, sous la loupe."
      : next === "coach"
        ? "Ton tour, dans l’ordre."
        : next === "method"
          ? "De l’intuition aux règles."
          : "Au cœur de la draft.";
  $("#workspace-eyebrow").textContent =
    next === "live"
      ? "02 / LE DIRECT"
      : next === "coach"
        ? "04 / LE COACH"
        : next === "method"
          ? "03 / LA MÉTHODE"
          : "01 / L’ATELIER";
  renderChampionCard();
  if (next === "lab") analyzeManual();
  else if (next === "coach") {
    renderCoach();
    refreshFeed();
  } else if (next === "live") {
    renderLive();
    refreshFeed();
  } else {
    $("#result-section").hidden = true;
    $("#empty-result").hidden = true;
  }
  if (scroll)
    $("#workspace").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
}

function formatPct(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
    : "—";
}
function renderValidation() {
  const count = Object.keys(knowledge.champions).length;
  $("#champion-count").textContent = count;
  const mem = evaluation?.memory ?? memory?.summary;
  $("#memory-count").textContent = mem?.decided ?? "—";
  const unseen = evaluation?.unseen;
  const order = unseen?.pickOrder;
  const calc = unseen?.structuralCalculator;
  const said = unseen?.arguments;
  const every = unseen?.everyDraft?.heldOut;
  const cardFigures = unseen?.championCards;
  const won = unseen?.matchResult;
  const everyPlayed = unseen?.everyDraft?.played?.heldOut;
  $("#validation-text").textContent = mem
    ? `${mem.decided} drafts jugées par Kazewa en mémoire : son verdict exact, ses raisons, sa vidéo. Toute autre draft reçoit un verdict estimé : juste ${formatPct(every?.all?.agreement)} du temps sur des vidéos tenues à l’écart d’après ses arguments, ses fiches champion et ses principes${everyPlayed?.all?.n ? `, et ${formatPct(everyPlayed.all.agreement)} sur les mêmes drafts quand le site peut aussi s’appuyer sur le résultat du match` : ""}.`
    : "Mémoire des verdicts indisponible.";
  const interval = (r) =>
    r?.n ? `${formatPct(r.low)} à ${formatPct(r.high)}` : "—";
  const row = (name, r, remark) =>
    `<tr><td>${esc(name)}</td><td>${r?.n ?? "—"}</td><td>${formatPct(r?.agreement)}</td><td>${esc(interval(r))}</td><td>${esc(remark)}</td></tr>`;
  const sideName = order?.sideOnly?.side === "blue" ? "côté bleu" : "côté rouge";
  $("#evaluation-details").innerHTML =
    `<span class="eyebrow">CE QUI EST MESURÉ</span><h3>Sa mémoire est exacte. Son avis estimé ne l’est pas toujours.</h3><p>Deux questions différentes, jamais mélangées. Une draft que Kazewa a commentée renvoie son verdict : c’est une restitution, juste par construction. Une draft qu’il n’a pas commentée reçoit un verdict estimé : il est mesuré sur des séries et des vidéos tenues à l’écart.</p><div class="eval-stats"><div class="eval-stat"><strong>${mem?.decided ?? "—"}</strong><span>DRAFTS AVEC SON VERDICT</span></div><div class="eval-stat"><strong>${mem?.videos ?? "—"}</strong><span>VIDÉOS SOURCES</span></div><div class="eval-stat"><strong>${formatPct(said?.agreement)}</strong><span>DRAFT INÉDITE, D’APRÈS SES ARGUMENTS</span></div><div class="eval-stat"><strong>${formatPct(every?.all?.agreement)}</strong><span>DRAFT JAMAIS JOUÉE, VIDÉOS TENUES À L’ÉCART</span></div>${won?.n ? `<div class="eval-stat"><strong>${formatPct(won.agreement)}</strong><span>PARTIE DÉJÀ JOUÉE, D’APRÈS LE RÉSULTAT</span></div>` : ""}</div><table><thead><tr><th>Situation</th><th>Drafts</th><th>Accord</th><th>Intervalle de confiance</th><th>Lecture</th></tr></thead><tbody>${row("Draft qu’il a jugée (mémoire)", mem?.selfRecall, "Restitution de son verdict, pas une prédiction")}${row("Draft jamais jouée · verdict estimé", every?.all, "Arguments, fiches et principes enchaînés, sur des vidéos tenues à l’écart")}${everyPlayed?.all?.n ? row("Partie déjà jouée · verdict estimé", everyPlayed.all, `Les mêmes drafts ; le résultat sert pour ${everyPlayed.byReading?.result?.n ?? "—"} d’entre elles`) : ""}${won?.n ? row("Partie déjà jouée · le côté qui a gagné", won, "Aucun réglage : il préfère le plus souvent le vainqueur") : ""}${won?.draftTiming?.n ? row("… dont ses avis donnés pendant la draft", won.draftTiming, "Dits avant le début de la partie, qu’il regarde en principe sans la connaître") : ""}${won?.afterTheGame?.n ? row("… dont ses avis de revue ou tardifs", won.afterTheGame, "Peuvent connaître le résultat") : ""}${row("Draft inédite · ses arguments venus d’autres vidéos", said, "Aucun réglage : on compte ses arguments par côté")}${said?.sideOnly ? row("Règle sans modèle · toujours le même côté, mêmes drafts", said.sideOnly, "La barre à dépasser") : ""}${row("Draft inédite · ses fiches champion", cardFigures?.heldOut, "Vidéos que les fiches n’ont jamais vues")}${row("Ses fiches champion · vidéos dont elles sont tirées", cardFigures?.writtenFrom, "Ne prouve rien : elles résument ces vidéos")}${row("Draft inédite · ses principes (calculateur)", calc?.neverSeen, "Pile ou face : une description, pas un verdict")}${row("Calculateur · drafts qui ont servi à le régler", calc?.tunedOn, "Ne prouve rien : il a été réglé dessus")}${row("Lecture écartée · ordre des picks", order, "Écart non établi avec la règle ci-dessous")}${order?.sideOnly ? row(`Règle sans modèle · répondre toujours « ${sideName} »`, order.sideOnly, "Sur les mêmes drafts") : ""}</tbody></table><p>Ses arguments : pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos et qui s’appliquent encore (mêmes champions, même relation, mêmes rôles), et on compte de quel côté ils penchent. Rien n’est réglé sur ses verdicts. Cette lecture répond pour ${formatPct(said?.coverage)} des drafts jugées.${said?.overSideOnly ? ` Face à la règle « toujours le même côté », ses arguments ont raison seuls sur ${said.overSideOnly.argumentsRightRuleWrong} drafts et tort seuls sur ${said.overSideOnly.ruleRightArgumentsWrong} : ${said.overSideOnly.p < 0.05 ? "l’avantage est établi" : "l’avantage n’est pas encore établi statistiquement"} (p = ${said.overSideOnly.p.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}).` : ""}</p>${won?.n ? `<p>Partie déjà jouée : quand les dix champions sont ceux d’une partie pro qui a eu lieu (${formatPct(won.coverage)} des drafts qu’il a jugées sont dans ce cas), le site nomme le côté qui a gagné. Ce n’est pas un jugement sur la draft. Sur ${won.n} parties qu’il a commentées, l’équipe qu’il préférait est celle qui a gagné ${formatPct(won.agreement)} du temps ; quand ses arguments désignent l’autre côté, le résultat a raison ${won.withArguments?.oppositeSides?.resultRight} fois sur ${won.withArguments?.oppositeSides?.n}. Cette lecture n’existe pas pour une draft qui n’a pas été jouée, et elle est mesurée sur les parties qu’il a choisi de commenter.</p>` : ""}<p>Toute draft reçoit un verdict. Quand aucun de ses arguments ne s’applique, ou qu’il y en a autant de chaque côté, le site passe à ses fiches champion (qui va bien avec qui, qui prend le dessus sur qui), puis à ses principes de composition. Ces deux lectures sont moins sûres, et chaque verdict dit laquelle a servi.</p>${cardFigures?.writtenFrom?.n ? `<p>Ce que montre l’écart entre les deux lignes des fiches : sur les vidéos qu’elles résument, les fiches retrouvent son verdict ${formatPct(cardFigures.writtenFrom.agreement)} du temps ; sur les vidéos qu’elles n’ont jamais vues, ${formatPct(cardFigures.heldOut?.agreement)}. Ce qu’il a dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions, beaucoup moins.</p>` : ""}${order?.sideOnly ? `<p>L’ordre des picks a été essayé puis écarté. Sur ${order.n} drafts où il est connu, lire qui répond à qui dans chaque lane désigne son verdict ${formatPct(order.agreement)} du temps, contre ${formatPct(order.sideOnly.agreement)} en répondant toujours « ${sideName} » : ${order.overSideOnly?.p < 0.05 ? "un écart établi" : "l’écart n’est pas établi"}. Quand cette lecture va dans le sens de ses arguments, le résultat est de ${formatPct(said?.withPickOrder?.sameSide?.agreement)}, contre ${formatPct(said?.agreement)} pour ses arguments seuls. Elle avait paru utile sur un échantillon plus petit.</p>` : ""}<p>Ce qui ne marche pas non plus : les profils de champions, leur identité et les statistiques de 44 000 matchs pros ne suivent pas ses avis sur des drafts tenues à l’écart. Ses verdicts s’appuient sur les bans, les joueurs et la méta du moment, que dix champions ne portent pas.</p>${!won?.n && evaluation?.reference?.realWinnerMatchesVerdict?.n ? `<p>Repère : dans ${formatPct(evaluation.reference.realWinnerMatchesVerdict.agreement)} des ${evaluation.reference.realWinnerMatchesVerdict.n} drafts jugées dont le résultat est connu, l’équipe qu’il préférait a gagné. Une partie de ses revues est enregistrée en connaissant le résultat.</p>` : ""}<p>Les résultats et les compositions des parties pro viennent des données de match d’<a href="https://oracleselixir.com/" target="_blank" rel="noopener noreferrer">Oracle’s Elixir ↗</a>.</p><p><a href="./data/evaluation.json" target="_blank" rel="noopener">Rapport de mesure ↗</a> · <a href="./data/memory-site.json" target="_blank" rel="noopener">Mémoire des verdicts ↗</a> · <a href="./data/model.json" target="_blank" rel="noopener">Fiabilité de chaque lecture ↗</a></p>`;
  $("#rule-catalog").innerHTML = knowledge.rules
    .map(
      (r) =>
        `<article class="rule-item"><h4>${esc(r.title)}</h4><p>${esc(r.description || r.provenance?.interpretation || r.family || "")} · poids ${esc(r.weight)}</p><div class="source-links">${videoLinks(r.sources, 4)}</div></article>`,
    )
    .join("");
}

function liveVerdictLine(match) {
  const readiness = getLiveReadiness(feedError ? null : snapshot, match, {
    staleAfterMs: config.staleAfterMs,
  });
  if (!readiness.ready) return readiness.reason;
  const judgement = judge({ blue: match.blue.picks, red: match.red.picks }, { live: true });
  if (judgement.status !== "complete")
    return judgement.warnings?.[0] || "Verdict indisponible.";
  const basis = judgement.lean.basis;
  if (basis === "memory")
    return `Kazewa a jugé cette draft : ${match[judgement.winner]?.name || SIDE_LABEL[judgement.winner]}.`;
  if (basis === "undecided") return "Kazewa a commenté cette draft sans trancher.";
  if (judgement.lean.side === "even") return "Draft inédite. Verdict estimé : équilibre.";
  const r = judgement.reliability?.[basis];
  const from = {
    arguments: "ses arguments",
    cards: "ses fiches champion",
    principles: "ses principes",
  }[basis];
  return `Draft inédite. Verdict estimé d’après ${from} : ${match[judgement.lean.side]?.name || SIDE_LABEL[judgement.lean.side]}${r ? ` (fiabilité mesurée ${formatPct(r.agreement)})` : ""}.`;
}
function coachTaken() {
  return new Set([
    ...coach.bans.blue,
    ...coach.bans.red,
    ...ROLES.flatMap((role) => [coach.picks.blue[role], coach.picks.red[role]]),
  ].filter(Boolean));
}
function renderCoachPro() {
  const node = $("#coach-pro");
  if (!node || !knowledge) return;
  let body;
  if (!endpoint)
    body =
      "<p>Le flux LoL Esports public se branche quand cette page est servie par le serveur du projet. Sur GitHub Pages, indique l’URL du proxy dans Direct pro. Aucune partie n’est inventée.</p>";
  else if (feedError)
    body = `<p>${esc(feedError)}</p>`;
  else if (!snapshot || snapshot.status === "not_configured")
    body = "<p>Connexion au flux professionnel…</p>";
  else if (snapshot.status !== "ok")
    body = "<p>Le flux professionnel ne répond pas. Le verdict live est suspendu.</p>";
  else if (!snapshot.matches.length)
    body =
      "<p>Aucune partie professionnelle couverte en ce moment. Le site redemande le flux tout seul. Ta draft continue pendant ce temps.</p>";
  else
    body = snapshot.matches
      .map(
        (match) =>
          `<button type="button" class="match-card${coachFocus === match.id ? " is-selected" : ""}" data-pro-match="${esc(match.id)}"><span class="match-league">${esc(match.league || "PRO")}${match.gameNumber ? ` · G${esc(match.gameNumber)}` : ""}</span><span class="match-teams">${esc(match.blue.name)} <span>VS</span> ${esc(match.red.name)}</span><span class="match-edge">${esc(liveVerdictLine(match))}</span></button>`,
      )
      .join("");
  node.innerHTML = `<h3>Games pros en direct</h3>${body}<p class="fine-print">Le flux public donne les champions par rôle quand la partie est lisible. Il ne donne pas les bans ni l’ordre des picks. Le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, un verdict estimé d’après ses arguments, ses fiches champion ou ses principes, avec sa fiabilité. Le résultat d’une autre partie jouée avec les mêmes champions n’est pas utilisé pour une partie en cours.</p>`;
}
function championImage(name, size) {
  return `<img src="https://ddragon.leagueoflegends.com/cdn/${esc(config.assetPatch)}/img/champion/${esc(assetId(name))}.png" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`;
}
function renderDraftSide(side, advice) {
  const step = advice.step;
  const active = Boolean(step && step.side === side);
  const highlight =
    active && step.action === "pick" && !advice.options[0]?.flex
      ? advice.options[0]?.role
      : null;
  const bans = Array.from({ length: 5 }, (_, index) => {
    const name = coach.bans[side][index];
    const now = active && step.action === "ban" && coach.bans[side].length === index;
    return `<div class="ban-slot${now ? " is-now" : ""}">${name ? championImage(name, 40) : ""}</div>`;
  }).join("");
  const picks = ["bot", "jng", "mid", "sup", "top"]
    .map((role) => {
      const name = coach.picks[side][role];
      const now = highlight === role && !name;
      return `<div class="pick-slot${now ? " is-now" : ""}"><div class="pick-face">${name ? championImage(name, 46) : ""}</div><div><span>${ROLE_LABEL[role]}</span><strong>${name ? esc(name) : "—"}</strong></div></div>`;
    })
    .join("");
  return `<div class="team-heading"><span class="team-side">${side === "blue" ? "BLUE SIDE" : "RED SIDE"}</span><h3>${side === coach.userSide ? "Ton côté" : "Adverse"}</h3></div><div class="ban-row">${bans}</div>${picks}`;
}
function renderCoachGrid(advice) {
  const taken = coachTaken();
  const ranked = advice.pool || advice.options;
  const byName = new Map(ranked.map((option) => [option.champion, option]));
  const position = new Map(ranked.map((option, index) => [option.champion, index]));
  const query = foldChampion(coachQuery);
  const meta = coachBrain?.meta ?? null;
  const side = advice.step?.side;
  const freeRoles = side ? ROLES.filter((role) => !coach.picks[side][role]) : [];
  const names = Object.keys(knowledge.champions)
    .filter((name) => {
      // A typed name is found under any role filter: a pick can be unusual.
      if (query) return foldChampion(name).includes(query);
      return coachLane === "all" || playableRoles(meta, name).includes(coachLane);
    })
    .sort((a, b) => {
      const used = Number(taken.has(a)) - Number(taken.has(b));
      if (used) return used;
      // What was typed comes first: the exact name, then names starting with it.
      if (query) {
        const closeness = (name) => {
          const folded = foldChampion(name);
          return folded === query ? 0 : folded.startsWith(query) ? 1 : 2;
        };
        const typed = closeness(a) - closeness(b);
        if (typed) return typed;
      }
      const left = byName.get(a);
      const right = byName.get(b);
      const playable = Number(right?.playable !== false) - Number(left?.playable !== false);
      if (playable) return playable;
      const order = (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity);
      if (order) return order;
      return a.localeCompare(b, "fr");
    });
  const picking = advice.step?.action === "pick";
  const order = new Map(advice.options.map((option, index) => [option.champion, index + 1]));
  $("#coach-grid").innerHTML = names
    .map((name) => {
      const used = taken.has(name) || advice.done;
      const hint = byName.get(name);
      const first = hint?.reasons?.[0]?.text;
      const title = first ? ` title="${esc(first)}"` : "";
      const seen = coachBrain?.meta ? Math.round(presence(coachBrain.meta, name) * 100) : 0;
      const shown = !used && seen >= 1 ? `${seen} %` : "";
      // With a role filter on, a click puts the champion in that role.
      const asked =
        picking && coachLane !== "all" && freeRoles.includes(coachLane) ? coachLane : null;
      const given = asked ?? hint?.role ?? null;
      // No usual role is free, and no role is asked for.
      const unavailable = Boolean(hint && hint.playable === false && !asked);
      const role = hint && picking && !unavailable && given ? ROLE_LABEL[given] : "";
      const status = unavailable && picking ? "rôle pris" : "";
      const place = order.get(name);
      const label = [
        name,
        place ? `suggestion ${place}` : "",
        shown ? `présence pro ${shown}` : "",
        role || status,
      ]
        .filter(Boolean)
        .join(", ");
      const blocked = used || (picking && unavailable);
      return `<button type="button" class="champ-tile${place ? " is-suggested" : ""}${taken.has(name) ? " is-taken" : ""}${unavailable ? " is-unavailable" : ""}" data-champion="${esc(name)}"${asked ? ` data-role="${esc(asked)}"` : ""} aria-label="${esc(label)}"${title}${blocked ? " disabled" : ""}><span class="champ-face">${championImage(name, 74)}${place ? `<span class="champ-rank">${place}</span>` : ""}${shown ? `<span class="champ-score">${esc(shown)}</span>` : ""}</span>${role || status ? `<span class="champ-role">${esc(role || status)}</span>` : ""}<span class="champ-name">${esc(name)}</span></button>`;
    })
    .join("");
}
const NOTE_LABEL = {
  pick_order: "Ce qu’il disait de ce pick",
  meta_strong: "Il le jugeait fort",
  meta_weak: "Il le jugeait faible",
};
const monthYear = (text) => {
  const date = new Date(String(text) + "T12:00:00Z");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
};
// The first suggestions, each with the sentence behind every point it scores.
function renderCoachSuggestions(advice) {
  const node = $("#coach-suggestions");
  if (!node) return;
  if (advice.done) {
    node.innerHTML = "";
    return;
  }
  if (!advice.options.length) {
    node.innerHTML = `<h3>Pas de suggestion pour ce tour</h3><p class="fine-print">${coachBrain?.meta?.games ? "Rien ne départage les champions restants." : "Les données de méta pro n’ont pas pu être chargées, et Kazewa n’a rien dit des champions déjà pris. Recharge la page, ou choisis dans la grille."}</p>`;
    return;
  }
  const step = advice.step;
  const ban = step.action === "ban";
  const heading = step.ours
    ? ban
      ? "À bannir en priorité"
      : "À prendre en priorité"
    : ban
      ? "Ce qu’ils ont intérêt à bannir"
      : "Ce qu’ils ont intérêt à prendre";
  const card = (option, mark) => {
      const reasons = option.reasons
        .filter((reason) => reason.points || reason.kind === "answer" || reason.kind === "note")
        .map((reason) => {
          const tone =
            reason.kind === "answer" ? "is-warning" : reason.points < 0 ? "is-minus" : reason.points > 0 ? "is-plus" : "";
          const quote = reason.detail ? ` <span class="coach-quote">« ${esc(reason.detail)} »</span>` : "";
          const links = reason.sources?.length ? ` ${sourceLinks(reason.sources, 1)}` : "";
          return `<li class="${tone}">${esc(reason.text)}${quote}${links}</li>`;
        })
        .join("");
      const used = new Set(option.reasons.map((reason) => reason.detail).filter(Boolean));
      // His word on a champion's strength is a reason line when it is recent,
      // and stale otherwise. What is quoted here is how he spoke of picking it.
      const end = Date.parse(coachBrain?.meta?.to ?? "");
      const fresh = (entry) =>
        entry.tag === "pick_order" &&
        Number.isFinite(end) &&
        entry.date &&
        end - Date.parse(entry.date) <= 730 * 86400000;
      const note = ban ? null : (option.notes ?? []).find((entry) => !used.has(entry.text) && fresh(entry));
      const said = note
        ? `<p class="coach-said">${esc(NOTE_LABEL[note.tag] || "Ce qu’il en disait")}${note.date ? ` en ${esc(monthYear(note.date))}${note.patch ? ` (patch ${esc(note.patch)})` : ""}` : ""} : « ${esc(note.text)} » ${sourceLinks([{ video: note.video, ts: note.ts, title: "Vidéo" }], 1)}</p>`
        : "";
      const role = !ban && option.role ? `<span class="coach-card-role">${ROLE_LABEL[option.role]}${option.flex ? " · flex" : ""}</span>` : "";
      return `<article class="coach-card"><button type="button" class="coach-card-pick" data-champion="${esc(option.champion)}"${!ban && option.role ? ` data-role="${esc(option.role)}"` : ""}><span class="coach-card-face">${championImage(option.champion, 46)}</span><span class="coach-card-name"><em>${mark}</em> ${esc(option.champion)}</span>${role}<span class="coach-card-go">${step.ours ? (ban ? "Bannir" : "Prendre") : "Valider"}</span></button><ul class="coach-reasons">${reasons}</ul>${said}</article>`;
  };
  const extra = advice.answers?.length
    ? `<h3 class="coach-also">${step.ours ? "Moins joués en ce moment, mais il en a parlé" : "Moins joués, mais il en a parlé"}</h3><p class="fine-print">Des champions que Kazewa a nommés contre ou avec ceux déjà pris, et que la méta pro place plus bas.</p>${advice.answers.map((option) => card(option, "·")).join("")}`
    : "";
  node.innerHTML = `<h3>${heading}</h3>${advice.options.map((option, index) => card(option, index + 1)).join("")}${extra}`;
}
function renderCoach() {
  if (view !== "coach" || !knowledge || !coachBrain) return;
  const advice = advise(coach, coachBrain, { limit: 5 });
  for (const button of document.querySelectorAll("[data-seat]")) {
    const active = button.dataset.seat === coach.seat;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll("[data-lane]")) {
    const active = button.dataset.lane === coachLane;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#coach-undo").disabled = coach.log.length === 0;
  $("#coach-side-note").textContent =
    coach.seat === "first"
      ? "Tu es first pick, côté bleu. Tu bannis en premier, puis tu prends le premier pick."
      : "Tu es second pick, côté rouge. Le bleu ouvre. Tu réponds ensuite avec deux picks d’affilée.";
  const step = advice.step;
  const best = advice.options[0];
  $("#coach-turn").textContent = advice.done
    ? "Draft complète"
    : `${step.phase} · ${step.index + 1}/20 · ${step.ours ? "à toi" : "à eux"} de ${step.action === "ban" ? "bannir" : "pick"}`;
  const bestLine = $("#coach-best");
  if (bestLine) {
    bestLine.textContent = advice.done
      ? ""
      : best
        ? step.ours
          ? step.action === "ban"
            ? `À bannir : ${best.champion}`
            : `À prendre : ${best.champion} ${ROLE_LABEL[best.role]}`
          : step.action === "ban"
            ? `Ban probable en face : ${best.champion}`
            : `Pick probable en face : ${best.champion} ${ROLE_LABEL[best.role]}`
        : "Pas de suggestion pour ce tour.";
  }
  $("#coach-blue").innerHTML = renderDraftSide("blue", advice);
  $("#coach-red").innerHTML = renderDraftSide("red", advice);
  const meta = coachBrain.meta;
  const window = meta?.games
    ? `${meta.games} parties pro du ${frenchDate(meta.from)} au ${frenchDate(meta.to)}, patchs ${meta.patches[0]} à ${meta.patches[meta.patches.length - 1]}, toutes ligues sauf les académies`
    : "données de méta pro absentes";
  $("#coach-note").textContent = advice.done
    ? "Draft complète : le verdict ci-dessous est celui que le site donne à ces dix champions."
    : step.action === "ban"
      ? `Un ban vaut d’abord par la méta (${window}) : à quel point le champion est banni et pris. S’y ajoutent ce que Kazewa a dit de lui récemment, et, une fois des picks posés, ce qu’il ferait à ces picks d’après ses arguments et ses fiches. Le camp qui prend juste après les bans ne bannit pas son propre meilleur pick. Le pourcentage sur chaque portrait est la présence pro : pris ou banni. Clique un champion pour valider le tour, suggéré ou non.`
      : `Un pick est classé sur ce que Kazewa a dit de lui avec les champions déjà pris (ses arguments d’abord, ses fiches champion sinon), sur ce qu’il disait de sa force ces derniers mois, sur la méta (${window}), sur le moment où les équipes pro prennent ce rôle et ce champion, et sur sa règle de la frontline quand trois picks sont posés sans en avoir. « Peut encore se faire répondre » est un avertissement, il ne change pas le classement. Ce n’est pas une prédiction de victoire. Clique un champion pour valider le tour ; pour le placer dans un autre rôle, choisis d’abord ce rôle dans le filtre.`;
  renderCoachSuggestions(advice);
  renderCoachGrid(advice);
  renderCoachPro();
  if (coachFocus !== "self") {
    const match = snapshot?.matches?.find((item) => item.id === coachFocus);
    if (!match) {
      coachFocus = "self";
      renderResult(
        advice.done
          ? judge(coach.picks)
          : { status: "incomplete", warnings: [] },
      );
      if (!advice.done) {
        $("#result-section").hidden = true;
        $("#empty-result").hidden = true;
      }
      return;
    }
    const readiness = getLiveReadiness(feedError ? null : snapshot, match, {
      staleAfterMs: config.staleAfterMs,
    });
    renderResult(judge({ blue: match.blue.picks, red: match.red.picks }, { live: true }), {
      blocked: readiness.ready ? null : readiness.reason,
      names: { blue: match.blue.name, red: match.red.name },
    });
    return;
  }
  if (advice.done) renderResult(judge(coach.picks));
  else {
    $("#result-section").hidden = true;
    $("#empty-result").hidden = true;
  }
}
function acceptCoachAction(champion, role) {
  const name = normalizeChampion(champion, knowledge);
  if (!name) {
    toast("Ce champion n’est pas dans le modèle.");
    return;
  }
  try {
    coach = applyAction(coach, name, role || null, coachBrain);
    coachFocus = "self";
    coachQuery = "";
    const search = $("#coach-search");
    if (search) search.value = "";
    renderCoach();
  } catch (error) {
    toast(error.message);
  }
}
function liveMessage(title, message, { configure = false } = {}) {
  return `<div class="live-empty"><span class="live-empty-icon" aria-hidden="true">⌁</span><div><h3>${esc(title)}</h3><p>${esc(message)}</p>${configure ? '<button class="primary-button" data-open-settings>Connecter une source live <span aria-hidden="true">↗</span></button>' : ""}<p class="fine-print">L’atelier reste disponible pour analyser une composition manuellement.</p></div></div>`;
}
function currentMatch() {
  return snapshot?.matches?.find((m) => m.id === selectedMatchId) || null;
}
function renderLive() {
  if (!knowledge) return;
  const indicator = $("#feed-indicator");
  indicator.dataset.state =
    snapshot?.status === "ok" && !feedError ? "ok" : "error";
  let html = "";
  if (feedError) {
    indicator.innerHTML = '<span class="status-dot"></span>Flux indisponible';
    html = liveMessage("La connexion a besoin d’attention.", feedError, {
      configure: true,
    });
  } else if (!snapshot || snapshot.status === "not_configured") {
    indicator.innerHTML =
      '<span class="status-dot"></span>Aucune source connectée';
    html = liveMessage(
      "Le direct attend sa source.",
      "Connectez un fournisseur de données professionnelles via votre proxy. Le suivi pendant la sélection exige une couverture de la phase de draft ; un flux de partie ne fournit un verdict qu’une fois les compositions reçues.",
      { configure: true },
    );
  } else if (snapshot.status === "unavailable") {
    indicator.innerHTML =
      '<span class="status-dot"></span>Source momentanément indisponible';
    html = liveMessage(
      "Le verdict se met en pause.",
      "Le fournisseur ne répond pas ou l’accès aux données est refusé. Vérifiez les identifiants et la couverture côté serveur. Aucun verdict ancien n’est présenté comme actuel.",
      { configure: true },
    );
  } else {
    const latest = Date.parse(snapshot.observedAt || "");
    const fresh =
      Number.isFinite(latest) &&
      Date.now() - latest <= config.staleAfterMs &&
      latest <= Date.now() + 60000;
    indicator.dataset.state = fresh ? "ok" : "error";
    indicator.innerHTML = `<span class="status-dot"></span>${fresh ? "Flux connecté" : "Données à rafraîchir"} · ${esc(snapshot.provider || "fournisseur")} ${Number.isFinite(latest) ? `· ${esc(new Date(latest).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}` : ""}`;
    if (!snapshot.matches.length)
      html = liveMessage(
        snapshot.reason === "waiting_for_frames"
          ? "Les compositions arrivent."
          : "Aucune draft dans le flux.",
        snapshot.reason === "waiting_for_frames"
          ? "Le fournisseur est connecté ; le moteur attend les premiers picks confirmés."
          : "Le flux ne signale actuellement aucune partie couverte. Le site réessaie automatiquement toutes les quinze secondes.",
      );
    else
      html = snapshot.matches
        .map(
          (m) =>
            `<button class="match-card${m.id === selectedMatchId ? " is-selected" : ""}" data-match="${esc(m.id)}" aria-pressed="${m.id === selectedMatchId}"><span class="match-league">${esc(m.league || "PRO")}${m.gameNumber ? ` · G${esc(m.gameNumber)}` : ""}</span><span class="match-teams">${esc(m.blue.name)} <span>VS</span> ${esc(m.red.name)}</span><span class="match-edge">${esc(liveVerdictLine(m))}</span><span class="match-state">${esc(STATUS_LABEL[m.status])}${m.stale ? " · DIFFÉRÉ" : ""}</span><span class="match-chevron" aria-hidden="true">↗</span></button>`,
        )
        .join("");
  }
  $("#live-matches").innerHTML = html;
  const match = currentMatch();
  $("#live-draft").hidden =
    !match || snapshot.status !== "ok" || Boolean(feedError);
  if (match && !$("#live-draft").hidden) {
    $("#live-draft").innerHTML =
      `<div class="live-draft-label"><h3>${esc(match.league || "Match professionnel")} ${match.gameNumber ? `/ Partie ${esc(match.gameNumber)}` : ""}</h3><span>${match.rolesConfirmed ? "RÔLES CONFIRMÉS" : "FLEX PICKS NON RÉSOLUS"}${match.patch ? ` · PATCH ${esc(match.patch)}` : ""}</span></div><div class="draft-grid"><div class="team-panel blue-team">${teamHTML("blue", match.blue.picks, { readonly: true, name: match.blue.name })}</div><div class="versus" aria-hidden="true">VS</div><div class="team-panel red-team">${teamHTML("red", match.red.picks, { readonly: true, name: match.red.name })}</div></div>`;
    handleImageErrors($("#live-draft"));
  }
  if (snapshot?.status === "ok")
    $("#live-source-note").textContent =
      `Source : ${snapshot.provider || "fournisseur"} · ${snapshot.capabilities?.draftPhase ? "Couverture de la phase de draft déclarée par le fournisseur." : "Compositions reçues depuis le flux de partie ; aucun suivi de la sélection garanti."} ${snapshot.delaySeconds != null ? `Délai déclaré : ${snapshot.delaySeconds} s.` : "Délai de diffusion inconnu."}${snapshot.observationClock === "receipt" ? " Horodatage de réception ; pas de garantie de temps réel en jeu." : ""}`;
  if (view === "live") {
    const readiness = getLiveReadiness(feedError ? null : snapshot, match, {
      staleAfterMs: config.staleAfterMs,
    });
    const liveDraft = match
      ? { blue: match.blue.picks, red: match.red.picks }
      : emptyDraft();
    renderResult(judge(liveDraft, { live: true }), {
      blocked: readiness.ready ? null : readiness.reason,
      names: match
        ? { blue: match.blue.name, red: match.red.name }
        : SIDE_LABEL,
    });
  }
}
async function refreshFeed() {
  clearTimeout(pollTimer);
  if (!endpoint) {
    snapshot = {
      version: 1,
      status: "not_configured",
      matches: [],
      capabilities: { draftPhase: false, rolesConfirmed: false },
    };
    if (view === "live") renderLive();
    return;
  }
  if (fetchController) return;
  const generation = requestGeneration;
  fetchController = new AbortController();
  const controller = fetchController;
  const timeout = setTimeout(() => controller.abort(), 10000);
  $("#refresh-button").disabled = true;
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const length = Number(response.headers.get("content-length"));
    if (length > 1000000) throw Error("Réponse du flux trop volumineuse.");
    const value = await response.text();
    if (value.length > 1000000)
      throw Error("Réponse du flux trop volumineuse.");
    const incoming = validateClientSnapshot(JSON.parse(value));
    if (generation !== requestGeneration) return;
    if (!response.ok && incoming.status === "ok")
      throw Error("Le proxy a refusé la requête.");
    snapshot = incoming;
    feedError = null;
    if (!snapshot.matches.some((m) => m.id === selectedMatchId))
      selectedMatchId =
        snapshot.matches.find((m) => m.status !== "finished")?.id ||
        snapshot.matches[0]?.id ||
        null;
  } catch (error) {
    if (generation !== requestGeneration) return;
    snapshot = null;
    selectedMatchId = null;
    feedError =
      error.name === "AbortError"
        ? "Le délai de connexion est dépassé. Le verdict est suspendu."
        : "Impossible de lire le flux. Vérifiez son URL, sa disponibilité et l’autorisation CORS du proxy.";
  } finally {
    clearTimeout(timeout);
    if (fetchController === controller) fetchController = null;
    $("#refresh-button").disabled = false;
    if (view === "live") renderLive();
    if (view === "coach") renderCoachPro();
    pollTimer = setTimeout(
      refreshFeed,
      generation !== requestGeneration
        ? 0
        : document.hidden
          ? 60000
          : config.pollIntervalMs,
    );
  }
}

function judgedExamples() {
  const rank = (c) =>
    (c.verdict.timing === "draft" ? 4 : 0) +
    (c.rosterVerified ? 2 : 0) +
    (c.reasons?.length ? 1 : 0);
  return (memory?.cases || [])
    .filter((c) => c.verdict.side !== "even")
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        b.verdict.confidence - a.verdict.confidence ||
        a.id.localeCompare(b.id),
    );
}
function loadCase(item) {
  draft = { blue: { ...item.blue }, red: { ...item.red } };
  const line = matchLine({ teams: item.match?.teams, match: item.match });
  origin = `Draft jugée par Kazewa${line ? ` · ${line}` : ""}.`;
  setView("lab");
  if (labMode === "quick") {
    refreshQuickFields();
    analyzeManual();
  }
}
function loadExample() {
  const cases = judgedExamples();
  if (cases.length) {
    exampleIndex = (exampleIndex + 1) % cases.length;
    loadCase(cases[exampleIndex]);
    return;
  }
  draft = {
    blue: { top: "Sion", jng: "Maokai", mid: "Azir", bot: "Jinx", sup: "Lulu" },
    red: { top: "Jayce", jng: "Nidalee", mid: "LeBlanc", bot: "Jhin", sup: "Pyke" },
  };
  origin =
    "Exemple : ces compositions ne représentent pas un match jugé par Kazewa.";
  setView("lab");
  if (labMode === "quick") {
    refreshQuickFields();
    analyzeManual();
  }
}
function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("button[data-view]");
    if (viewButton)
      setView(viewButton.dataset.view, {
        scroll: viewButton.classList.contains("text-button"),
      });
    const matchButton = event.target.closest("[data-match]");
    if (matchButton) {
      selectedMatchId = matchButton.dataset.match;
      renderLive();
    }
    if (event.target.closest("[data-open-settings]")) {
      $("#feed-settings").hidden = false;
      $("#feed-url").focus();
    }
  });
  $("#workspace").addEventListener("click", (event) => {
    const precedent = event.target.closest("[data-load-case]");
    if (precedent) {
      const item = memory?.cases?.find((c) => c.id === precedent.dataset.loadCase);
      if (item) loadCase(item);
      return;
    }
    const card = event.target.closest("[data-card]");
    if (card) {
      const name = card.dataset.card;
      cardChampion = cardChampion === name ? null : name;
      renderTeams();
      [...document.querySelectorAll("[data-card]")]
        .find((button) => button.dataset.card === name)
        ?.focus();
      if (cardChampion)
        $("#champion-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (event.target.closest("[data-close-card]")) {
      const name = cardChampion;
      cardChampion = null;
      renderTeams();
      [...document.querySelectorAll("[data-card]")]
        .find((button) => button.dataset.card === name)
        ?.focus();
    }
  });
  $("#coach-view").addEventListener("click", (event) => {
    const seat = event.target.closest("[data-seat]");
    if (seat && seat.dataset.seat !== coach.seat) {
      coach = createSession(seat.dataset.seat);
      coachFocus = "self";
      renderCoach();
    }
    const lane = event.target.closest("[data-lane]");
    if (lane) {
      coachLane = lane.dataset.lane;
      renderCoach();
    }
    const tile = event.target.closest("[data-champion]");
    if (tile && !tile.disabled)
      acceptCoachAction(tile.dataset.champion, tile.dataset.role || null);
    const pro = event.target.closest("[data-pro-match]");
    if (pro) {
      coachFocus = pro.dataset.proMatch;
      selectedMatchId = coachFocus;
      renderCoach();
    }
  });
  $("#coach-search").addEventListener("input", (event) => {
    coachQuery = event.target.value;
    if (view !== "coach" || !knowledge) return;
    renderCoachGrid(advise(coach, coachBrain, { limit: 5 }));
  });
  $("#coach-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const typed = foldChampion(coachQuery);
    // An empty box validates nothing: Enter is not "take the first suggestion".
    if (!typed) return;
    const tile = $("#coach-grid button");
    const name = tile ? foldChampion(tile.dataset.champion) : "";
    if (!tile || !(name === typed || name.startsWith(typed))) {
      toast("Aucun champion ne commence par ce que tu as tapé.");
      return;
    }
    if (tile.disabled) {
      toast(`${tile.dataset.champion} n’est pas disponible pour ce tour.`);
      return;
    }
    acceptCoachAction(tile.dataset.champion, tile.dataset.role || null);
  });
  $("#coach-undo").addEventListener("click", () => {
    coach = undo(coach);
    coachFocus = "self";
    renderCoach();
  });
  $("#lab-view").addEventListener("click", (event) => {
    const mode = event.target.closest("[data-lab-mode]");
    if (mode && mode.dataset.labMode !== labMode) setLabMode(mode.dataset.labMode);
  });
  for (const side of ["blue", "red"])
    $(`#quick-${side}`).addEventListener("input", () => applyQuick(side));
  $("#quick-draft").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-quick-role]");
    if (!chip) return;
    chooseQuickRole(chip.dataset.quickSide, chip.dataset.quickRole);
  });
  $("#lab-view").addEventListener("change", (event) => {
    const select = event.target.closest("[data-role]");
    if (!select) return;
    draft[select.dataset.side][select.dataset.role] = select.value;
    origin = "Composition manuelle.";
    analyzeManual();
    $(
      `select[data-side="${select.dataset.side}"][data-role="${select.dataset.role}"]`,
    )?.focus();
  });
  $("#example-button").addEventListener("click", loadExample);
  $("#swap-button").addEventListener("click", () => {
    draft = { blue: { ...draft.red }, red: { ...draft.blue } };
    quickSwap = null;
    origin = "Équipes inversées · le verdict suit les compositions.";
    if (labMode === "quick") refreshQuickFields();
    analyzeManual();
  });
  $("#clear-button").addEventListener("click", () => {
    draft = emptyDraft();
    quickSwap = null;
    cardChampion = null;
    origin = "Choisis les dix champions par rôle.";
    if (labMode === "quick") refreshQuickFields();
    analyzeManual();
  });
  $("#share-button").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.hash = buildDraftHash(draft);
    try {
      await navigator.clipboard.writeText(url.href);
      toast("Lien de la draft copié.");
    } catch {
      history.replaceState(null, "", url.href);
      toast("Le lien de cette draft est dans la barre d’adresse.");
    }
  });
  $("#settings-button").addEventListener("click", () => {
    $("#feed-settings").hidden = !$("#feed-settings").hidden;
    if (!$("#feed-settings").hidden) $("#feed-url").focus();
  });
  $("#refresh-button").addEventListener("click", refreshFeed);
  $("#feed-settings").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const input = $("#feed-url").value.trim();
      endpoint = validateEndpoint(input || defaultEndpoint(), location.href);
      requestGeneration++;
      fetchController?.abort();
      remember("kazewa.liveEndpoint", endpoint);
      snapshot = null;
      selectedMatchId = null;
      feedError = null;
      $("#feed-settings-message").textContent = endpoint
        ? "Adresse enregistrée. Connexion…"
        : "Aucune source configurée.";
      if (view === "live") renderLive();
      refreshFeed();
    } catch (error) {
      $("#feed-settings-message").textContent = error.message;
    }
  });
  $("#reset-feed-button").addEventListener("click", () => {
    $("#feed-url").value = "";
    try {
      endpoint = validateEndpoint(defaultEndpoint(), location.href);
      feedError = null;
    } catch {
      endpoint = "";
      feedError =
        "L’adresse par défaut du flux est invalide. Configurez une URL publique HTTPS.";
    }
    remember("kazewa.liveEndpoint", "");
    requestGeneration++;
    fetchController?.abort();
    snapshot = null;
    selectedMatchId = null;
    if (view === "live") renderLive();
    refreshFeed();
  });
  window.addEventListener("hashchange", () => {
    const fromHash = draftFromHash(location.hash);
    if (fromHash) {
      draft = canonicalDraft(fromHash);
      origin = "Draft chargée depuis un lien partagé.";
      setView("lab");
      if (labMode === "quick") {
        refreshQuickFields();
        analyzeManual();
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (view === "live") renderLive();
      refreshFeed();
    }
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(pollTimer);
    clearInterval(freshnessTimer);
    fetchController?.abort();
  });
}

async function init() {
  try {
    [knowledge, evaluation, memory, config, model, championAssets, cards, coachData] =
      await Promise.all([
        getJSON("./data/knowledge.json"),
        getJSON("./data/evaluation.json", true),
        getJSON("./data/memory-site.json", true),
        getJSON("./config.json", true),
        getJSON("./data/model.json", true),
        getJSON("./data/champion-assets.json", true),
        getJSON("./data/champion-cards.json", true),
        getJSON("./data/coach.json", true),
      ]);
    memoryIndex = memory?.cases ? indexMemory(memory) : null;
    relations = cards ? cardRelations(cards) : null;
    coachBrain = coachContext({ knowledge, memory, relations, data: coachData });
    config = { ...fallbackConfig, ...config };
    config.pollIntervalMs = Number.isFinite(Number(config.pollIntervalMs))
      ? Math.min(60000, Math.max(15000, Number(config.pollIntervalMs)))
      : 15000;
    config.staleAfterMs = Math.min(
      180000,
      Math.max(30000, Number(config.staleAfterMs) || 90000),
    );
    if (!/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(config.assetPatch))
      config.assetPatch = fallbackConfig.assetPatch;
    if (!knowledge?.champions || !Array.isArray(knowledge.rules))
      throw Error("La base de connaissances ne peut pas être chargée.");
    try {
      endpoint = validateEndpoint(
        recall("kazewa.liveEndpoint") || defaultEndpoint(),
        location.href,
      );
    } catch {
      endpoint = "";
      feedError =
        "L’adresse du flux enregistrée ou configurée est invalide. L’atelier manuel reste disponible.";
      $("#feed-settings-message").textContent = feedError;
    }
    $("#feed-url").value = endpoint;
    bindEvents();
    renderValidation();
    const shared = draftFromHash(location.hash);
    if (shared) {
      draft = canonicalDraft(shared);
      origin = "Draft chargée depuis un lien partagé.";
      analyzeManual();
    } else loadExample();
    refreshFeed();
    freshnessTimer = setInterval(() => {
      if (document.hidden) return;
      if (view === "live") renderLive();
      if (view === "coach") renderCoachPro();
    }, 10000);
  } catch (error) {
    $("#validation-text").textContent = "Le site n’a pas pu démarrer.";
    $("#workspace").innerHTML =
      `<p class="fatal-error">${esc(error.message)} Vérifiez que les fichiers du site sont servis par HTTP.</p>`;
  }
}
init();
