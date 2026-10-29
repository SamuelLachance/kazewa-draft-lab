import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeDraft, normalizeChampion, ROLES } from "../src/engine.mjs";
const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);
const draft = {
  blue: { top: "Sion", jng: "Maokai", mid: "Azir", bot: "Jinx", sup: "Lulu" },
  red: {
    top: "Jayce",
    jng: "Nidalee",
    mid: "LeBlanc",
    bot: "Jhin",
    sup: "Pyke",
  },
};
test("the knowledge build preserves the complete source taxonomy and source distinction", () => {
  assert.equal(Object.keys(knowledge.champions).length, 172);
  assert.equal(knowledge.champions.Gangplank.dashs, 1);
  assert.ok(knowledge.champions.Gangplank._provenance.warnings.length);
  assert.ok(knowledge.rules.every((r) => r.sources.length && r.weight > 0));
});
test("a structural tank-DPS-protection block beats the low-DPS fragile example", () => {
  const r = analyzeDraft(draft, knowledge);
  assert.equal(r.status, "complete");
  assert.equal(r.winner, "blue");
  assert.ok(r.signals.some((s) => s.id === "dps_missing" && s.side === "blue"));
  assert.ok(
    r.signals.some((s) => s.id === "named_synergy" && s.side === "blue"),
  );
  assert.ok(r.signals.every((s) => s.sources.length));
});
test("mirroring the sides reverses the score exactly", () => {
  const a = analyzeDraft(draft, knowledge),
    b = analyzeDraft({ blue: draft.red, red: draft.blue }, knowledge);
  assert.equal(a.score, -b.score);
  assert.equal(a.margin, b.margin);
  assert.equal(b.winner, "red");
});
test("team identity, rank, gold, patch and game outcome never enter a judgement", () => {
  const a = analyzeDraft(draft, knowledge);
  const b = analyzeDraft(
    {
      ...draft,
      teams: { blue: "T1", red: "GEN" },
      winner: "red",
      gold: { blue: 90000, red: 2 },
      patch: "999",
      rank: 1,
    },
    knowledge,
  );
  assert.deepEqual(a, b);
});
test("partial drafts abstain even when one side has a complete stronger-looking composition", () => {
  const red = { ...draft.red };
  delete red.bot;
  const r = analyzeDraft({ blue: draft.blue, red }, knowledge);
  assert.equal(r.status, "incomplete");
  assert.equal(r.winner, null);
  assert.equal(r.score, 0);
  assert.deepEqual(r.missing, ["red.bot"]);
});
test("unknown champions abstain and do not inherit a made-up neutral profile", () => {
  const r = analyzeDraft(
    { ...draft, red: { ...draft.red, mid: "Unknown champion" } },
    knowledge,
  );
  assert.equal(r.status, "unsupported");
  assert.equal(r.winner, null);
  assert.equal(r.signals.length, 0);
});
test("uncertain champion names abstain before provider alias normalization", () => {
  const r = analyzeDraft(
    { ...draft, red: { ...draft.red, mid: "Galio?" } },
    knowledge,
  );
  assert.equal(normalizeChampion("Galio?", knowledge), null);
  assert.equal(r.status, "unsupported");
  assert.equal(r.winner, null);
  assert.equal(r.signals.length, 0);
  assert.equal(normalizeChampion("Kai'Sa", knowledge), "Kai'Sa");
  assert.equal(normalizeChampion("MonkeyKing", knowledge), "Wukong");
});
test("duplicate champions across or within sides are rejected after name normalization", () => {
  const r = analyzeDraft(
    { ...draft, red: { ...draft.red, mid: "AZIR" } },
    knowledge,
  );
  assert.equal(r.status, "invalid");
  assert.equal(r.winner, null);
});
test("malformed side and champion types are invalid", () => {
  assert.equal(
    analyzeDraft({ blue: [], red: {} }, knowledge).status,
    "invalid",
  );
  assert.equal(
    analyzeDraft(
      { ...draft, red: { ...draft.red, mid: { champion: "Ahri" } } },
      knowledge,
    ).status,
    "invalid",
  );
});
test("provider identifiers and typography map to canonical names", () => {
  assert.equal(normalizeChampion("MonkeyKing", knowledge), "Wukong");
  assert.equal(normalizeChampion("KSanté", knowledge), "K'Sante");
  assert.equal(normalizeChampion("KaiSa", knowledge), "Kai'Sa");
  assert.equal(normalizeChampion("JarvanIV", knowledge), "Jarvan IV");
  assert.equal(normalizeChampion(null, knowledge), null);
});
test("the confidence is qualitative and exposes no uncalibrated win probability", () => {
  const r = analyzeDraft(draft, knowledge);
  assert.equal("probability" in r, false);
  assert.equal("winProbability" in r, false);
  assert.ok(r.warnings.some((s) => s.includes("pas une probabilité")));
});
test("family saturation bounds duplicate damage evidence", () => {
  const r = analyzeDraft(draft, knowledge);
  const damage = r.signals
    .filter((s) => s.family === "damage")
    .reduce((n, s) => n + (s.side === "blue" ? 1 : -1) * s.weight, 0);
  assert.ok(damage >= 3);
  assert.ok(
    r.score <
      r.signals.reduce(
        (n, s) => n + (s.side === "blue" ? 1 : -1) * s.weight,
        0,
      ),
  );
});
test("frozen deterministic evaluation does not mutate caller data", () => {
  const frozen = structuredClone(draft);
  for (const side of ["blue", "red"]) Object.freeze(frozen[side]);
  Object.freeze(frozen);
  assert.deepEqual(
    analyzeDraft(frozen, knowledge),
    analyzeDraft(draft, knowledge),
  );
  assert.deepEqual(ROLES, ["top", "jng", "mid", "bot", "sup"]);
});
test("Orianna delivery combos count as follow-up and retain exact supporting sources", () => {
  const r = analyzeDraft(
    {
      blue: {
        top: "Ornn",
        jng: "Vi",
        mid: "Orianna",
        bot: "Xayah",
        sup: "Rakan",
      },
      red: draft.red,
    },
    knowledge,
  );
  const combo = r.signals.find(
    (s) => s.id === "named_synergy" && s.subject === "blue",
  );
  assert.ok(combo.evidence.includes("Orianna + Vi"));
  assert.ok(combo.sources.includes("lPIM3We7vE0"));
  assert.equal(
    r.signals.some((s) => s.id === "followup_missing" && s.subject === "blue"),
    false,
  );
});
test("multiple DPS-1 profiles are not treated as a composition without sustained damage", () => {
  const r = analyzeDraft(
    {
      blue: {
        top: "Gnar",
        jng: "Poppy",
        mid: "Viktor",
        bot: "Varus",
        sup: "Braum",
      },
      red: {
        top: "Sion",
        jng: "Sejuani",
        mid: "Orianna",
        bot: "Jhin",
        sup: "Leona",
      },
    },
    knowledge,
  );
  assert.equal(r.status, "complete");
  assert.equal(
    r.signals.some((s) => s.id === "dps_missing" && s.subject === "blue"),
    false,
  );
  assert.ok(r.teams.blue.dps >= 2);
});
test("the five-role immobility count includes supports and frontliners", () => {
  const r = analyzeDraft(
    {
      blue: {
        top: "Sion",
        jng: "Udyr",
        mid: "Orianna",
        bot: "Varus",
        sup: "Nami",
      },
      red: {
        top: "Aatrox",
        jng: "Jarvan IV",
        mid: "Ahri",
        bot: "Ezreal",
        sup: "Pyke",
      },
    },
    knowledge,
  );
  assert.equal(r.teams.blue.immobileCount, 5);
  assert.ok(
    r.signals.some(
      (s) => s.id === "immobile_into_catch" && s.subject === "blue",
    ),
  );
});
test("collective protection reduces rather than ignores catch exposure", () => {
  const blue = {
    top: "Sion",
    jng: "Udyr",
    mid: "Orianna",
    bot: "Varus",
    sup: "Nami",
  };
  const red = {
    top: "Aatrox",
    jng: "Jarvan IV",
    mid: "Ahri",
    bot: "Ezreal",
    sup: "Bard",
  };
  const protectedDraft = analyzeDraft({ blue, red }, knowledge);
  const uncovered = analyzeDraft(
    { blue: { ...blue, sup: "Blitzcrank" }, red },
    knowledge,
  );
  const risk = (r) =>
    r.signals.find(
      (s) => s.id === "immobile_into_catch" && s.subject === "blue",
    ).weight;
  assert.ok(risk(protectedDraft) < risk(uncovered));
});
test("a support tank budget is contextual and Alistar preserves the explicit exception", () => {
  const blue = {
    top: "Fiora",
    jng: "Lee Sin",
    mid: "Orianna",
    bot: "Aphelios",
    sup: "Maokai",
  };
  const a = analyzeDraft({ blue, red: draft.red }, knowledge);
  const b = analyzeDraft(
    { blue: { ...blue, sup: "Alistar" }, red: draft.red },
    knowledge,
  );
  assert.equal(a.teams.blue.effectiveFrontline, false);
  assert.equal(b.teams.blue.effectiveFrontline, true);
});
test("lane counters apply only in the documented role", () => {
  const r = analyzeDraft(
    {
      blue: {
        top: "Jax",
        jng: "Maokai",
        mid: "Orianna",
        bot: "Varus",
        sup: "Lulu",
      },
      red: { top: "Gnar", jng: "Vi", mid: "Ahri", bot: "Ezreal", sup: "Rakan" },
    },
    knowledge,
  );
  assert.ok(
    r.signals.some(
      (s) =>
        s.id === "named_lane_counter" &&
        s.subject === "blue" &&
        s.evidence.includes("Jax contre Gnar"),
    ),
  );
});
test("a bot-pair bonus requires the two champions in bot and support roles", () => {
  const r = analyzeDraft(
    {
      blue: {
        top: "Ornn",
        jng: "Jarvan IV",
        mid: "Lucian",
        bot: "Xayah",
        sup: "Nami",
      },
      red: draft.red,
    },
    knowledge,
  );
  assert.equal(
    r.signals.some(
      (s) => s.id === "named_synergy" && s.evidence.includes("Lucian + Nami"),
    ),
    false,
  );
});
