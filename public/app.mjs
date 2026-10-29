import { analyzeDraft, normalizeChampion, ROLES } from "./src/engine.mjs";
import {
  emptyDraft,
  validateEndpoint,
  draftFromHash,
  buildDraftHash,
  validateClientSnapshot,
  getLiveReadiness,
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
  benchmark,
  distillation,
  championAssets,
  config = fallbackConfig;
let view = "lab",
  draft = emptyDraft(),
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
  const labels = [];
  if (p.frontline === 2) labels.push("Vrai tank");
  if (p.catch === 2) labels.push("Catch");
  if (p.dps === 2) labels.push("DPS");
  if (p.scaling === 2) labels.push("Scaling");
  if (p.peel === 2) labels.push("Peel");
  if (p.engage === 2) labels.push("Engage");
  if (p.poke === 2) labels.push("Poke");
  return labels.slice(0, 3).join(" · ") || "Profil du corpus";
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
      return `<div class="champion-row"><span class="role-name">${ROLE_LABEL[role]}</span>${portrait(canonical || champion)}<div class="champion-field">${select}<div class="champion-subtitle">${esc(champion ? (canonical ? profileLine(canonical) : "Profil absent du corpus") : "En attente du pick")}</div></div></div>`;
    },
  ).join("")}`;
}
function renderTeams() {
  for (const side of ["blue", "red"])
    $(`#${side}-team`).innerHTML = teamHTML(side, draft[side]);
  handleImageErrors();
  $("#draft-origin").textContent =
    origin || "Analyse fondée uniquement sur les dix champions et leurs rôles.";
}
function renderResult(result, { blocked = null, names = SIDE_LABEL } = {}) {
  if (blocked || result.status !== "complete") {
    $("#result-section").hidden = true;
    $("#empty-result").hidden = false;
    $("#empty-result h3").textContent = blocked
      ? "Le verdict attend des données fiables."
      : result.status === "incomplete"
        ? "Les dix picks racontent une histoire."
        : "Cette draft demande une vérification.";
    $("#empty-result p").textContent =
      blocked ||
      result.warnings?.[0] ||
      "Complétez les deux compositions pour révéler leur plan, leurs failles et le verdict.";
    const count = ["blue", "red"]
      .flatMap((s) => Object.values(draft[s]))
      .filter(Boolean).length;
    $("#picks-progress").textContent =
      view === "live" ? "VERDICT SUSPENDU" : `${count} / 10 PICKS`;
    return;
  }
  $("#result-section").hidden = false;
  $("#empty-result").hidden = true;
  const even = result.winner === "even",
    winner = result.winner;
  $("#verdict-card").dataset.side = winner;
  $("#verdict-title").textContent = even
    ? "Deux drafts, un équilibre."
    : `${names[winner] || SIDE_LABEL[winner]} prend l’avantage.`;
  $("#confidence-badge").textContent = even
    ? "Pas de préférence nette"
    : `Intensité du signal : ${result.confidence}`;
  $("#verdict-description").textContent = even
    ? "Aucun avantage structurel assez net pour départager ces compositions."
    : `Le moteur préfère cette composition sur le papier. ${result.teams[winner]?.identity || ""}${result.teams[winner]?.timing ? ` · ${result.teams[winner].timing}.` : ""}`;
  $("#verdict-margin").textContent =
    `${result.margin.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} pts`;
  // Bounded visual of a signed heuristic score, deliberately never labeled a probability.
  $("#advantage-bar").style.width =
    `${Math.max(8, Math.min(92, 50 + result.score * 2))}%`;
  $("#signal-count").textContent = `${result.signals.length} SIGNAUX`;
  const signals = result.signals.slice(0, 6);
  $("#reasons").innerHTML = signals.length
    ? signals
        .map(
          (signal, i) =>
            `<article class="signal" data-side="${esc(signal.side)}"><span class="signal-number">${String(i + 1).padStart(2, "0")}</span><div><h4 class="signal-title">${esc(signal.title)}<span class="side-tag">${signal.side === "blue" ? "BLEU" : "ROUGE"} +${esc(signal.weight)}</span></h4><p>${esc(signal.evidence)}</p><div class="source-links">${videoLinks(signal.sources, 2)}</div></div></article>`,
        )
        .join("")
    : '<p class="fine-print">Aucun signal décisif détecté par les règles actuelles.</p>';
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
function analyzeManual() {
  renderTeams();
  renderResult(analyzeDraft(draft, knowledge));
}
function setView(next, { scroll = false } = {}) {
  view = next;
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === next;
    button.classList.toggle("is-active", active);
    if (button.hasAttribute("aria-pressed"))
      button.setAttribute("aria-pressed", String(active));
  }
  $("#lab-view").hidden = next !== "lab";
  $("#live-view").hidden = next !== "live";
  $("#method-view").hidden = next !== "method";
  $("#workspace-title").textContent =
    next === "live"
      ? "La scène pro, sous la loupe."
      : next === "method"
        ? "De l’intuition aux règles."
        : "Au cœur de la draft.";
  $("#workspace-eyebrow").textContent =
    next === "live"
      ? "02 / LE DIRECT"
      : next === "method"
        ? "03 / LA MÉTHODE"
        : "01 / L’ATELIER";
  if (next === "lab") analyzeManual();
  else if (next === "live") {
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
  $("#rule-count").textContent = knowledge.rules.length;
  const stats = evaluation?.broader,
    primary = evaluation?.primary,
    exploratory = evaluation?.exploratoryRaw?.summary;
  const valid = evaluation?.gate?.passed === true;
  $("#validation-text").textContent = stats
    ? `Moteur expérimental · ${formatPct(stats.agreement)} d’accord avec Kazewa sur ${stats.decided} avis tranchés (${stats.eligible} drafts évaluées). ${valid ? "Seuil déclaré atteint." : "Fidélité encore insuffisante."}`
    : "Moteur expérimental · mesure de fidélité indisponible. Aucune validation revendiquée.";
  $("#evaluation-details").innerHTML =
    `<span class="eyebrow">LE TEST DE FIDÉLITÉ</span><h3>${valid ? "Seuil déclaré atteint." : "La transparence avant la certitude."}</h3><p>${valid ? "Les critères de validation déclarés sont atteints sur le benchmark rétrospectif." : "Le seuil de fidélité déclaré n’est pas atteint. Le site reste un laboratoire expérimental : ses verdicts ne sont pas une reproduction validée des jugements de Kazewa."}</p><div class="eval-stats"><div class="eval-stat"><strong>${formatPct(stats?.agreement)}</strong><span>ACCORD SUR LES AVIS TRANCHÉS</span></div><div class="eval-stat"><strong>${formatPct(stats?.coverage)}</strong><span>DRAFTS AVEC UN AVIS TRANCHÉ</span></div><div class="eval-stat"><strong>${stats?.eligible ?? "—"}</strong><span>DRAFTS DÉDUPLIQUÉES</span></div><div class="eval-stat"><strong>${stats?.videos ?? "—"}</strong><span>VIDÉOS SOURCES</span></div></div><table><thead><tr><th>Périmètre</th><th>Drafts</th><th>Avis tranchés</th><th>Accord</th><th>Couverture</th></tr></thead><tbody>${[["Sans influence contextuelle détectée", primary], ["Corpus nettoyé plus large", stats], ...(exploratory ? [["Corpus exploratoire distinct", exploratory]] : [])].map(([name, s]) => `<tr><td>${esc(name)}</td><td>${s?.eligible ?? "—"}</td><td>${s?.decided ?? "—"}</td><td>${formatPct(s?.agreement)}</td><td>${formatPct(s?.coverage)}</td></tr>`).join("")}</tbody></table><p>Critères de sortie déclarés pour le sous-ensemble strict : accord ≥ 85 %, couverture ≥ 80 %, au moins 50 drafts et 10 vidéos. Ce sont des choix de validation du projet, pas des seuils exprimés par Kazewa.</p><p>Évaluation rétrospective, sans apprentissage des pondérations sur ces résultats. Les règles et les labels proviennent d’un corpus qui se recoupe : ce benchmark ne remplace pas un test prospectif indépendant. Les exclusions contextuelles utilisent un filtrage textuel imparfait.</p>${stats?.agreementInterval95 ? `<p>Incertitude à 95 % sur l’accord mesuré : ${formatPct(stats.agreementInterval95.low ?? stats.agreementInterval95[0])} à ${formatPct(stats.agreementInterval95.high ?? stats.agreementInterval95[1])}. Les cas issus d’une même vidéo ne sont pas tous indépendants.</p>` : ""}<p><a href="./data/evaluation.json" target="_blank" rel="noopener">Rapport JSON détaillé ↗</a> · <a href="./data/benchmark.json" target="_blank" rel="noopener">Cas et exclusions ↗</a></p>`;
  $("#rule-catalog").innerHTML = knowledge.rules
    .map(
      (r) =>
        `<article class="rule-item"><h4>${esc(r.title)}</h4><p>${esc(r.description || r.provenance?.interpretation || r.family || "")} · poids ${esc(r.weight)}</p><div class="source-links">${videoLinks(r.sources, 4)}</div></article>`,
    )
    .join("");
  if (distillation?.outOfFold) {
    const details = document.createElement("details");
    details.className = "rule-catalog";
    details.id = "distillation-details";
    details.innerHTML = `<summary>Expérience d’apprentissage : pourquoi elle reste séparée</summary><div class="method-limit"><p>Le modèle appris atteint ${formatPct(distillation.fittedTraining?.agreement)} sur ses propres données d’entraînement, mais ${formatPct(distillation.outOfFold.agreement)} sur ${esc(distillation.outOfFold.eligible)} drafts dont les vidéos et les compositions exactes sont tenues hors de l’entraînement. Ce recul indique un surapprentissage.</p><p>Ce modèle utilise uniquement des variables structurelles. Ses résultats ne justifient pas le remplacement du moteur principal ni une validation de fidélité.</p><p><a href="./data/distillation.json" target="_blank" rel="noopener">Consulter l’expérience et les coefficients ↗</a></p></div>`;
    $("#method-view").append(details);
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
            `<button class="match-card${m.id === selectedMatchId ? " is-selected" : ""}" data-match="${esc(m.id)}" aria-pressed="${m.id === selectedMatchId}"><span class="match-league">${esc(m.league || "PRO")}${m.gameNumber ? ` · G${esc(m.gameNumber)}` : ""}</span><span class="match-teams">${esc(m.blue.name)} <span>VS</span> ${esc(m.red.name)}</span><span class="match-state">${esc(STATUS_LABEL[m.status])}${m.stale ? " · DIFFÉRÉ" : ""}</span><span class="match-chevron" aria-hidden="true">↗</span></button>`,
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
    renderResult(analyzeDraft(liveDraft, knowledge), {
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

function loadExample() {
  const cases = (benchmark?.cases || []).filter((c) => c.blue && c.red);
  if (cases.length) {
    exampleIndex = (exampleIndex + 1) % cases.length;
    const c = cases[exampleIndex];
    draft = { blue: { ...c.blue }, red: { ...c.red } };
    origin = `Cas du corpus ${c.id} · source ${c.video} · affichage anonymisé des deux équipes.`;
  } else {
    draft = {
      blue: {
        top: "Sion",
        jng: "Maokai",
        mid: "Azir",
        bot: "Jinx",
        sup: "Lulu",
      },
      red: {
        top: "Jayce",
        jng: "Nidalee",
        mid: "LeBlanc",
        bot: "Jhin",
        sup: "Pyke",
      },
    };
    origin =
      "Exemple pédagogique : ces compositions ne représentent pas un match en direct.";
  }
  setView("lab");
}
function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
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
  $("#lab-view").addEventListener("change", (event) => {
    const select = event.target.closest("[data-role]");
    if (!select) return;
    draft[select.dataset.side][select.dataset.role] = select.value;
    origin =
      "Composition manuelle · seuls les champions et les rôles entrent dans le calcul.";
    analyzeManual();
    $(
      `select[data-side="${select.dataset.side}"][data-role="${select.dataset.role}"]`,
    )?.focus();
  });
  $("#example-button").addEventListener("click", loadExample);
  $("#swap-button").addEventListener("click", () => {
    draft = { blue: { ...draft.red }, red: { ...draft.blue } };
    origin = "Équipes inversées · le raisonnement suit les compositions.";
    analyzeManual();
  });
  $("#clear-button").addEventListener("click", () => {
    draft = emptyDraft();
    origin = "Sélectionnez les champions par rôle pour lancer l’analyse.";
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
    [knowledge, evaluation, benchmark, config, distillation, championAssets] =
      await Promise.all([
        getJSON("./data/knowledge.json"),
        getJSON("./data/evaluation.json", true),
        getJSON("./data/benchmark.json", true),
        getJSON("./config.json", true),
        getJSON("./data/distillation.json", true),
        getJSON("./data/champion-assets.json", true),
      ]);
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
      if (view === "live" && !document.hidden) renderLive();
    }, 10000);
  } catch (error) {
    $("#validation-text").textContent = "Le moteur n’a pas pu démarrer.";
    $("#workspace").innerHTML =
      `<p class="fatal-error">${esc(error.message)} Vérifiez que les fichiers du site sont servis par HTTP.</p>`;
  }
}
init();
