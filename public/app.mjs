import { normalizeChampion, ROLES } from "./src/engine.mjs";
import { compositionFromText, swapRoles } from "./src/quick-draft.mjs";
import {
  advise,
  applyAction,
  createSession,
  undo,
} from "./src/draft-coach.mjs";
import { LANES } from "./src/lanes.mjs";
import { championReads, indexMemory } from "./src/memory.mjs";
import { cardRelations } from "./src/relations.mjs";
import { judgeDraft } from "./src/verdict.mjs";
import {
  emptyDraft,
  validateEndpoint,
  draftFromHash,
  laterFromHash,
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
  championAssets,
  config = fallbackConfig;
// Pick order typed for the draft on screen: role -> side that picked later.
let laterInput = {},
  cardChampion = null,
  lastJudgement = null;
let view = "lab",
  labMode = "roles",
  coach = createSession("first"),
  coachFocus = "self",
  coachQuery = "",
  coachLane = "all",
  coachScores = new Map(),
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
function typedLater() {
  return ROLES.every((role) => ["blue", "red"].includes(laterInput[role]))
    ? { ...laterInput }
    : null;
}
// What the lab passes to the judgement: nothing until the visitor types, then
// exactly what is typed (a partial order gives no tendency).
function editedLater() {
  return Object.keys(laterInput).length ? { ...laterInput } : null;
}
function judge(value, later = null) {
  return judgeDraft(value, {
    knowledge,
    memory: memoryIndex,
    model,
    later,
    relations,
  });
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
  if (kazewa?.match?.date) {
    const date = new Date(kazewa.match.date + "T12:00:00Z");
    if (!Number.isNaN(date.getTime()))
      parts.push(
        date.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
  }
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
function renderVerdictCard(judgement, names, orderEditable) {
  const kazewa = judgement.kazewa;
  const lean = judgement.lean;
  const order = judgement.tendency;
  const reliability = order?.reliability;
  const near = judgement.near;
  const hasOrder = order?.basis === "order" && order.side !== "even";
  const sideOnly = reliability?.sideOnly;
  const measured = reliability
    ? `Testée sur ${reliability.n} drafts de Kazewa qui n’ont pas servi à la régler, elle retrouve son verdict ${formatPct(reliability.agreement)} du temps (entre ${formatPct(reliability.low)} et ${formatPct(reliability.high)})${sideOnly ? ` ; répondre toujours « ${sideOnly.side === "blue" ? "côté bleu" : "côté rouge"} » donne déjà ${formatPct(sideOnly.agreement)}` : ""}.`
    : "";
  const noOrder = orderEditable
    ? "Indique plus bas qui a pick en dernier dans chaque lane, et lis ses avis sur les drafts les plus proches."
    : "L’ordre des picks n’est pas connu ici : pas de tendance.";
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
      [
        kazewa.label,
        hasOrder
          ? `À titre indicatif, l’ordre des picks pencherait vers ${sidePhrase(order.side, null, names)}${reliability ? ` (fiabilité mesurée ${formatPct(reliability.agreement)})` : ""}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ") || "Il commente cette draft sans dire quel côté il préfère.";
    margin = "—";
    marginLabel = "SON VERDICT";
    note = "Il ne tranche pas · le site non plus";
  } else {
    eyebrow = "DRAFT INÉDITE · KAZEWA NE L’A PAS JUGÉE";
    const nearLine = near
      ? `Sur la draft la plus proche qu’il a jugée (${near.sharedChampions} champions sur 10 en commun), il préférait ${sidePhrase(near.verdict.side, null, names)}.`
      : "";
    if (lean.basis === "both" || lean.basis === "arguments") {
      const r = lean.basis === "both" ? all?.both : all?.arguments;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "Tendance";
      title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
      description = [
        lean.basis === "both"
          ? `Ses arguments sur ces champions, donnés dans d’autres drafts (${saidCount}), et l’ordre des picks désignent le même côté.`
          : `D’après ses arguments sur ces champions, donnés dans d’autres drafts (${saidCount}).`,
        r
          ? lean.basis === "both"
            ? `Sur les ${r.n} drafts qu’il a jugées où ces deux lectures s’accordent, c’est son verdict ${formatPct(r.agreement)} du temps (${range(r)}).`
            : `Sur ${r.n} drafts qu’il a jugées, le côté désigné par ses arguments venus d’autres vidéos est son verdict ${formatPct(r.agreement)} du temps (${range(r)}).`
          : "",
        lean.basis === "arguments" && orderEditable && all?.both
          ? `Indique l’ordre des picks plus bas : quand il confirme ses arguments, la fiabilité mesurée passe à ${formatPct(all.both.agreement)}.`
          : "",
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      marginLabel = "FIABILITÉ MESURÉE";
      bar = side === "blue" ? (lean.basis === "both" ? 68 : 62) : lean.basis === "both" ? 32 : 38;
      note = "Estimation · sa prochaine vidéo peut dire l’inverse";
    } else if (lean.basis === "contested") {
      const r = all?.contested;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "Lecture contestée";
      title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
      description = [
        `Ses arguments sur ces champions penchent vers ${sidePhrase(said.side, null, names)} (${saidCount}), mais l’ordre des picks penche vers ${sidePhrase(order.side, null, names)}. Le site garde ses arguments.`,
        r
          ? `Dans cette situation, sur ${r.n} drafts qu’il a jugées, ils désignaient son verdict ${formatPct(r.agreement)} du temps : à peine mieux qu’une pièce lancée.`
          : "",
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      marginLabel = "FIABILITÉ MESURÉE";
      bar = side === "blue" ? 55 : 45;
      note = "Deux lectures opposées · verdict fragile";
    } else if (lean.basis === "order") {
      badge = reliability
        ? `Fiabilité mesurée : ${formatPct(reliability.agreement)}`
        : "Lecture de l’ordre des picks";
      title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
      description = [
        "Aucun argument précis de Kazewa ne s’applique à ces champions dans ces rôles. Lecture de l’ordre des picks : qui répond à qui dans chaque lane.",
        measured,
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      // Only the direction is measured. The size of the score says nothing.
      margin = reliability ? formatPct(reliability.agreement) : "—";
      marginLabel = "FIABILITÉ MESURÉE";
      bar = side === "blue" ? 60 : 40;
      note = "Estimation · sa prochaine vidéo peut dire l’inverse";
    } else if (lean.basis === "cards") {
      const r = all?.cards;
      const fromCards = judgement.cardReading;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après ses fiches champion";
      title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
      description = [
        `Aucun argument précis de Kazewa ne s’applique à ces champions dans ces rôles. Lecture d’après ses fiches champion, qui disent qui est bon avec qui et qui est puni par qui : ${fromCards.blue} élément${fromCards.blue > 1 ? "s" : ""} pour le bleu, ${fromCards.red} pour le rouge.`,
        r
          ? `Sur ${r.n} drafts tirées de vidéos que ses fiches n’ont jamais vues, cette lecture désigne son verdict ${formatPct(r.agreement)} du temps (${range(r)}) : un peu mieux qu’une pièce lancée.`
          : "",
        orderEditable ? "Indique l’ordre des picks plus bas pour une lecture mieux mesurée." : "",
        nearLine,
        "Ce n’est pas son avis sur cette draft.",
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      marginLabel = "FIABILITÉ MESURÉE";
      bar = side === "blue" ? 58 : 42;
      note = "Lecture d’après ses fiches · moins sûre que ses arguments";
    } else if (lean.basis === "principles") {
      const r = all?.principles;
      badge = r ? `Fiabilité mesurée : ${formatPct(r.agreement)}` : "D’après ses principes";
      title = `Verdict estimé : ${sidePhrase(side, null, names)}.`;
      description = [
        "Ni ses arguments ni ses fiches champion ne départagent ces deux compositions. Lecture de dernier recours d’après ses principes de composition (frontline, dégâts soutenus, catch, scaling, détaillés plus bas).",
        r
          ? `Sur ${r.n} drafts qu’il a jugées et que ce calculateur n’avait jamais vues, il désigne son verdict ${formatPct(r.agreement)} du temps : c’est une pièce lancée.`
          : "",
        orderEditable ? "Indique l’ordre des picks plus bas pour une lecture mieux mesurée." : "",
        nearLine,
      ]
        .filter(Boolean)
        .join(" ");
      margin = r ? formatPct(r.agreement) : "—";
      marginLabel = "FIABILITÉ MESURÉE";
      bar = side === "blue" ? 54 : 46;
      note = "Dernier recours · à prendre comme une description";
    } else {
      badge = "Équilibre";
      title = "Deux drafts à l’équilibre.";
      description = `Ni ses arguments, ni ses fiches champion, ni ses principes de composition ne départagent ces deux drafts. ${orderEditable ? "Indique l’ordre des picks plus bas : c’est ce qu’il regarde en premier." : ""} ${nearLine}`.trim();
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
  $("#verdict-description").textContent = description;
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
function renderOrderPanel(judgement, editable) {
  const node = $("#order-panel");
  if (!editable || judgement.source === "memory") {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  const champions = judgement.structure.teams;
  const filled = ROLES.filter((role) =>
    ["blue", "red"].includes(laterInput[role]),
  ).length;
  const known = Boolean(judgement.later) && !Object.keys(laterInput).length;
  node.hidden = false;
  node.innerHTML = `<div class="panel-heading"><h3>Qui a pick en dernier ?</h3><span class="mono">${known ? "ORDRE RÉEL CONNU" : `${filled} / 5 LANES`}</span></div><p class="fine-print">Dans chaque lane, clique le champion pick après son vis-à-vis. Répondre à un pick déjà posé est ce que Kazewa regarde en premier. La tendance apparaît quand les cinq lanes sont renseignées.</p><div class="order-rows">${ROLES.map((role) => {
    const current = laterInput[role] ?? (known ? judgement.later[role] : null);
    return `<div class="order-row"><span class="order-role">${ROLE_LABEL[role]}</span>${["blue", "red"].map((side) => `<button type="button" data-later-role="${role}" data-later-side="${side}" data-side="${side}" class="${current === side ? "is-active" : ""}" aria-pressed="${current === side}">${esc(champions[side].champions[role])}</button>`).join("")}</div>`;
  }).join("")}</div>`;
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
  node.innerHTML = `<div class="panel-heading"><h3>Ce que disent ses fiches champion</h3><span class="mono">${reading.blue} BLEU · ${reading.red} ROUGE</span></div><p class="fine-print">Chaque fiche résume ce qu’il dit d’un champion dans ses vidéos : avec qui il est bon, par qui il est puni. Le côté indiqué est celui que la remarque avantage ici.${reading.items.length > shown.length ? ` Les ${shown.length} premières sur ${reading.items.length}.` : ""}</p>${shown
    .map(
      (item, i) =>
        `<article class="signal" data-side="${esc(item.favours)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${item.kind === "synergy" ? `${esc(item.champion)} + ${esc(item.other)}` : `${esc(item.other)} contre ${esc(item.champion)}`}<span class="side-tag">${item.favours === "blue" ? "BLEU" : "ROUGE"}</span></h4><p>${item.kind === "synergy" ? `D’après ${esc(cardOf(item.champion))}, ${esc(item.other)} fait partie de ses bons partenaires.` : `D’après ${esc(cardOf(item.champion))}, ${esc(item.other)} fait partie de ce qui punit ce champion.`}</p></div></article>`,
    )
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
  { blocked = null, names = SIDE_LABEL, orderEditable = false } = {},
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
  renderVerdictCard(judgement, names, orderEditable);
  renderKazewaPanel(judgement, names);
  renderOrderPanel(judgement, orderEditable);
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
  resetOrder();
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
  resetOrder();
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
  const reliability = judgement.tendency?.reliability;
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
      both: ["ses arguments et l’ordre des picks", all.both],
      arguments: ["ses arguments sur ces champions", all.arguments],
      contested: ["ses arguments, contre l’ordre des picks", all.contested],
      order: ["l’ordre des picks", all.withOrder],
      cards: ["ses fiches champion", all.cards],
      principles: ["ses principes de composition", all.principles],
    }[lean.basis] ?? ["son corpus", null];
    sentence = `Draft inédite. Verdict estimé d’après ${source[0]} : ${sidePhrase(lean.side, null)}${source[1] ? ` (fiabilité mesurée ${formatPct(source[1].agreement)})` : ""}.`;
  }
  node.hidden = false;
  node.dataset.side = lean.side;
  node.textContent = sentence;
}
function analyzeManual() {
  const judgement = judge(draft, editedLater());
  lastJudgement = judgement;
  if (labMode === "quick") renderQuickReadout();
  else renderTeams();
  const note = $("#draft-origin");
  if (note) note.textContent = origin || "Choisis les dix champions par rôle.";
  renderQuickVerdict(judgement);
  renderResult(judgement, { orderEditable: true });
}
function resetOrder() {
  laterInput = {};
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
  const order = evaluation?.unseen?.pickOrder;
  const calc = evaluation?.unseen?.structuralCalculator;
  const said = evaluation?.unseen?.arguments;
  const every = evaluation?.unseen?.everyDraft;
  const sameSide = said?.withPickOrder?.sameSide;
  $("#validation-text").textContent = mem
    ? `${mem.decided} drafts jugées par Kazewa en mémoire : son verdict exact, ses raisons, sa vidéo. Toute autre draft reçoit un verdict estimé d’après ses arguments, ses fiches champion et ses principes : juste ${formatPct(every?.championsOnly?.all?.agreement)} du temps sur des vidéos tenues à l’écart, ${formatPct(sameSide?.agreement)} quand ses arguments et l’ordre des picks s’accordent.`
    : "Mémoire des verdicts indisponible.";
  const interval = (r) =>
    r?.n ? `${formatPct(r.low)} à ${formatPct(r.high)}` : "—";
  const row = (name, r, remark) =>
    `<tr><td>${esc(name)}</td><td>${r?.n ?? "—"}</td><td>${formatPct(r?.agreement)}</td><td>${esc(interval(r))}</td><td>${esc(remark)}</td></tr>`;
  $("#evaluation-details").innerHTML =
    `<span class="eyebrow">CE QUI EST MESURÉ</span><h3>Sa mémoire est exacte. Son avis estimé ne l’est pas toujours.</h3><p>Deux questions différentes, jamais mélangées. Une draft que Kazewa a commentée renvoie son verdict : c’est une restitution, juste par construction. Une draft qu’il n’a pas commentée est une estimation : elle est mesurée sur des séries et des vidéos qui n’ont pas servi à régler la lecture.</p><div class="eval-stats"><div class="eval-stat"><strong>${mem?.decided ?? "—"}</strong><span>DRAFTS AVEC SON VERDICT</span></div><div class="eval-stat"><strong>${mem?.videos ?? "—"}</strong><span>VIDÉOS SOURCES</span></div><div class="eval-stat"><strong>${formatPct(every?.championsOnly?.all?.agreement)}</strong><span>TOUTE DRAFT, CHAMPIONS SEULS</span></div><div class="eval-stat"><strong>${formatPct(sameSide?.agreement)}</strong><span>QUAND L’ORDRE DES PICKS CONFIRME</span></div></div><table><thead><tr><th>Situation</th><th>Drafts</th><th>Accord</th><th>Intervalle de confiance</th><th>Lecture</th></tr></thead><tbody>${row("Draft qu’il a jugée (mémoire)", mem?.selfRecall, "Restitution de son verdict, pas une prédiction")}${row("Toute draft, champions seuls · verdict estimé", every?.championsOnly?.all, "Toutes les lectures enchaînées, sur des vidéos tenues à l’écart")}${row("Toute draft, avec l’ordre des picks · verdict estimé", every?.withPickOrder?.all, "Mêmes vidéos, ordre des picks connu")}${row("Draft inédite · ses arguments venus d’autres vidéos", said, "Aucun réglage : on compte ses arguments par côté")}${row("Draft inédite · arguments et ordre des picks du même côté", sameSide, "Les deux lectures s’accordent")}${row("Draft inédite · arguments contre ordre des picks", every?.byReadingAllDrafts?.contested, "Le site garde ses arguments : verdict fragile")}${row("Draft inédite · ses fiches champion", evaluation?.unseen?.championCards?.heldOut, "Vidéos que les fiches n’ont jamais vues")}${row("Ses fiches champion · vidéos dont elles sont tirées", evaluation?.unseen?.championCards?.writtenFrom, "Ne prouve rien : elles résument ces vidéos")}${row("Draft inédite · ordre des picks seul", order, "Cinq poids, un par lane")}${order?.sideOnly ? row(`Draft inédite · répondre toujours « ${order.sideOnly.side === "blue" ? "côté bleu" : "côté rouge"} »`, order.sideOnly, "Règle sans modèle, sur les mêmes drafts") : ""}${row("Draft inédite · calculateur structurel", calc?.neverSeen, "Pile ou face : une description, pas un verdict")}${row("Calculateur · drafts qui ont servi à le régler", calc?.tunedOn, "Ne prouve rien : il a été réglé dessus")}</tbody></table><p>Le hasard se mesure en rejouant toute la procédure avec des verdicts tirés au sort : ${formatPct(order?.chance?.mean)} en moyenne, à plus ou moins ${order?.chance?.sd != null ? (order.chance.sd * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"} points. L’ordre des picks dépasse ce niveau, de peu : la mesure repose sur ${order?.n ?? "—"} drafts réparties en ${evaluation?.unseen?.groups ?? "—"} groupes.${order?.sideOnly ? ` Une partie de ce signal tient au côté de la carte : le côté qui pick en dernier est aussi celui qu’il préfère le plus souvent, et l’écart entre les deux lignes (${order.agree} contre ${order.sideOnly.agree} drafts sur ${order.n}) n’est pas établi statistiquement (p = ${order.overSideOnly?.p != null ? order.overSideOnly.p.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—"}).` : ""}</p><p>Ses arguments : pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos et qui s’appliquent encore (mêmes champions, même relation, mêmes rôles), et on compte de quel côté ils penchent. Rien n’est réglé sur ses verdicts. Cette lecture répond pour ${formatPct(said?.coverage)} des drafts jugées ; quand elle s’oppose à l’ordre des picks (${said?.withPickOrder?.oppositeSides?.n ?? "—"} drafts), elle a raison ${said?.withPickOrder?.oppositeSides?.argumentsRight ?? "—"} fois : le site la garde, en signalant que le verdict est fragile.</p><p>Toute draft reçoit un verdict. Quand aucun de ses arguments ne s’applique, le site passe à ses fiches champion (qui est bon avec qui, qui est puni par qui), puis à ses principes de composition. Ces deux lectures sont moins sûres, et chaque verdict dit laquelle a servi.</p><p>Ce que montre l’écart entre les deux lignes des fiches : quand Kazewa a déjà parlé d’une draft, ce qu’il en a dit permet de retrouver son verdict quatre fois sur cinq ; sur une draft dont il n’a jamais parlé, la même connaissance retombe près du hasard. Son avis tient à la draft elle-même, pas à des règles générales sur les champions.</p><p>Ce qui ne marche pas : les profils de champions, leur identité, les règles de composition du calculateur et les statistiques de 44 000 matchs pros ne suivent pas ses avis sur des drafts qui n’ont pas servi à les régler. Ses verdicts s’appuient aussi sur les bans, les joueurs et la méta du moment, que dix champions ne portent pas.</p>${evaluation?.reference?.realWinnerMatchesVerdict?.n ? `<p>Repère : dans ${formatPct(evaluation.reference.realWinnerMatchesVerdict.agreement)} des ${evaluation.reference.realWinnerMatchesVerdict.n} drafts jugées dont le résultat est connu, l’équipe qu’il préférait a gagné. Une partie de ses revues est enregistrée en connaissant le résultat.</p>` : ""}<p><a href="./data/evaluation.json" target="_blank" rel="noopener">Rapport de mesure ↗</a> · <a href="./data/memory-site.json" target="_blank" rel="noopener">Mémoire des verdicts ↗</a> · <a href="./data/model.json" target="_blank" rel="noopener">Poids de la tendance ↗</a></p>`;
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
  const judgement = judge({ blue: match.blue.picks, red: match.red.picks });
  if (judgement.status !== "complete")
    return judgement.warnings?.[0] || "Verdict indisponible.";
  if (judgement.lean.basis === "memory")
    return `Kazewa a jugé cette draft : ${match[judgement.winner]?.name || SIDE_LABEL[judgement.winner]}.`;
  if (judgement.lean.basis === "undecided")
    return "Kazewa a commenté cette draft sans trancher.";
  if (judgement.lean.side === "even") return "Draft inédite. Verdict estimé : équilibre.";
  const basis = judgement.lean.basis;
  const r = judgement.reliability?.[basis === "order" ? "withOrder" : basis];
  const from = {
    both: "ses arguments et l’ordre des picks",
    arguments: "ses arguments",
    contested: "ses arguments",
    order: "l’ordre des picks",
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
  node.innerHTML = `<h3>Games pros en direct</h3>${body}<p class="fine-print">Le flux public donne les champions par rôle quand la partie est lisible. Il ne donne pas les bans ni l’ordre des picks. Le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, un verdict estimé d’après ses arguments, ses fiches champion ou ses principes, avec sa fiabilité.</p>`;
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
function formatCoachScore(score) {
  if (!Number.isFinite(score) || Object.is(score, -0)) return "0";
  const rounded = Math.round(score * 100) / 100;
  const text = Object.is(rounded, -0) ? "0" : String(rounded);
  return rounded > 0 ? `+${text}` : text;
}
function renderCoachGrid(advice) {
  const taken = coachTaken();
  const previous = coachScores;
  const nextScores = new Map();
  const ranked = advice.pool || advice.options;
  const byName = new Map(ranked.map((option) => [option.champion, option]));
  const suggested = new Set(advice.options.map((option) => option.champion));
  const query = coachQuery
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const names = Object.keys(knowledge.champions)
    .filter((name) => {
      if (coachLane !== "all" && !(LANES[name] || []).includes(coachLane))
        return false;
      if (!query) return true;
      return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      const used = Number(taken.has(a)) - Number(taken.has(b));
      if (used) return used;
      const left = byName.get(a);
      const right = byName.get(b);
      const playable = Number(right?.playable !== false) - Number(left?.playable !== false);
      if (playable) return playable;
      const order = ranked.findIndex((row) => row.champion === a) - ranked.findIndex((row) => row.champion === b);
      if (order) return order;
      return a.localeCompare(b, "fr");
    });
  const picking = advice.step?.action === "pick";
  $("#coach-grid").innerHTML = names
    .map((name) => {
      const used = taken.has(name) || advice.done;
      const hint = byName.get(name);
      const unavailable = Boolean(hint && hint.playable === false);
      const numeric = Boolean(hint && Number.isFinite(hint.score));
      const title = hint?.reasons?.[0] ? ` title="${esc(hint.reasons[0])}"` : "";
      const score = numeric ? formatCoachScore(hint.score) : "";
      const tone = !numeric || hint.score === 0 ? "" : hint.score > 0 ? " is-up" : " is-down";
      const moved = numeric && previous.has(name) && previous.get(name) !== hint.score;
      if (numeric) nextScores.set(name, hint.score);
      const role =
        hint && picking && !unavailable ? (hint.flex ? "FLEX" : ROLE_LABEL[hint.role]) : "";
      const status = unavailable && picking ? "rôle pris" : "";
      const shown = score || (hint && !used ? "—" : "");
      const label = [name, shown, role || status].filter(Boolean).join(" ");
      const blocked = used || (picking && unavailable);
      return `<button type="button" class="champ-tile${suggested.has(name) ? " is-suggested" : ""}${taken.has(name) ? " is-taken" : ""}${unavailable ? " is-unavailable" : ""}" data-champion="${esc(name)}" data-score="${esc(shown)}" aria-label="${esc(label)}"${title}${blocked ? " disabled" : ""}><span class="champ-face">${championImage(name, 74)}${shown ? `<span class="champ-score${tone}${moved ? " is-moved" : ""}">${esc(shown)}</span>` : ""}</span>${role || status ? `<span class="champ-role">${esc(role || status)}</span>` : ""}<span class="champ-name">${esc(name)}</span></button>`;
    })
    .join("");
  coachScores = nextScores;
}
// The coach knows the real pick order of the draft it just played.
function coachLater() {
  const at = {};
  coach.log.forEach((entry, index) => {
    if (entry.action === "pick") at[`${entry.side}.${entry.role}`] = index;
  });
  const later = {};
  for (const role of ROLES) {
    const blue = at[`blue.${role}`];
    const red = at[`red.${role}`];
    if (blue == null || red == null) return null;
    later[role] = blue > red ? "blue" : "red";
  }
  return later;
}
function renderCoach() {
  if (view !== "coach" || !knowledge) return;
  const advice = advise(coach, knowledge, { limit: 8 });
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
        ? step.action === "ban"
          ? `À bannir : ${best.champion} ${formatCoachScore(best.score)}`
          : `À prendre : ${best.champion} ${best.flex ? "FLEX" : ROLE_LABEL[best.role]} ${formatCoachScore(best.score)}`
        : "Aucun champion n’a encore un rôle libre qui améliore le score.";
  }
  $("#coach-blue").innerHTML = renderDraftSide("blue", advice);
  $("#coach-red").innerHTML = renderDraftSide("red", advice);
  $("#coach-note").textContent = advice.done
    ? advice.note
    : `Le chiffre sur chaque portrait reste le score du calculateur. Il change dès qu’un champion est lock. Un ban retire le champion, il ne réécrit pas les autres chiffres. Le rôle proposé est la lane habituelle, sauf si un matchup de lane rend un autre rôle meilleur. L’ordre, lui, évite le blind. ${advice.note}`;
  renderCoachGrid(advice);
  renderCoachPro();
  if (coachFocus !== "self") {
    const match = snapshot?.matches?.find((item) => item.id === coachFocus);
    if (!match) {
      coachFocus = "self";
      renderResult(
        advice.done
          ? judge(coach.picks, coachLater())
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
    renderResult(judge({ blue: match.blue.picks, red: match.red.picks }), {
      blocked: readiness.ready ? null : readiness.reason,
      names: { blue: match.blue.name, red: match.red.name },
    });
    return;
  }
  if (advice.done) renderResult(judge(coach.picks, coachLater()));
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
    coach = applyAction(coach, name, role || null, knowledge);
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
    renderResult(judge(liveDraft), {
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
  resetOrder();
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
  resetOrder();
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
    const lane = event.target.closest("[data-later-role]");
    if (lane) {
      const role = lane.dataset.laterRole;
      const side = lane.dataset.laterSide;
      if (!Object.keys(laterInput).length && lastJudgement?.later)
        laterInput = { ...lastJudgement.later };
      // A second click on the same champion clears that lane.
      if (laterInput[role] === side) delete laterInput[role];
      else laterInput[role] = side;
      analyzeManual();
      document
        .querySelector(`[data-later-role="${role}"][data-later-side="${side}"]`)
        ?.focus();
      return;
    }
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
      coachScores = new Map();
      renderCoach();
    }
    const lane = event.target.closest("[data-lane]");
    if (lane) {
      coachLane = lane.dataset.lane;
      renderCoach();
    }
    const tile = event.target.closest("[data-champion]");
    if (tile && !tile.disabled) acceptCoachAction(tile.dataset.champion, null);
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
    renderCoachGrid(advise(coach, knowledge, { limit: 8 }));
  });
  $("#coach-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const tile = $("#coach-grid button:not(:disabled)");
    if (!tile) return;
    event.preventDefault();
    acceptCoachAction(tile.dataset.champion, null);
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
    // The pick order of a lane belongs to the champions that were in it.
    delete laterInput[select.dataset.role];
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
    laterInput = Object.fromEntries(
      Object.entries(laterInput).map(([role, side]) => [
        role,
        side === "blue" ? "red" : "blue",
      ]),
    );
    origin = "Équipes inversées · le verdict suit les compositions.";
    if (labMode === "quick") refreshQuickFields();
    analyzeManual();
  });
  $("#clear-button").addEventListener("click", () => {
    draft = emptyDraft();
    quickSwap = null;
    resetOrder();
    cardChampion = null;
    origin = "Choisis les dix champions par rôle.";
    if (labMode === "quick") refreshQuickFields();
    analyzeManual();
  });
  $("#share-button").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.hash = buildDraftHash(draft, typedLater());
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
      laterInput = laterFromHash(location.hash) ?? {};
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
    [knowledge, evaluation, memory, config, model, championAssets, cards] =
      await Promise.all([
        getJSON("./data/knowledge.json"),
        getJSON("./data/evaluation.json", true),
        getJSON("./data/memory-site.json", true),
        getJSON("./config.json", true),
        getJSON("./data/model.json", true),
        getJSON("./data/champion-assets.json", true),
        getJSON("./data/champion-cards.json", true),
      ]);
    memoryIndex = memory?.cases ? indexMemory(memory) : null;
    relations = cards ? cardRelations(cards) : null;
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
      laterInput = laterFromHash(location.hash) ?? {};
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
