import { normalizeChampion, ROLES } from "./src/engine.mjs";
import { compositionFromText, foldChampion, swapRoles } from "./src/quick-draft.mjs";
import {
  applyAction,
  coachContext,
  createSession,
  currentStep,
  scoreboard,
  undo,
} from "./src/draft-coach.mjs";
import { playableRoles } from "./src/coach.mjs";
import { LANES } from "./src/lanes.mjs";
import { indexMethod } from "./src/method.mjs";
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
  draftValues = null,
  coachBrain = null,
  method = null,
  methodIndex = null,
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
    method: methodIndex,
  });
}
// The video behind a rule of the method (data/method.json), at its moment.
const COACH_NAME = { shanei: "Shanei", kazewa: "Kazewa", systeme: "Système" };
function ruleLink(id) {
  const rule = methodIndex?.rules?.[id];
  if (!rule || !/^[a-zA-Z0-9_-]{11}$/.test(rule.video || "")) return "";
  const at = Number.isFinite(rule.ts) && rule.ts > 0 ? `&t=${Math.floor(rule.ts)}s` : "";
  const label = `${COACH_NAME[rule.coach] ?? "Vidéo"} · ${rule.title || "vidéo"}`;
  return `<a href="https://www.youtube.com/watch?v=${esc(rule.video)}${at}" target="_blank" rel="noopener noreferrer" title="${esc(rule.text)}">↗ ${esc(label)}</a>`;
}
// Said in a passage the notes of the video mark as badly transcribed or unsettled.
const UNSURE = ' <span class="coach-unsure">(avis moins net dans ses vidéos)</span>';
const frenchDate = (text) => {
  const date = new Date(text + "T12:00:00Z");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
// "LCK · 14 avril 2024 · partie 3". Team names are not shown: a game is its league, its date and its number.
function playedLine(game) {
  const parts = [];
  if (game?.league) parts.push(game.league);
  if (game?.date && frenchDate(game.date)) parts.push(frenchDate(game.date));
  if (game?.game) parts.push(`partie ${game.game}`);
  return parts.join(" · ");
}
// The side is named by its colour only: team names are not part of the site.
function sidePhrase(side) {
  return side === "blue" ? "le côté bleu" : "le côté rouge";
}
function matchLine(kazewa) {
  const parts = [];
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
  const playedFact = judgement.played?.side === "even" ? "" : playedFactLine(judgement.played);
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
    } else {
      badge = "Pas d’estimation";
      title = "Pas d’estimation.";
      description = [
        "Ni ses arguments sur ces champions ni ses fiches champion ne départagent ces deux compositions : le site n’invente pas de côté. La grille de décision de Kazewa, affichée plus bas, est un second avis et n’entre pas dans l’estimation.",
        nearLine,
      ]
        .filter(Boolean)
        .join(" ");
      margin = "—";
      marginLabel = "VERDICT ESTIMÉ";
      note = "Aucune lecture ne tranche";
    }
  }
  $("#verdict-card").dataset.side = side;
  $("#verdict-card").dataset.source = judgement.source;
  $("#verdict-eyebrow").textContent = eyebrow;
  $("#confidence-badge").textContent = badge;
  $("#verdict-title").textContent = title;
  $("#verdict-description").textContent = [splitLine, playedFact, description].filter(Boolean).join(" ");
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
// Shanei's reading of the two compositions: a second opinion, with its measure.
function renderShaneiPanel(judgement, names) {
  const node = $("#shanei-panel");
  const second = $("#verdict-second");
  const reading = judgement.shanei;
  if (!reading) {
    node.hidden = true;
    node.innerHTML = "";
    second.hidden = true;
    second.textContent = "";
    return;
  }
  const r = judgement.reliability?.shanei;
  const sideName = (side) => (names[side] && names[side] !== SIDE_LABEL[side] ? names[side] : side === "blue" ? "côté bleu" : "côté rouge");
  const signed = (value) => formatSignedScore(value);
  const lean =
    reading.side === "even"
      ? "Sa grille ne départage pas les deux compositions."
      : `Sa grille trouve la composition du ${reading.side === "blue" ? "côté bleu" : "côté rouge"} plus saine (${signed(reading[reading.side].score)} contre ${signed(reading[reading.side === "blue" ? "red" : "blue"].score)}).`;
  const agrees =
    reading.side === "even" || judgement.lean.side === "even"
      ? ""
      : reading.side === judgement.lean.side
        ? " Même côté que le verdict ci-dessus."
        : " L’autre côté que le verdict ci-dessus.";
  second.hidden = false;
  second.textContent = `Second avis, la méthode de Shanei : ${lean.charAt(0).toLowerCase()}${lean.slice(1)}${agrees}`;
  const MARK = { fault: "−", strength: "+", remark: "·" };
  const MARK_LABEL = { fault: "Il le reprocherait : ", strength: "Il le validerait : ", remark: "Remarque : " };
  const column = (side) => {
    const team = reading[side];
    const items = team.items
      .map(
        (item) =>
          `<li class="is-${esc(item.kind)}"><span class="shanei-mark" aria-hidden="true">${MARK[item.kind]}</span><span><span class="visually-hidden">${MARK_LABEL[item.kind]}</span>${esc(item.text)}${item.unsure ? UNSURE : ""} <span class="source-links">${ruleLink(item.rule)}</span></span></li>`,
      )
      .join("");
    return `<article class="shanei-side" data-side="${side}"><h4>${esc(sideName(side))} · ${team.label ? esc(team.label) : "famille illisible"}<span class="side-tag">${esc(signed(team.score))}</span></h4><ul class="shanei-items">${items}</ul></article>`;
  };
  const measure = r?.n
    ? `Sur les ${r.n} drafts jugées par Kazewa où cette grille penche d’un côté, la composition qu’elle trouve la plus saine est celle qu’il préférait ${formatPct(r.agreement)} du temps${r.winner?.n ? `, et celle qui a gagné ${formatPct(r.winner.agreement)} du temps sur les ${r.winner.n.toLocaleString("fr-FR")} parties pro où elle penche` : ""} : la grille décrit comment une compo est construite, elle ne prédit ni le vainqueur ni l’avis de Kazewa.`
    : "La grille décrit comment une composition est construite. Elle ne prédit ni le vainqueur ni l’avis de Kazewa.";
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>La lecture de Shanei</h3><span class="mono">${reading.side === "even" ? "ÉQUILIBRE" : `${reading.side === "blue" ? "BLEU" : "ROUGE"} · ÉCART ${esc(String(Math.abs(reading.margin)).replace(".", ","))}`}</span></div><p class="fine-print">La méthode de draft du coach Shanei, appliquée aux deux compositions : la famille du bloc jungle, mid, ADC et support, ce qu’il reprocherait (−), ce qu’il validerait (+) et ses remarques (·), avec la vidéo où il donne la règle ; les duos de la table des combos de son cours n’ont pas de vidéo. Il classe lui-même la plupart des champions dans ses familles ; les autres sont classés d’après ses définitions, et un champion qu’il n’a pas classé lui-même n’entre pas dans la lecture de la famille : il n’est jamais compté hors thème. Ce qui décrit le kit d’un champion (tank, enchanteur, type de dégâts, engage, désengage, poke, ultime global, waveclear, mobilité, assassin) vient d’une grille de kits, pas de ses mots.</p><div class="shanei-grid">${column("blue")}${column("red")}</div><p class="fine-print">${esc(lean)} ${esc(measure)}</p>`;
}
// The decision grid of the two coaches: a second opinion, never the estimate.
const GRID_CONFIDENCE = ["aucun avis", "avis faible", "avis net", "avis tranché"];
function renderGridPanel(judgement) {
  const node = $("#grid-panel");
  if (!node) return;
  const reading = judgement.theory;
  if (!reading) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const r = judgement.reliability?.theory;
  const sideWord = (side) => (side === "blue" ? "côté bleu" : "côté rouge");
  const lean =
    reading.side === "even"
      ? "Sa grille ne départage pas les deux compositions."
      : reading.confidence === 0
        ? `Sa grille ne tranche pas : elle penche de peu pour le ${sideWord(reading.side)}.`
        : `Sa grille penche pour le ${sideWord(reading.side)} (${GRID_CONFIDENCE[reading.confidence]}).`;
  const measure = r?.n
    ? `Sur ${r.n} drafts jugées où elle penche, elle désigne son verdict ${formatPct(r.agreement)} du temps (intervalle ${formatPct(r.low)} à ${formatPct(r.high)}) : ${r.low <= 0.5 && r.high >= 0.5 ? "son intervalle contient le hasard, soit une pièce lancée" : r.low > 0.5 ? "un peu mieux qu’une pièce lancée" : "moins bien qu’une pièce lancée"}. Sa confiance ne rehausse pas ce taux.`
    : "";
  const top = (side) =>
    (reading.reasons ?? [])
      .filter((item) => item.side === side && item.points)
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
      .slice(0, 2)
      .map((item) => `<li><span class="side-tag">${side === "blue" ? "BLEU" : "ROUGE"}</span> ${esc(item.text)}</li>`)
      .join("");
  const reasons = top("blue") + top("red");
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>La grille de décision de Kazewa</h3><span class="mono">SECOND AVIS</span></div><p class="fine-print">${esc(lean)} Elle n’entre pas dans l’estimation. ${esc(measure)} Elle ne lit aucune partie professionnelle.</p>${reasons ? `<ol class="kazewa-reasons">${reasons}</ol>` : ""}`;
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
  renderShaneiPanel(judgement, names);
  renderGridPanel(judgement);
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
// A professional game already played with these ten champions is a fact: the
// side that won. It never sets the estimate.
function playedFactLine(played) {
  if (!played?.games?.length) return "";
  if (played.side === "even")
    return "Partie pro déjà jouée avec ces dix champions : chaque côté a gagné, le résultat ne départage pas.";
  const sideWord = played.side === "blue" ? "côté bleu" : "côté rouge";
  return played.games.length === 1
    ? `Fait : avec ces dix champions, une partie pro déjà jouée, le ${sideWord} a gagné.`
    : `Fait : avec ces dix champions, ${played.games.length} parties pro déjà jouées ; le ${sideWord} a gagné chaque fois.`;
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
  const prefix = playedFactLine(judgement.played) || "Draft inédite.";
  let sentence;
  if (lean.basis === "memory")
    sentence = `Kazewa a jugé cette draft : il préfère ${sidePhrase(lean.side, judgement.kazewa)}. Confiance ${judgement.kazewa.verdict.confidence}/3.`;
  else if (lean.basis === "undecided")
    sentence = "Kazewa a commenté cette draft sans trancher.";
  else if (lean.basis === "balance")
    sentence = `${prefix} Pas d’estimation : ni ses arguments ni ses fiches ne départagent les deux compositions.`;
  else {
    const all = judgement.reliability ?? {};
    const source = {
      arguments: ["ses arguments sur ces champions", all.arguments],
      cards: ["ses fiches champion", all.cards],
    }[lean.basis] ?? ["son corpus", null];
    sentence = `${prefix} Verdict estimé d’après ${source[0]} : ${sidePhrase(lean.side, null)}${source[1] ? ` (fiabilité mesurée ${formatPct(source[1].agreement)})` : ""}.`;
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
  // The card on Shanei's grid stands only when the grid is loaded.
  const shaneiStep = $("#method-step-shanei");
  if (shaneiStep) shaneiStep.hidden = !methodIndex;
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
    ? `${mem.decided} drafts jugées par Kazewa en mémoire : son verdict exact, ses raisons, sa vidéo. Toute autre draft reçoit une estimation d’après ses arguments, puis ses fiches champion, quand l’un des deux départage les compositions : juste ${formatPct(every?.all?.agreement)} du temps sur des vidéos tenues à l’écart, pour ${formatPct(every?.coverage)} des drafts. Sinon le site ne donne pas d’estimation ; la grille de décision de Kazewa reste un second avis. Le résultat d’une partie déjà jouée est affiché comme un fait, pas comme le verdict.`
    : "Mémoire des verdicts indisponible.";
  const interval = (r) =>
    r?.n ? `${formatPct(r.low)} à ${formatPct(r.high)}` : "—";
  const row = (name, r, remark) =>
    `<tr><td>${esc(name)}</td><td>${r?.n ?? "—"}</td><td>${formatPct(r?.agreement)}</td><td>${esc(interval(r))}</td><td>${esc(remark)}</td></tr>`;
  const sideName = order?.sideOnly?.side === "blue" ? "côté bleu" : "côté rouge";
  $("#evaluation-details").innerHTML =
    `<span class="eyebrow">CE QUI EST MESURÉ</span><h3>Sa mémoire est exacte. Son avis estimé ne l’est pas toujours.</h3><p>Deux questions différentes, jamais mélangées. Une draft que Kazewa a commentée renvoie son verdict : c’est une restitution, juste par construction. Une draft qu’il n’a pas commentée reçoit un verdict estimé : il est mesuré sur des séries et des vidéos tenues à l’écart.</p><div class="eval-stats"><div class="eval-stat"><strong>${mem?.decided ?? "—"}</strong><span>DRAFTS AVEC SON VERDICT</span></div><div class="eval-stat"><strong>${mem?.videos ?? "—"}</strong><span>VIDÉOS SOURCES</span></div><div class="eval-stat"><strong>${formatPct(said?.agreement)}</strong><span>DRAFT INÉDITE, D’APRÈS SES ARGUMENTS</span></div><div class="eval-stat"><strong>${formatPct(every?.all?.agreement)}</strong><span>DRAFT JAMAIS JOUÉE, VIDÉOS TENUES À L’ÉCART</span></div>${won?.n ? `<div class="eval-stat"><strong>${formatPct(won.agreement)}</strong><span>PARTIE DÉJÀ JOUÉE, D’APRÈS LE RÉSULTAT</span></div>` : ""}</div><table><thead><tr><th>Situation</th><th>Drafts</th><th>Accord</th><th>Intervalle de confiance</th><th>Lecture</th></tr></thead><tbody>${row("Draft qu’il a jugée (mémoire)", mem?.selfRecall, "Restitution de son verdict, pas une prédiction")}${row("Draft jamais jouée · verdict estimé", every?.all, "Arguments puis fiches champion, sur des vidéos tenues à l’écart ; sans estimation quand ni l’un ni l’autre ne départage")}${everyPlayed?.all?.n ? row("Partie déjà jouée · si son résultat servait de verdict", everyPlayed.all, `Mesure seule, jamais affichée comme estimation : le résultat tient lieu de réponse pour ${everyPlayed.byReading?.result?.n ?? "—"} drafts`) : ""}${won?.n ? row("Partie déjà jouée · le côté qui a gagné", won, "Aucun réglage : il préfère le plus souvent le vainqueur") : ""}${won?.draftTiming?.n ? row("… dont ses avis donnés pendant la draft", won.draftTiming, "Dits avant le début de la partie, qu’il regarde en principe sans la connaître") : ""}${won?.afterTheGame?.n ? row("… dont ses avis de revue ou tardifs", won.afterTheGame, "Peuvent connaître le résultat") : ""}${row("Draft inédite · ses arguments venus d’autres vidéos", said, "Aucun réglage : on compte ses arguments par côté")}${said?.sideOnly ? row("Règle sans modèle · toujours le même côté, mêmes drafts", said.sideOnly, "La barre à dépasser") : ""}${row("Draft inédite · ses fiches champion", cardFigures?.heldOut, "Vidéos que les fiches n’ont jamais vues")}${row("Ses fiches champion · vidéos dont elles sont tirées", cardFigures?.writtenFrom, "Ne prouve rien : elles résument ces vidéos")}${row("Calculateur structurel, seul · drafts jamais vues", calc?.neverSeen, "Pile ou face : une description, non utilisée par l’estimation")}${row("Calculateur · drafts qui ont servi à le régler", calc?.tunedOn, "Ne prouve rien : il a été réglé dessus")}${methodIndex && unseen?.shaneiGrid?.n ? row("Second avis · la grille de Shanei, face au verdict de Kazewa", unseen.shaneiGrid, "Drafts où la grille penche d’un côté ; n’entre pas dans le verdict estimé") : ""}${row("Lecture écartée · ordre des picks", order, "Écart non établi avec la règle ci-dessous")}${order?.sideOnly ? row(`Règle sans modèle · répondre toujours « ${sideName} »`, order.sideOnly, "Sur les mêmes drafts") : ""}</tbody></table><p>Ses arguments : pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos et qui s’appliquent encore (mêmes champions, même relation, mêmes rôles), et on compte de quel côté ils penchent. Rien n’est réglé sur ses verdicts. Cette lecture répond pour ${formatPct(said?.coverage)} des drafts jugées.${said?.overSideOnly ? ` Face à la règle « toujours le même côté », ses arguments ont raison seuls sur ${said.overSideOnly.argumentsRightRuleWrong} drafts et tort seuls sur ${said.overSideOnly.ruleRightArgumentsWrong} : ${said.overSideOnly.p < 0.05 ? "l’avantage est établi" : "l’avantage n’est pas encore établi statistiquement"} (p = ${said.overSideOnly.p.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}).` : ""}</p>${won?.n ? `<p>Partie déjà jouée : quand les dix champions sont ceux d’une partie pro qui a eu lieu (${formatPct(won.coverage)} des drafts qu’il a jugées sont dans ce cas), le site nomme le côté qui a gagné. Ce n’est pas un jugement sur la draft. Sur ${won.n} parties qu’il a commentées, l’équipe qu’il préférait est celle qui a gagné ${formatPct(won.agreement)} du temps ; quand ses arguments désignent l’autre côté, le résultat a raison ${won.withArguments?.oppositeSides?.resultRight} fois sur ${won.withArguments?.oppositeSides?.n}. Cette lecture n’existe pas pour une draft qui n’a pas été jouée, et elle est mesurée sur les parties qu’il a choisi de commenter.</p>` : ""}<p>Une draft reçoit une estimation quand ses arguments la départagent. Sinon, le site passe à ses fiches champion (qui va bien avec qui, qui prend le dessus sur qui). Si les fiches ne départagent pas non plus, il ne donne pas d’estimation. Chaque verdict dit laquelle de ces lectures a servi.</p>${cardFigures?.writtenFrom?.n ? `<p>Ce que montre l’écart entre les deux lignes des fiches : sur les vidéos qu’elles résument, les fiches retrouvent son verdict ${formatPct(cardFigures.writtenFrom.agreement)} du temps ; sur les vidéos qu’elles n’ont jamais vues, ${formatPct(cardFigures.heldOut?.agreement)}. Ce qu’il a dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions, beaucoup moins.</p>` : ""}${order?.sideOnly ? `<p>L’ordre des picks a été essayé puis écarté. Sur ${order.n} drafts où il est connu, lire qui répond à qui dans chaque lane désigne son verdict ${formatPct(order.agreement)} du temps, contre ${formatPct(order.sideOnly.agreement)} en répondant toujours « ${sideName} » : ${order.overSideOnly?.p < 0.05 ? "un écart établi" : "l’écart n’est pas établi"}. Quand cette lecture va dans le sens de ses arguments, le résultat est de ${formatPct(said?.withPickOrder?.sameSide?.agreement)}, contre ${formatPct(said?.agreement)} pour ses arguments seuls. Elle avait paru utile sur un échantillon plus petit.</p>` : ""}${methodIndex && unseen?.shaneiGrid?.n ? `<p>La grille de Shanei est un second avis, affiché sous chaque verdict : la famille de chaque composition et ce qu’il reprocherait à sa construction. Elle ne sert pas au verdict estimé. Sur les ${unseen.shaneiGrid.n} drafts jugées par Kazewa où elle penche d’un côté (${formatPct(unseen.shaneiGrid.coverage)} des drafts jugées), la composition qu’elle trouve la plus saine est celle qu’il préférait ${formatPct(unseen.shaneiGrid.agreement)} du temps${unseen.shaneiGrid.proGames?.n ? `, et sur les ${unseen.shaneiGrid.proGames.n.toLocaleString("fr-FR")} parties pro où elle penche (sur ${unseen.shaneiGrid.proGames.games.toLocaleString("fr-FR")}) c’est celle qui a gagné ${formatPct(unseen.shaneiGrid.proGames.agreement)} du temps ; elle ne trouve rien à reprocher à ${formatPct(unseen.shaneiGrid.proGames.faultless)} des compositions pro` : ""}. Une composition bien construite selon lui ne gagne pas plus souvent à ce niveau : la grille dit comment une draft est bâtie, pas qui gagne.</p>` : ""}<p>Ce qui ne marche pas non plus : les profils de champions, leur identité et les statistiques de 44 000 matchs pros ne suivent pas ses avis sur des drafts tenues à l’écart. Ses verdicts s’appuient sur les bans, les joueurs et la méta du moment, que dix champions ne portent pas.</p>${!won?.n && evaluation?.reference?.realWinnerMatchesVerdict?.n ? `<p>Repère : dans ${formatPct(evaluation.reference.realWinnerMatchesVerdict.agreement)} des ${evaluation.reference.realWinnerMatchesVerdict.n} drafts jugées dont le résultat est connu, l’équipe qu’il préférait a gagné. Une partie de ses revues est enregistrée en connaissant le résultat.</p>` : ""}<p>Les résultats et les compositions des parties pro viennent des données de match d’<a href="https://oracleselixir.com/" target="_blank" rel="noopener noreferrer">Oracle’s Elixir ↗</a>.</p><p><a href="./data/evaluation.json" target="_blank" rel="noopener">Rapport de mesure ↗</a> · <a href="./data/memory-site.json" target="_blank" rel="noopener">Mémoire des verdicts ↗</a> · <a href="./data/model.json" target="_blank" rel="noopener">Fiabilité de chaque lecture ↗</a></p>`;
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
  if (judgement.lean.side === "even") return "Draft inédite. Pas d’estimation : ses arguments et ses fiches ne départagent pas les deux compositions.";
  const r = judgement.reliability?.[basis];
  const from = {
    arguments: "ses arguments",
    cards: "ses fiches champion",
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
  node.innerHTML = `<h3>Games pros en direct</h3>${body}<p class="fine-print">Le flux public donne les champions par rôle quand la partie est lisible. Il ne donne pas les bans ni l’ordre des picks. Le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, un verdict estimé d’après ses arguments puis ses fiches champion, avec sa fiabilité, et sans estimation quand ni l’un ni l’autre ne départage. Le résultat d’une autre partie jouée avec les mêmes champions n’est pas utilisé pour une partie en cours.</p>`;
}
function championImage(name, size) {
  return `<img src="https://ddragon.leagueoflegends.com/cdn/${esc(config.assetPatch)}/img/champion/${esc(assetId(name))}.png" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`;
}
function renderDraftSide(side, step) {
  const active = Boolean(step && step.side === side);
  // A champion picked without a role keeps its roles: it is marked flexible while it has two or more.
  const flexible = new Set(coach.log.filter((e) => e.action === "pick" && e.side === side && !e.explicit && (e.flex?.length ?? 0) >= 2).map((e) => e.champion));
  const bans = Array.from({ length: 5 }, (_, index) => {
    const name = coach.bans[side][index];
    const now = active && step.action === "ban" && coach.bans[side].length === index;
    return `<div class="ban-slot${now ? " is-now" : ""}">${name ? championImage(name, 40) : ""}</div>`;
  }).join("");
  const picks = ["bot", "jng", "mid", "sup", "top"]
    .map((role) => {
      const name = coach.picks[side][role];
      return `<div class="pick-slot"><div class="pick-face">${name ? championImage(name, 46) : ""}</div><div><span>${ROLE_LABEL[role]}</span><strong>${name ? esc(name) : "—"}</strong>${name && flexible.has(name) ? ' <span class="pick-flex">flex</span>' : ""}</div></div>`;
    })
    .join("");
  return `<div class="team-heading"><span class="team-side">${side === "blue" ? "BLUE SIDE" : "RED SIDE"}</span><h3>${side === coach.userSide ? "Ton côté" : "Adverse"}</h3></div><div class="ban-row">${bans}</div>${picks}`;
}
function formatScore(value) {
  return Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}
// Every champion, best first, by the draft system's score in the state of the draft. The role
// filter gives the score in that role; a typed name is looked for among every champion.
function renderCoachGrid() {
  const query = foldChampion(coachQuery);
  const lane = coachLane === "all" ? null : coachLane;
  const done = !currentStep(coach);
  const taken = coachTaken();
  const board = scoreboard(coach, coachBrain, { role: query ? null : lane });
  // A typed name is looked for among every champion. Under a lane filter it takes that lane's
  // row when the champion plays there, so that a click puts it in the lane that is filtered.
  const inLane = query && lane ? new Map(scoreboard(coach, coachBrain, { role: lane }).map((row) => [row.champion, row])) : new Map();
  // The exact name first, then the names that start with it, then the others; each group by score.
  // Enter takes the first tile, so the first tile is the best of the closest names.
  const closeness = (name) => {
    const folded = foldChampion(name);
    return folded === query ? 0 : folded.startsWith(query) ? 1 : 2;
  };
  const scoreOf = (row) => (row.score === null ? -Infinity : row.score);
  const names = query
    ? board
        .filter((row) => foldChampion(row.champion).includes(query))
        .map((row) => inLane.get(row.champion) ?? row)
        .sort((a, b) => closeness(a.champion) - closeness(b.champion) || scoreOf(b) - scoreOf(a) || a.champion.localeCompare(b.champion, "fr"))
    : board;
  // The rank is the place in the list shown, among the champions that have a score.
  let scored = 0;
  const place = new Map(names.filter((row) => row.score !== null).map((row) => [row.champion, ++scored]));
  $("#coach-grid").innerHTML = names
    .map((row) => {
      const name = row.champion;
      const rank = place.get(name) ?? null;
      const blocked = done || taken.has(name);
      const score = row.score === null ? "" : formatScore(row.score);
      const label = [name, rank ? `rang ${rank}` : "", score ? `score ${score}` : "", row.role ? ROLE_LABEL[row.role] : ""]
        .filter(Boolean)
        .join(", ");
      return `<button type="button" class="champ-tile${blocked ? " is-unavailable" : ""}" data-champion="${esc(name)}"${lane && row.role === lane ? ` data-role="${esc(row.role)}"` : ""} aria-label="${esc(label)}"${blocked ? " disabled" : ""}><span class="champ-face">${championImage(name, 74)}${rank ? `<span class="champ-rank">${rank}</span>` : ""}${score ? `<span class="champ-score">${esc(score)}</span>` : ""}</span>${row.role ? `<span class="champ-role">${esc(ROLE_LABEL[row.role])}</span>` : ""}${row.duo ? `<span class="champ-combo">combo ${esc(row.duo)}</span>` : row.opens ? `<span class="champ-combo">ouvre ${esc(row.opens)}</span>` : ""}<span class="champ-name">${esc(name)}</span></button>`;
    })
    .join("");
}
function renderCoach() {
  if (view !== "coach" || !knowledge || !coachBrain) return;
  const step = currentStep(coach);
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
  $("#coach-turn").textContent = step
    ? `${step.phase} · ${step.index + 1}/20 · ${step.ours ? "à toi" : "à eux"} de ${step.action === "ban" ? "bannir" : "pick"}`
    : "Draft complète";
  $("#coach-blue").innerHTML = renderDraftSide("blue", step);
  $("#coach-red").innerHTML = renderDraftSide("red", step);
  renderCoachGrid();
  renderCoachPro();
  if (coachFocus !== "self") {
    const match = snapshot?.matches?.find((item) => item.id === coachFocus);
    if (!match) {
      coachFocus = "self";
      renderResult(step ? { status: "incomplete", warnings: [] } : judge(coach.picks));
      if (step) {
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
  if (!step) renderResult(judge(coach.picks));
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
    renderCoachGrid();
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
    [knowledge, evaluation, memory, config, model, championAssets, cards, coachData, method, draftValues] =
      await Promise.all([
        getJSON("./data/knowledge.json"),
        getJSON("./data/evaluation.json", true),
        getJSON("./data/memory-site.json", true),
        getJSON("./config.json", true),
        getJSON("./data/model.json", true),
        getJSON("./data/champion-assets.json", true),
        getJSON("./data/champion-cards.json", true),
        getJSON("./data/coach.json", true),
        getJSON("./data/method.json", true),
        getJSON("./data/draft-values.json", true),
      ]);
    memoryIndex = memory?.cases ? indexMemory(memory) : null;
    relations = cards ? cardRelations(cards) : null;
    methodIndex = indexMethod(method);
    coachBrain = coachContext({ knowledge, memory, relations, data: coachData, method, draftValues });
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
