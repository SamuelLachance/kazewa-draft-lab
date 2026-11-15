import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fingerprint, indexMemory } from "../src/memory.mjs";
import { judgeDraft, normalizeLater, swapLater, tendency } from "../src/verdict.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const judged = {
  id: "case_a",
  blue: team("Jax", "Nocturne", "Orianna", "Draven", "Nautilus"),
  red: team("Gragas", "Skarner", "Ahri", "Jhin", "Leona"),
  sides: "map",
  rosterVerified: true,
  later: { top: "red", jng: "red", mid: "blue", bot: "blue", sup: "red" },
  verdict: { side: "red", confidence: 2, timing: "draft", label: "Rouge devant" },
  reasons: ["Raison"],
  reads: [],
  claims: [],
  disagreements: [],
  winner: "red",
  match: { teams: { blue: "G2", red: "T1" } },
  sources: [{ video: "-0iJco4hUdk", ts: 314 }],
};
judged.fingerprint = fingerprint(judged);
const undecided = {
  ...judged,
  id: "case_b",
  blue: team("Ornn", "Vi", "Azir", "Jinx", "Lulu"),
  red: team("Renekton", "Lee Sin", "Ahri", "Kai'Sa", "Rell"),
  later: null,
  verdict: { side: "even", confidence: 0, timing: null, label: "" },
};
undecided.fingerprint = fingerprint(undecided);
const memory = indexMemory({ cases: [judged, undecided] });
const model = {
  process: { weights: { top: 0.46, jng: 0.25, mid: 0.37, bot: -0.06, sup: 0.15 } },
  reliability: {
    withOrder: { agreement: 0.6, n: 194, low: 0.53, high: 0.66 },
    withoutOrder: { agreement: 0.5, n: 249 },
  },
};
const unseen = {
  blue: team("Sion", "Maokai", "Azir", "Jinx", "Lulu"),
  red: team("Jayce", "Nidalee", "LeBlanc", "Jhin", "Pyke"),
};

test("a draft he judged is answered with his verdict, never with the model", () => {
  const result = judgeDraft({ blue: judged.blue, red: judged.red }, { knowledge, memory, model });
  assert.equal(result.status, "complete");
  assert.equal(result.source, "memory");
  assert.equal(result.winner, "red");
  assert.equal(result.kazewa.verdict.confidence, 2);
  const mirrored = judgeDraft({ blue: judged.red, red: judged.blue }, { knowledge, memory, model });
  assert.equal(mirrored.source, "memory");
  assert.equal(mirrored.winner, "blue");
  // The structural calculator may say anything: it does not override him.
  assert.ok(["blue", "red", "even"].includes(result.structure.winner));
});

test("provider spellings still find the judged draft", () => {
  const spelled = {
    blue: team("jax", "NOCTURNE", "orianna", "Draven", "nautilus"),
    red: team("Gragas", "Skarner", "Ahri", "Jhin", "Leona"),
  };
  assert.equal(judgeDraft(spelled, { knowledge, memory, model }).source, "memory");
});

test("an unseen draft gets no tendency from the ten champions alone", () => {
  const result = judgeDraft(unseen, { knowledge, memory, model });
  assert.equal(result.source, "unseen");
  assert.equal(result.winner, null);
  assert.equal(result.kazewa, null);
  assert.equal(result.tendency.basis, "none");
  assert.equal(result.tendency.side, "even");
  assert.equal(result.tendency.score, 0);
  assert.equal(result.tendency.reliability.agreement, 0.5);
});

test("with the pick order the tendency follows the lanes that answered, and mirrors exactly", () => {
  const later = { top: "blue", jng: "blue", mid: "blue", bot: "red", sup: "red" };
  const result = judgeDraft(unseen, { knowledge, memory, model, later });
  assert.equal(result.tendency.basis, "order");
  assert.equal(result.tendency.side, "blue");
  assert.equal(result.tendency.reliability.agreement, 0.6);
  assert.equal(result.tendency.parts.length, 5);
  // Bot carries a negative weight: picking the carry late pushes the other way.
  const bot = result.tendency.parts.find((part) => part.role === "bot");
  assert.equal(bot.later, "red");
  assert.equal(bot.favours, "blue");
  const mirrored = judgeDraft(
    { blue: unseen.red, red: unseen.blue },
    { knowledge, memory, model, later: swapLater(later) },
  );
  assert.equal(mirrored.tendency.side, "red");
  assert.equal(mirrored.tendency.score, -result.tendency.score);
});

test("an incomplete pick order is no pick order", () => {
  assert.equal(normalizeLater({ top: "blue", jng: "red" }), null);
  assert.equal(normalizeLater({ top: "blue", jng: "red", mid: "x", bot: "red", sup: "red" }), null);
  assert.equal(tendency({ later: { top: "blue" }, model }).basis, "none");
  assert.equal(tendency({ later: null, model: null }).basis, "none");
});

test("a draft he commented without choosing stays undecided", () => {
  const result = judgeDraft({ blue: undecided.blue, red: undecided.red }, { knowledge, memory, model });
  assert.equal(result.source, "memory_undecided");
  assert.equal(result.winner, null);
  assert.equal(result.kazewa.verdict.side, "even");
});

test("a judged draft brings its real pick order, and a typed one wins over it", () => {
  const draft = { blue: judged.blue, red: judged.red };
  assert.deepEqual(judgeDraft(draft, { knowledge, memory, model }).later, judged.later);
  const typed = { top: "blue", jng: "blue", mid: "blue", bot: "blue", sup: "blue" };
  assert.deepEqual(judgeDraft(draft, { knowledge, memory, model, later: typed }).later, typed);
});

test("incomplete, duplicated and unknown drafts abstain before any lookup", () => {
  const partial = judgeDraft({ blue: judged.blue, red: { top: "Gragas" } }, { knowledge, memory, model });
  assert.equal(partial.status, "incomplete");
  assert.equal(partial.source, null);
  assert.equal(partial.tendency, null);
  const unknown = judgeDraft(
    { blue: { ...judged.blue, top: "Champion Inconnu" }, red: judged.red },
    { knowledge, memory, model },
  );
  assert.equal(unknown.status, "unsupported");
  const duplicated = judgeDraft(
    { blue: judged.blue, red: { ...judged.red, top: "Jax" } },
    { knowledge, memory, model },
  );
  assert.equal(duplicated.status, "invalid");
});

test("without a memory or a model the site still answers, and claims nothing", () => {
  const result = judgeDraft(unseen, { knowledge });
  assert.equal(result.status, "complete");
  assert.equal(result.source, "unseen");
  assert.equal(result.tendency.basis, "none");
  assert.deepEqual(result.precedents, []);
  assert.deepEqual(result.arguments, []);
});

test("every screen reads one side from the judgement, with where it comes from", () => {
  const draft = { blue: judged.blue, red: judged.red };
  assert.deepEqual(judgeDraft(draft, { knowledge, memory, model }).lean, {
    basis: "memory",
    side: "red",
  });
  assert.deepEqual(
    judgeDraft({ blue: undecided.blue, red: undecided.red }, { knowledge, memory, model }).lean,
    { basis: "undecided", side: "even" },
  );
  assert.deepEqual(judgeDraft(unseen, { knowledge, memory, model }).lean, {
    basis: "none",
    side: "even",
  });
  const later = { top: "blue", jng: "blue", mid: "blue", bot: "red", sup: "red" };
  assert.deepEqual(judgeDraft(unseen, { knowledge, memory, model, later }).lean, {
    basis: "order",
    side: "blue",
  });
  assert.deepEqual(judgeDraft({ blue: judged.blue }, { knowledge, memory, model }).lean, {
    basis: "none",
    side: "even",
  });
});

test("a draft one or two champions away shows his verdict on the closest one, unless the order speaks", () => {
  const close = {
    blue: { ...judged.blue, sup: "Thresh" },
    red: judged.red,
  };
  const result = judgeDraft(close, { knowledge, memory, model });
  assert.equal(result.source, "unseen");
  assert.equal(result.near.id, "case_a");
  assert.equal(result.near.sharedChampions, 9);
  assert.deepEqual(result.lean, { basis: "near", side: "red" });
  // A measured tendency goes first; the precedent stays available.
  const later = { top: "blue", jng: "blue", mid: "blue", bot: "blue", sup: "blue" };
  const withOrder = judgeDraft(close, { knowledge, memory, model, later });
  assert.deepEqual(withOrder.lean, { basis: "order", side: "blue" });
  assert.equal(withOrder.near.id, "case_a");
});

test("while an order is being typed, only what is typed counts", () => {
  const draft = { blue: undecided.blue, red: undecided.red };
  const stored = { top: "red", jng: "red", mid: "red", bot: "red", sup: "red" };
  const withStored = indexMemory({ cases: [{ ...undecided, later: stored }] });
  const untouched = judgeDraft(draft, { knowledge, memory: withStored, model });
  assert.deepEqual(untouched.later, stored);
  assert.equal(untouched.tendency.basis, "order");
  // Four lanes typed: no order yet, and the stored one is not silently used.
  const partial = judgeDraft(draft, {
    knowledge,
    memory: withStored,
    model,
    later: { top: "blue", jng: "blue", mid: "blue", bot: "blue" },
  });
  assert.equal(partial.later, null);
  assert.equal(partial.tendency.basis, "none");
  // He still did not choose: the headline stays his.
  assert.equal(partial.lean.basis, "undecided");
});

test("ten champions with a flex filed elsewhere still return his verdict", () => {
  const flexed = {
    blue: team("Nocturne", "Jax", "Orianna", "Draven", "Nautilus"),
    red: judged.red,
  };
  const result = judgeDraft(flexed, { knowledge, memory, model });
  assert.equal(result.source, "memory");
  assert.equal(result.winner, "red");
  assert.equal(result.kazewa.rolesDiffer, true);
});

test("his arguments give the side, the pick order confirms it or cancels it", () => {
  const withClaims = indexMemory({
    cases: [
      {
        ...judged,
        claims: [
          {
            tag: "lane",
            favours: "red",
            champions: ["Gragas", "Jax"],
            role: "top",
            transferable: true,
            detail: "Gragas répond à Jax",
          },
        ],
      },
    ],
  });
  const reliable = {
    ...model,
    reliability: { ...model.reliability, arguments: { agreement: 0.63, n: 180 }, both: { agreement: 0.75, n: 79 } },
  };
  const draft = {
    blue: team("Gragas", "Vi", "Syndra", "Kai'Sa", "Rell"),
    red: team("Jax", "Viego", "Azir", "Xayah", "Rakan"),
  };
  const alone = judgeDraft(draft, { knowledge, memory: withClaims, model: reliable });
  assert.deepEqual(alone.argumentLean, { blue: 1, red: 0, side: "blue" });
  assert.deepEqual(alone.lean, { basis: "arguments", side: "blue" });
  assert.equal(alone.reliability.arguments.agreement, 0.63);
  const confirmed = judgeDraft(draft, {
    knowledge,
    memory: withClaims,
    model: reliable,
    later: { top: "blue", jng: "blue", mid: "blue", bot: "red", sup: "red" },
  });
  assert.deepEqual(confirmed.lean, { basis: "both", side: "blue" });
  const opposed = judgeDraft(draft, {
    knowledge,
    memory: withClaims,
    model: reliable,
    later: { top: "red", jng: "red", mid: "red", bot: "blue", sup: "blue" },
  });
  assert.deepEqual(opposed.lean, { basis: "split", side: "even" });
  assert.equal(opposed.argumentLean.side, "blue");
  assert.equal(opposed.tendency.side, "red");
  // Mirrored draft: every reading follows the compositions.
  const mirrored = judgeDraft({ blue: draft.red, red: draft.blue }, { knowledge, memory: withClaims, model: reliable });
  assert.deepEqual(mirrored.lean, { basis: "arguments", side: "red" });
});
