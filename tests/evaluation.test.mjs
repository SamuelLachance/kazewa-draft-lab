import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildReport,
  loadResults,
  chanceLevel,
  crossValidateArguments,
  contentHash,
  crossValidate,
  crossValidateProcess,
  fitProcess,
  groupInterval,
  rate,
  signTest,
  wilson,
  gridFingerprint,
} from "../scripts/evaluate.mjs";

const file = (name) => new URL(`../data/${name}`, import.meta.url);
const load = async (name) => JSON.parse(await readFile(file(name), "utf8"));
const ROLES = ["top", "jng", "mid", "bot", "sup"];

function synthetic(count, labelOf, groupOf = (i) => `g${Math.floor(i / 3)}`) {
  let state = 7;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const later = Object.fromEntries(
      ROLES.map((role) => [role, random() < 0.5 ? "blue" : "red"]),
    );
    return {
      id: `s${i}`,
      group: groupOf(i),
      later,
      verdict: { side: labelOf(later, random, i) },
    };
  });
}

test("Wilson interval is bounded and does not invent a zero-sample estimate", () => {
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
  const { low, high } = wilson(116, 194);
  assert.ok(low > 0.5 && low < 0.598 && high > 0.598 && high < 0.7);
  assert.equal(rate(0, 0).agreement, null);
});

test("the group interval is wider when whole groups agree or disagree together", () => {
  const independent = Array.from({ length: 120 }, (_, i) => ({
    group: `g${i}`,
    credit: i % 5 < 3 ? 1 : 0,
  }));
  const clustered = Array.from({ length: 120 }, (_, i) => ({
    group: `g${Math.floor(i / 12)}`,
    credit: Math.floor(i / 12) % 5 < 3 ? 1 : 0,
  }));
  const a = groupInterval(independent);
  const b = groupInterval(clustered);
  assert.ok(a.low < 0.6 && a.high > 0.6);
  assert.ok(b.high - b.low > (a.high - a.low) * 1.5);
  assert.deepEqual(groupInterval([]), { low: 0, high: 0 });
});

test("the sign test is exact and symmetric", () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(5, 5), 1);
  assert.ok(Math.abs(signTest(10, 0) - 2 / 1024) < 1e-12);
  assert.equal(signTest(3, 12), signTest(12, 3));
  assert.ok(signTest(40, 30) > 0.2);
});

test("the pick-order model learns a rule that exists and scores it out of group", () => {
  // He always sides with whoever answers top.
  const cases = synthetic(120, (later) => later.top);
  const weights = fitProcess(cases);
  assert.ok(weights.top > 0.5, "top should carry the weight");
  for (const role of ["jng", "mid", "bot", "sup"])
    assert.ok(Math.abs(weights[role]) < weights.top / 2);
  const cv = crossValidateProcess(cases);
  assert.equal(cv.n, 120);
  assert.equal(cv.agree, 120);
  // Positive control of the permutation test: a real rule sits at the floor.
  assert.equal(chanceLevel(cases, 99).p, 1 / 100);
});

test("with verdicts unrelated to pick order the held-out agreement stays near chance", () => {
  const cases = synthetic(240, (_later, random) => (random() < 0.5 ? "blue" : "red"));
  const cv = crossValidateProcess(cases);
  const share = cv.agree / cv.n;
  assert.ok(share > 0.35 && share < 0.65, `agreement ${share}`);
  const chance = chanceLevel(cases, 200);
  assert.ok(chance.mean > 0.4 && chance.mean < 0.6);
  assert.ok(chance.p > 0.05, `random verdicts look significant: p=${chance.p}`);
});

test("a held-out group never trains the model that scores it", () => {
  // Two thirds of the drafts sit in one group that follows the opposite rule.
  // Fitted on the others only, that group is scored 0. If it leaked into its
  // own training fold, it would dominate the fit and be scored 60 out of 60.
  const cases = synthetic(
    90,
    (later, _random, i) =>
      i < 60 ? (later.top === "blue" ? "red" : "blue") : later.top,
    (i) => (i < 60 ? "big" : `g${Math.floor(i / 3)}`),
  );
  const { rows } = crossValidate(cases);
  const big = rows.filter((row) => row.group === "big");
  assert.equal(big.length, 60);
  assert.equal(big.reduce((n, row) => n + row.credit, 0), 0);
});

test("the always-same-side rule is fitted on the other groups too", () => {
  // Every draft prefers red except one group that prefers blue.
  const cases = synthetic(
    60,
    (_later, _random, i) => (i < 6 ? "blue" : "red"),
    (i) => (i < 6 ? "odd" : `g${Math.floor(i / 3)}`),
  );
  const { rows } = crossValidate(cases);
  for (const row of rows) {
    assert.equal(row.majority, "red");
    assert.equal(row.sideCredit, row.group === "odd" ? 0 : 1);
  }
});

test("cases without pick order or without a verdict are left out of the measure", () => {
  const cases = synthetic(30, (later) => later.top);
  cases[0].later = null;
  cases[1].verdict.side = "even";
  assert.equal(crossValidateProcess(cases).n, 28);
});

test("the shipped report and model are exactly what the shipped memory gives", async () => {
  const [memory, knowledge, tuning, evaluation, model, site] = await Promise.all([
    load("kazewa-memory.json"),
    load("knowledge.json"),
    load("calculator-tuning-set.json"),
    load("evaluation.json"),
    load("model.json"),
    load("memory-site.json"),
  ]);
  assert.equal(
    evaluation.sourceHashes.memory,
    contentHash(await readFile(file("kazewa-memory.json"), "utf8")),
    "data/evaluation.json is stale: run npm run evaluate",
  );
  const fresh = buildReport(memory, knowledge, tuning, {
    now: new Date(evaluation.evaluatedAt),
    site,
    cards: await load("champion-cards.json"),
    holdout: await load("card-holdout.json"),
    played: loadResults(),
    method: await load("method.json"),
    // Measured on the match index, which is not committed: carried over.
    proGames: evaluation.unseen.shaneiGrid?.proGames ?? null,
  });
  // The carried figure was measured with the grid that is shipped.
  if (evaluation.unseen.shaneiGrid?.proGames)
    assert.equal(
      evaluation.unseen.shaneiGrid.proGames.grid,
      gridFingerprint(),
      "the grid changed since its measure on professional games: run npm run evaluate with .cache/oe-games.json",
    );
  assert.deepEqual(
    JSON.parse(JSON.stringify(fresh.evaluation)),
    evaluation,
    "data/evaluation.json is stale: run npm run evaluate",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(fresh.model)),
    model,
    "data/model.json is stale: run npm run evaluate",
  );
});

test("the report separates recall from prediction and keeps the bar in view", async () => {
  const [evaluation, model] = await Promise.all([load("evaluation.json"), load("model.json")]);
  // Every judged draft comes back with his verdict, in both orientations.
  const recallRate = evaluation.memory.selfRecall;
  assert.equal(recallRate.agree, recallRate.n);
  assert.equal(recallRate.n, evaluation.memory.decided);

  // The pick order was tried and set aside: it is still measured, next to the
  // rule with no model on the same drafts, and the site does not use it.
  const order = evaluation.unseen.pickOrder;
  assert.equal(order.usedByTheSite, false);
  assert.equal(order.sideOnly.n, order.n);
  assert.ok(["blue", "red"].includes(order.sideOnly.side));
  assert.ok(order.overSideOnly.p > 0 && order.overSideOnly.p <= 1);
  assert.ok(order.low <= order.agreement && order.agreement <= order.high);
  assert.equal(model.process, undefined);
  assert.deepEqual(
    Object.keys(model.reliability).sort(),
    ["arguments", "cards", "everyDraft", "everyDraftPlayed", "principles", "result", "shanei"],
  );

  // His arguments from other groups: counted, never fitted.
  const said = evaluation.unseen.arguments;
  assert.equal(model.reliability.arguments.agreement, said.agreement);
  // Every judged draft gets a verdict from the chain of readings, none is skipped.
  const every = evaluation.unseen.everyDraft;
  assert.equal(every.allJudgedOptimistic.n, evaluation.memory.decided);
  assert.equal(
    Object.values(every.heldOut.byReading).reduce((n, r) => n + r.n, 0),
    every.heldOut.all.n,
  );
  // The headline only counts drafts from videos the cards were written without.
  assert.ok(every.heldOut.all.n >= 50 && every.heldOut.all.n < evaluation.memory.decided);
  assert.equal(model.reliability.everyDraft.agreement, every.heldOut.all.agreement);
  // The card figure shown is the one from videos the cards never saw, and the
  // report keeps the inflated one next to it.
  const cardFigures = evaluation.unseen.championCards;
  assert.equal(model.reliability.cards.agreement, cardFigures.heldOut.agreement);
  assert.equal(model.reliability.cards.n, cardFigures.heldOut.n);
  assert.ok(cardFigures.heldOut.n >= 40);
  assert.ok(cardFigures.writtenFrom.agreement > cardFigures.heldOut.agreement);
  assert.ok(said.n <= said.judged && said.coverage > 0.5 && said.coverage <= 1);
  assert.ok(said.low <= said.agreement && said.agreement <= said.high);
  assert.ok(said.agreement < 0.8, "an unseen-draft figure this high needs a second look");

  // Composition only: a measured figure, and the tuning set is never the headline.
  const calc = evaluation.unseen.structuralCalculator;
  assert.ok(calc.neverSeen.n >= 150);
  assert.ok(calc.tunedOn.n <= 70);
  assert.equal(model.reliability.principles.agreement, calc.neverSeen.agreement);
});

test("the page never states an agreement figure of its own", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.mjs", import.meta.url), "utf8"),
  ]);
  for (const text of [html, app]) {
    assert.doesNotMatch(text, /100\s*%\s*d.accord/i);
    assert.doesNotMatch(text, /seuil de 70\s*%/i);
    // A literal percentage in running text: digits, a space, a percent sign.
    assert.doesNotMatch(text, /\d[\s  ]%/);
  }
});

test("his arguments are counted from other groups only, with no fitting", () => {
  const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
  const claim = (favours) => ({
    tag: "lane",
    favours,
    champions: ["Gragas", "Jax"],
    role: "top",
    transferable: true,
    detail: "Gragas répond à Jax",
  });
  const make = (id, group, blueTop, redTop, side, claims) => ({
    id,
    group,
    blue: team(blueTop, "Vi", "Ahri", "Jinx", "Lulu"),
    red: team(redTop, "Viego", "Azir", "Xayah", "Rakan"),
    verdict: { side },
    claims,
    sources: [],
  });
  // Same video: the argument and the verdict it explains. It must not count for itself
  // nor for the other game of its own group.
  const cases = [
    make("a", "g1", "Jax", "Gragas", "red", [claim("red")]),
    make("b", "g1", "Gragas", "Jax", "red", []),
    make("c", "g2", "Gragas", "Jax", "blue", []),
    make("d", "g3", "Jax", "Gragas", "blue", []),
  ];
  cases[1].blue.jng = "Lee Sin";
  cases[2].blue.mid = "Syndra";
  cases[3].red.mid = "Orianna";
  const rows = crossValidateArguments(cases, { cases });
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));
  // a and b are in the group of the only argument: nothing applies to them.
  assert.equal(by.a.side, null);
  assert.equal(by.b.side, null);
  // c: Gragas is blue, the argument follows him; his verdict is blue.
  assert.equal(by.c.side, "blue");
  assert.equal(by.c.credit, 1);
  // d: Gragas is red, the argument says red; his verdict is blue.
  assert.equal(by.d.side, "red");
  assert.equal(by.d.credit, 0);
});
