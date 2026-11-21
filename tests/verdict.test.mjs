import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fingerprint, indexMemory } from "../src/memory.mjs";
import { cardReading, cardRelations, mentionedChampions } from "../src/relations.mjs";
import { argumentLean, chooseReading, judgeDraft } from "../src/verdict.mjs";
import { indexMethod } from "../src/method.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const knowledge = await load("knowledge.json");
const methodIndex = indexMethod(await load("method.json"));
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const judged = {
  id: "case_a",
  blue: team("Jax", "Nocturne", "Orianna", "Draven", "Nautilus"),
  red: team("Gragas", "Skarner", "Ahri", "Jhin", "Leona"),
  sides: "map",
  rosterVerified: true,
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
  verdict: { side: "even", confidence: 0, timing: null, label: "" },
};
undecided.fingerprint = fingerprint(undecided);
const memory = indexMemory({ cases: [judged, undecided] });
const model = {
  reliability: {
    arguments: { agreement: 0.6, n: 200, low: 0.53, high: 0.67 },
    cards: { agreement: 0.57, n: 56, low: 0.44, high: 0.69 },
    principles: { agreement: 0.5, n: 208, low: 0.43, high: 0.58 },
  },
};
const unseen = {
  blue: team("Sion", "Maokai", "Azir", "Jinx", "Lulu"),
  red: team("Jayce", "Nidalee", "LeBlanc", "Jhin", "Pyke"),
};

test("a draft he judged is answered with his verdict, never with an estimate", () => {
  const result = judgeDraft({ blue: judged.blue, red: judged.red }, { knowledge, memory, model });
  assert.equal(result.status, "complete");
  assert.equal(result.source, "memory");
  assert.equal(result.winner, "red");
  assert.deepEqual(result.lean, { basis: "memory", side: "red" });
  assert.equal(result.kazewa.verdict.confidence, 2);
  const mirrored = judgeDraft({ blue: judged.red, red: judged.blue }, { knowledge, memory, model });
  assert.equal(mirrored.source, "memory");
  assert.equal(mirrored.winner, "blue");
  // The structural calculator may say anything: it does not override him.
  assert.ok(["blue", "red", "even"].includes(result.structure.winner));
});

test("provider spellings and a flex filed in another role still find the judged draft", () => {
  const spelled = {
    blue: team("jax", "NOCTURNE", "orianna", "Draven", "nautilus"),
    red: team("Gragas", "Skarner", "Ahri", "Jhin", "Leona"),
  };
  assert.equal(judgeDraft(spelled, { knowledge, memory, model }).source, "memory");
  const flexed = {
    blue: team("Nocturne", "Jax", "Orianna", "Draven", "Nautilus"),
    red: judged.red,
  };
  const result = judgeDraft(flexed, { knowledge, memory, model });
  assert.equal(result.source, "memory");
  assert.equal(result.winner, "red");
  assert.equal(result.kazewa.rolesDiffer, true);
});

test("a draft he commented without choosing stays undecided", () => {
  const result = judgeDraft({ blue: undecided.blue, red: undecided.red }, { knowledge, memory, model });
  assert.equal(result.source, "memory_undecided");
  assert.equal(result.winner, null);
  assert.deepEqual(result.lean, { basis: "undecided", side: "even" });
});

test("the estimate is read from the most reliable reading, and none when nothing separates", () => {
  assert.deepEqual(chooseReading({ argumentSide: "red", cardSide: "blue" }), { basis: "arguments", side: "red" });
  assert.deepEqual(chooseReading({ argumentSide: null, cardSide: "blue" }), { basis: "cards", side: "blue" });
  assert.deepEqual(chooseReading({ argumentSide: null, cardSide: null }), { basis: "balance", side: "even" });
  // The decision grid of the two coaches is a second opinion: it never sets the estimate.
  assert.deepEqual(chooseReading({ argumentSide: null, cardSide: null, theorySide: "red" }), { basis: "balance", side: "even" });
  // The result of a game already played is measured, never the estimate.
  assert.deepEqual(chooseReading({ resultSide: "blue", argumentSide: "red" }), { basis: "result", side: "blue" });
  assert.deepEqual(argumentLean([{ favours: "blue" }, { favours: "red" }]), { blue: 1, red: 1, side: "even" });
});

test("an unseen draft with no argument and no card gets no estimate, and the grid stays a second opinion", () => {
  const result = judgeDraft(unseen, { knowledge, memory, model, method: methodIndex });
  assert.equal(result.source, "unseen");
  // `winner` is his verdict only: the site never passes its estimate off as his.
  assert.equal(result.winner, null);
  assert.equal(result.kazewa, null);
  // No argument, no card: no estimate. The grid of the two coaches is shown apart.
  assert.equal(result.lean.basis, "balance");
  assert.equal(result.lean.side, "even");
  assert.ok(result.theory, "the grid is still computed as a second opinion");
  assert.equal(result.reliability, model.reliability);
});

test("his arguments from another draft give the side, and follow the compositions", () => {
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
  const draft = {
    blue: team("Gragas", "Vi", "Syndra", "Kai'Sa", "Rell"),
    red: team("Jax", "Viego", "Azir", "Xayah", "Rakan"),
  };
  const result = judgeDraft(draft, { knowledge, memory: withClaims, model });
  assert.deepEqual(result.argumentLean, { blue: 1, red: 0, side: "blue" });
  assert.deepEqual(result.lean, { basis: "arguments", side: "blue" });
  assert.equal(result.reliability.arguments.agreement, 0.6);
  const mirrored = judgeDraft({ blue: draft.red, red: draft.blue }, { knowledge, memory: withClaims, model });
  assert.deepEqual(mirrored.lean, { basis: "arguments", side: "red" });
});

test("a draft one champion away keeps the closest judged draft in view, without borrowing its verdict", () => {
  const close = { blue: { ...judged.blue, sup: "Thresh" }, red: judged.red };
  const result = judgeDraft(close, { knowledge, memory, model });
  assert.equal(result.source, "unseen");
  assert.equal(result.near.id, "case_a");
  assert.equal(result.near.sharedChampions, 9);
  assert.notEqual(result.lean.basis, "memory");
  assert.equal(result.winner, null);
});

test("his champion cards speak when no argument applies, and nothing speaks when neither does", () => {
  const names = ["Vi", "Viego", "Nocturne", "Twisted Fate", "Pantheon", "Akali"];
  // Whole names only: "Vi" is not found inside "Viego".
  assert.deepEqual(mentionedChampions("Viego puis Twisted Fate.", names), ["Viego", "Twisted Fate"]);
  assert.deepEqual(mentionedChampions("Avec Vi, ou Viego.", names), ["Vi", "Viego"]);
  const relations = cardRelations({
    Nocturne: { good: "Twisted Fate (double global)", bad: "Tahm Kench" },
    "Twisted Fate": { good: "Nocturne", bad: "Akali" },
    Akali: { good: "", bad: "" },
    Pantheon: { good: "", bad: "" },
  });
  const draft = {
    blue: team("Gwen", "Nocturne", "Twisted Fate", "Yunara", "Neeko"),
    red: team("Akali", "Pantheon", "Aurora", "Xayah", "Lulu"),
  };
  const reading = cardReading(draft, relations);
  // One synergy counted once (blue), one punisher on the other side (red).
  assert.deepEqual(
    reading.items.map((item) => [item.kind, item.champion, item.other, item.favours]),
    [
      ["synergy", "Nocturne", "Twisted Fate", "blue"],
      ["counter", "Twisted Fate", "Akali", "red"],
    ],
  );
  assert.equal(reading.side, "even");
  const strong = cardRelations({
    Nocturne: { good: "Twisted Fate", bad: "" },
    "Twisted Fate": { good: "", bad: "" },
  });
  const result = judgeDraft(draft, { knowledge, memory, model, relations: strong });
  assert.deepEqual(result.lean, { basis: "cards", side: "blue" });
  const mirrored = judgeDraft({ blue: draft.red, red: draft.blue }, { knowledge, memory, model, relations: strong });
  assert.deepEqual(mirrored.lean, { basis: "cards", side: "red" });
  assert.deepEqual(cardReading(draft, null), { items: [], blue: 0, red: 0, side: "even" });
});

test("incomplete, duplicated and unknown drafts abstain before any lookup", () => {
  const partial = judgeDraft({ blue: judged.blue, red: { top: "Gragas" } }, { knowledge, memory, model });
  assert.equal(partial.status, "incomplete");
  assert.equal(partial.source, null);
  assert.deepEqual(partial.lean, { basis: "none", side: "even" });
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

test("without a memory, a model or cards the site gives no estimate, and still shows the grid", () => {
  const result = judgeDraft(unseen, { knowledge, method: methodIndex });
  assert.equal(result.status, "complete");
  assert.equal(result.source, "unseen");
  assert.equal(result.lean.basis, "balance");
  assert.ok(result.theory);
  assert.equal(result.reliability, null);
  assert.deepEqual(result.precedents, []);
  assert.deepEqual(result.arguments, []);
});

test("with the shipped data every complete draft gets an estimate or says it has none, whatever the champions", async () => {
  const [site, shipped, cards] = await Promise.all([
    load("memory-site.json"),
    load("model.json"),
    load("champion-cards.json"),
  ]);
  const options = {
    knowledge,
    memory: indexMemory(site),
    model: shipped,
    relations: cardRelations(cards),
    method: methodIndex,
  };
  // The draft from the report: no argument applies to it.
  const reported = judgeDraft(
    {
      blue: team("Gwen", "Nocturne", "Twisted Fate", "Yunara", "Neeko"),
      red: team("Akali", "Pantheon", "Aurora", "Xayah", "Lulu"),
    },
    options,
  );
  assert.equal(reported.status, "complete");
  assert.ok(["blue", "red"].includes(reported.lean.side), `no side: ${reported.lean.basis}`);
  // Five hundred drafts drawn from the whole catalogue, rare champions included.
  const names = Object.keys(knowledge.champions);
  let state = 20261114;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const counts = {};
  for (let i = 0; i < 500; i++) {
    const pool = [...names];
    const pick = () => pool.splice(Math.floor(random() * pool.length), 1)[0];
    const draft = {
      blue: team(pick(), pick(), pick(), pick(), pick()),
      red: team(pick(), pick(), pick(), pick(), pick()),
    };
    const result = judgeDraft(draft, options);
    assert.equal(result.status, "complete");
    assert.notEqual(result.lean.basis, "none");
    counts[result.lean.basis] = (counts[result.lean.basis] ?? 0) + 1;
    if (result.lean.basis !== "balance")
      assert.ok(["blue", "red"].includes(result.lean.side));
    // The reliability shown for the reading exists in the shipped model.
    if (!["balance", "memory", "undecided"].includes(result.lean.basis))
      assert.ok(
        shipped.reliability[result.lean.basis]?.agreement > 0,
        `no reliability for ${result.lean.basis}`,
      );
  }
  // No estimate is a result too: the site says so rather than invent a side.
  for (const basis of Object.keys(counts))
    assert.ok(["arguments", "cards", "result", "balance"].includes(basis), basis);
});

test("a card clause is read for what it says: partner, victim, punisher or bad partner", () => {
  const relations = cardRelations({
    Ezreal: { good: "Avec Karma et Leona ; contre Gnar, Neeko.", bad: "Puni par Nautilus." },
    Ashe: { good: "", bad: "Avec Akali (anti-synergie) ; Xin/Vi = anti-synergie ; face à Jarvan." },
    Gnar: { good: "", bad: "" },
    Neeko: { good: "", bad: "" },
    Karma: { good: "", bad: "" },
    Leona: { good: "", bad: "" },
    Nautilus: { good: "", bad: "" },
    Akali: { good: "", bad: "" },
    "Xin Zhao": { good: "", bad: "" },
    Vi: { good: "", bad: "" },
    "Jarvan IV": { good: "", bad: "" },
  });
  assert.deepEqual([...relations.goodWith.get("Ezreal")].sort(), ["Karma", "Leona"]);
  assert.deepEqual([...relations.goodAgainst.get("Ezreal")].sort(), ["Gnar", "Neeko"]);
  assert.deepEqual([...relations.badAgainst.get("Ezreal")], ["Nautilus"]);
  // Short names are understood, and anti-synergy is about allies.
  assert.deepEqual([...relations.badWith.get("Ashe")].sort(), ["Akali", "Vi", "Xin Zhao"]);
  assert.deepEqual([...relations.badAgainst.get("Ashe")], ["Jarvan IV"]);

  // Gnar next to Ezreal is not a synergy: the card says Ezreal is good AGAINST Gnar.
  const allies = cardReading(
    { blue: team("Gnar", "Vi", "Akali", "Ezreal", "Karma"), red: team("Ornn", "Viego", "Azir", "Jinx", "Lulu") },
    relations,
  );
  assert.deepEqual(
    allies.items.map((item) => [item.kind, item.champion, item.other, item.favours]),
    [["synergy", "Ezreal", "Karma", "blue"]],
  );
  // Gnar opposite Ezreal: Ezreal gets the better of him, for Ezreal's side.
  const facing = cardReading(
    { blue: team("Ornn", "Viego", "Azir", "Ezreal", "Lulu"), red: team("Gnar", "Jarvan IV", "Akali", "Ashe", "Nautilus") },
    relations,
  );
  assert.deepEqual(
    facing.items.map((item) => [item.kind, item.champion, item.other, item.favours]).sort(),
    [
      ["antisynergy", "Ashe", "Akali", "blue"],
      ["counter", "Ezreal", "Nautilus", "red"],
      ["counter", "Gnar", "Ezreal", "blue"],
    ],
  );
});

test("the pick order is not an input of the verdict any more", () => {
  const later = { top: "blue", jng: "blue", mid: "blue", bot: "blue", sup: "blue" };
  const plain = judgeDraft(unseen, { knowledge, memory, model });
  const withOrder = judgeDraft(unseen, { knowledge, memory, model, later });
  assert.deepEqual(withOrder.lean, plain.lean);
  assert.equal(withOrder.later, undefined);
  assert.equal(withOrder.tendency, undefined);
});
