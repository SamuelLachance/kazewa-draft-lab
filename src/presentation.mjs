import { ROLES } from "./engine.mjs";

export const emptyDraft = () => ({
  blue: Object.fromEntries(ROLES.map((r) => [r, ""])),
  red: Object.fromEntries(ROLES.map((r) => [r, ""])),
});

export function validateEndpoint(value, base = "http://localhost:4173/") {
  if (!value) return "";
  if (typeof value !== "string")
    throw new Error("L’adresse du flux doit être du texte.");
  const url = new URL(value, base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error(
      "Utilisez une URL HTTPS sans identifiant, paramètre ni fragment.",
    );
  }
  return url.href;
}

export function draftFromHash(hash) {
  try {
    const params = new URLSearchParams(String(hash).replace(/^#/, ""));
    if (!params.has("draft")) return null;
    const parsed = JSON.parse(params.get("draft"));
    if (!parsed || typeof parsed !== "object") return null;
    const result = emptyDraft();
    for (const side of ["blue", "red"])
      for (const role of ROLES) {
        const value = parsed[side]?.[role];
        if (typeof value !== "string" || value.length > 60) return null;
        result[side][role] = value;
      }
    return result;
  } catch {
    return null;
  }
}

export function buildDraftHash(draft) {
  const copy = emptyDraft();
  for (const side of ["blue", "red"])
    for (const role of ROLES)
      copy[side][role] = String(draft[side]?.[role] || "").slice(0, 60);
  return "#" + new URLSearchParams({ draft: JSON.stringify(copy) }).toString();
}

export function validateClientSnapshot(value) {
  if (
    !value ||
    value.version !== 1 ||
    !["ok", "not_configured", "unavailable"].includes(value.status) ||
    !Array.isArray(value.matches) ||
    value.matches.length > 100
  )
    throw new Error("Le flux ne respecte pas le format attendu.");
  const ids = new Set();
  for (const match of value.matches) {
    if (
      !match ||
      typeof match.id !== "string" ||
      !match.id ||
      ids.has(match.id) ||
      !["draft", "in_game", "finished"].includes(match.status)
    )
      throw new Error("Match live invalide.");
    ids.add(match.id);
    for (const side of ["blue", "red"]) {
      if (
        !match[side] ||
        typeof match[side].name !== "string" ||
        !match[side].picks ||
        typeof match[side].picks !== "object"
      )
        throw new Error("Composition live invalide.");
      for (const role of ROLES) {
        const name = match[side].picks[role];
        if (name != null && (typeof name !== "string" || name.length > 60))
          throw new Error("Pick live invalide.");
      }
    }
  }
  return value;
}

/** Re-evaluated against observation time, never fetch time, even after a tab stays open. */
export function getLiveReadiness(
  snapshot,
  match,
  { now = Date.now(), staleAfterMs = 90_000 } = {},
) {
  if (!snapshot || snapshot.status !== "ok")
    return {
      ready: false,
      reason: "Flux indisponible. Le verdict live est suspendu.",
    };
  if (!match) return { ready: false, reason: "Sélectionnez un match du flux." };
  const snapshotTime =
    snapshot.observedAt == null ? null : Date.parse(snapshot.observedAt);
  if (
    snapshot.stale === true ||
    (snapshotTime !== null &&
      (!Number.isFinite(snapshotTime) ||
        snapshotTime > now + 60_000 ||
        now - snapshotTime > staleAfterMs))
  )
    return {
      ready: false,
      reason:
        "Le flux signale des données périmées ou un horodatage invalide. Le verdict live est suspendu.",
    };
  const observed = Date.parse(match.observedAt || "");
  if (
    !Number.isFinite(observed) ||
    observed > now + 60_000 ||
    now - observed > staleAfterMs ||
    match.stale === true
  )
    return {
      ready: false,
      reason:
        "Observation trop ancienne ou non horodatée. Le verdict live est suspendu.",
    };
  if (match.status === "finished")
    return {
      ready: false,
      reason:
        "Partie terminée. Cette composition n’est plus présentée comme un verdict live.",
    };
  if (match.status === "draft" && snapshot.capabilities?.draftPhase !== true)
    return {
      ready: false,
      reason: "Ce fournisseur ne garantit pas les picks pendant la draft.",
    };
  if (match.rolesConfirmed !== true)
    return {
      ready: false,
      reason:
        "Les rôles ne sont pas confirmés. Le moteur attend la résolution des flex picks.",
    };
  const picks = ["blue", "red"].flatMap((side) =>
    ROLES.map((role) => match[side]?.picks?.[role]),
  );
  if (picks.some((p) => typeof p !== "string" || !p.trim() || p === "?"))
    return {
      ready: false,
      reason: `Draft en cours : ${picks.filter((p) => typeof p === "string" && p.trim() && p !== "?").length}/10 picks confirmés. Verdict suspendu.`,
    };
  return { ready: true, reason: null };
}
