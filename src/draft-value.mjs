/**
 * The composition-only draft value of a champion in a role, from professional
 * drafts (data/draft-values.json, made by research/draftmodel/export_values.py).
 *
 * Only the ten champions and their roles enter the model. No team, no player,
 * no bans and no pick order: the file holds one number per champion and role.
 * It is a ridge logistic fitted on the games before 2026-11-22, with the setting
 * chosen on 2023-2024 only. Its measured gain on 2025-2026 is reported in the
 * file itself, and it is a small one.
 *
 * The coach reads it as one reason among others, labelled as professional and
 * weighted low: a champion that is worth more in a role for a side moves the
 * score of that pick by a few points, never more than the procedure of the two
 * coaches. Nothing else reads this file.
 */

// Points of score per percentage point of chance for the picking side. Set by
// hand, before any run on the coach; not fitted on any draft.
export const DRAFT_VALUE_WEIGHT = 0.2;

const ROLE_FR = { top: "top", jng: "jungle", mid: "mid", bot: "ADC", sup: "support" };

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const frac = (value, digits = 1) => Math.abs(value).toFixed(digits).replace(".", ",");

/**
 * How many percentage points of chance a pick in this role gives its side, on
 * the composition alone. Null when the champion has no value in that role.
 */
export function draftValueShift(values, { side, role, champion }) {
  const coef = values?.values?.[role]?.[champion];
  if (typeof coef !== "number") return null;
  const signed = side === "blue" ? coef : -coef;
  return (sigmoid(signed) - 0.5) * 100;
}

/** The reason line of a candidate pick, or null when the model has nothing for it. */
export function draftValueReason(values, { side, role, champion, weight = DRAFT_VALUE_WEIGHT }) {
  const shift = draftValueShift(values, { side, role, champion });
  if (shift === null || !Number.isFinite(shift) || Math.abs(shift) < 0.05) return null;
  const sideWord = side === "blue" ? "le bleu" : "le rouge";
  const accuracy = values?.heldOut?.accuracy;
  const measured = Number.isFinite(accuracy)
    ? `${(accuracy * 100).toFixed(1).replace(".", ",")} % d’accord hors échantillon : un signal faible`
    : "un signal faible";
  const text = `Dans les parties pro, ${champion} en ${ROLE_FR[role] ?? role} ${shift >= 0 ? "avantage" : "désavantage"} ${sideWord} de ${frac(shift)} point${Math.abs(shift) >= 1.05 ? "s" : ""} de pourcentage de chances, toutes choses égales : composition seule, ${measured}.`;
  return {
    points: Math.round(shift * weight * 100) / 100,
    kind: "draftvalue",
    coach: "pro",
    text,
    rule: null,
  };
}
