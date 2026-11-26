/**
 * The pick rows of the coach, from the draft system (src/draft-system/chooser.mjs).
 *
 * The order is the system's. Each row carries one reason per term its pick
 * changes: a need of the knowledge base (worded with the rule's title), a duo, a
 * counter, a family, or the flexibility of its role. A negative reason is a
 * cost the pick adds. Every reason is tagged as the system, so that nobody reads
 * it as Kazewa's or Shanei's own words.
 */
import { LANES } from "../lanes.mjs";
import { bestPick } from "./chooser.mjs";
import { RULES } from "./rules.mjs";

export const SYSTEM_COACH = "systeme";

function sentence(reason, titles) {
  const good = reason.saved > 0;
  if (reason.rule === "combo")
    return good ? `Bon duo avec ${reason.with}.` : `Mauvais duo avec ${reason.with}.`;
  if (reason.rule === "counter")
    return good ? `Bon contre ${reason.with}, dans l'équipe adverse.` : `${reason.with} punit ce champion.`;
  if (reason.rule === "family")
    return good ? "Cohérence de famille : il rejoint la famille dominante." : "Mélange de familles : il sort de la famille dominante.";
  if (reason.rule === "blind")
    return "Blind pick : il peut rejoindre plusieurs familles et jouer plusieurs rôles, ce qui garde la draft ouverte.";
  if (reason.rule === "lock")
    return good ? `Reste dans la famille ${reason.with}.` : `Sort de la famille ${reason.with} : à ne prendre que pour répondre.`;
  if (reason.rule === "flex")
    return "Garde de la flexibilité : il peut encore jouer plusieurs rôles ouverts.";
  const title = titles.get(reason.rule) ?? RULES[reason.rule]?.title ?? reason.rule;
  return good ? `${title} : ce pick en comble une part.` : `${title} : ce pick l'aggrave.`;
}

/**
 * The pick rows for `side`, best first, in the shape the coach expects:
 * champion, role, roles, flex, playable, score, reasons.
 * `rules` is the rule list of the knowledge base (for the titles); `links` the index of links.
 */
export function systemPickRows(picks, side, { champions, bans = [], rules = [], links, flexRoles = {}, role = null }) {
  const titles = new Map(rules.map((rule) => [rule.id, rule.title]));
  const mine = picks?.[side] ?? {};
  const openRoles = ["top", "jng", "mid", "bot", "sup"].filter((role) => !mine[role]);
  return bestPick(picks, side, { champions, bans, links, flexRoles, limit: 1000, role }).map((option) => {
    const roles = (LANES[option.champion] ?? []).filter((role) => openRoles.includes(role));
    const reasons = option.reasons
      .filter((reason) => reason.saved !== 0)
      .map((reason) => ({
        kind: "system",
        coach: SYSTEM_COACH,
        points: reason.saved,
        text: sentence(reason, titles),
        rule: null,
        ruleId: reason.rule,
      }));
    return {
      champion: option.champion,
      role: option.role,
      roles,
      flex: roles.length > 1,
      playable: true,
      score: option.score,
      reasons,
    };
  });
}
