import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DRAFT_STEPS, applyAction, createSession, currentStep } from "../src/draft-coach.mjs";
import { trainDraftPolicy, trainingReturn } from "../src/draft-train.mjs";
import { analyzeDraft, ROLES } from "../src/engine.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);
const RETIRED = ["bot", "jng", "mid", "sup", "top"];
const BANS = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio", "Braum", "Rakan", "Leona", "Zyra"];
const LOCKED = ["Caitlyn", "Lee Sin", "Lulu", "Jinx", "Elise", "Azir"];
const POOL = ["Tristana", "Lux", "Garen", "Rumble"];

function subset(names) {
  return {
    ...knowledge,
    champions: Object.fromEntries(names.map((name) => [name, knowledge.champions[name]])),
  };
}

function play(actions) {
  return actions.reduce(
    (session, action) => applyAction(session, action.champion, action.role ?? null),
    createSession("first"),
  );
}

function witnessSession() {
  return play([
    ...BANS.slice(0, 6).map((champion) => ({ champion, role: null })),
    { champion: "Caitlyn", role: "bot" },
    { champion: "Jinx", role: "bot" },
    { champion: "Elise", role: "jng" },
    { champion: "Lee Sin", role: "jng" },
    { champion: "Lulu", role: "sup" },
    { champion: "Azir", role: "mid" },
    ...BANS.slice(6).map((champion) => ({ champion, role: null })),
  ]);
}

function pickTurns(session) {
  return DRAFT_STEPS.slice(session.log.length)
    .filter((step) => step.action === "pick")
    .map((step) => step.side);
}

function sumsToZero(left, right) {
  assert.ok(left + right === 0);
}

// Exhaustive calculator enumeration for this four-pick seat. It is not the trainer.
function calculatorActions(session, pool, small) {
  const turns = pickTurns(session);
  const rows = [];
  const walk = (picks, left, index, bucket) => {
    if (index === turns.length) {
      const result = analyzeDraft(picks, small);
      assert.equal(result.status, "complete");
      bucket.scores.push(result.score);
      return;
    }
    const side = turns[index];
    for (const champion of left) {
      for (const role of ROLES.filter((item) => !picks[side][item])) {
        const next = { blue: { ...picks.blue }, red: { ...picks.red } };
        next[side][role] = champion;
        if (index === 0) {
          const child = { champion, role, scores: [] };
          walk(
            next,
            left.filter((name) => name !== champion),
            index + 1,
            child,
          );
          rows.push(child);
        } else {
          walk(
            next,
            left.filter((name) => name !== champion),
            index + 1,
            bucket,
          );
        }
      }
    }
  };
  walk({ blue: { ...session.picks.blue }, red: { ...session.picks.red } }, pool, 0, null);
  const side = turns[0];
  return rows.map((row) => {
    const highestBlue = Math.max(...row.scores);
    const lowestBlue = Math.min(...row.scores);
    const resistant = side === "blue" ? lowestBlue : -highestBlue;
    const cooperative = side === "blue" ? highestBlue : -lowestBlue;
    return { champion: row.champion, role: row.role, resistant, cooperative };
  });
}

test("the training return is only the shipped calculator score of the finished roster", async () => {
  const small = subset([...LOCKED, ...POOL]);
  const session = witnessSession();
  const turns = pickTurns(session);
  const policy = trainDraftPolicy(small, {
    seed: 1,
    picks: session.picks,
    remaining: POOL,
    turns,
  });
  const line = policy.actions[0].line;
  const finished = analyzeDraft(line, small);
  assert.equal(finished.status, "complete");
  assert.equal(trainingReturn(line, "blue", small), finished.score);
  assert.equal(trainingReturn(line, "red", small), -finished.score);
  sumsToZero(trainingReturn(line, "blue", small), trainingReturn(line, "red", small));
  const swapped = { blue: { ...line.red }, red: { ...line.blue } };
  sumsToZero(trainingReturn(line, "blue", small), trainingReturn(swapped, "blue", small));
  const forward = { blue: {}, red: {} };
  const backward = { blue: {}, red: {} };
  for (const role of ROLES) {
    forward.blue[role] = line.blue[role];
    forward.red[role] = line.red[role];
  }
  for (const role of [...ROLES].reverse()) {
    backward.blue[role] = line.blue[role];
    backward.red[role] = line.red[role];
  }
  assert.equal(trainingReturn(forward, "red", small), trainingReturn(backward, "red", small));
  assert.equal(trainingReturn({ blue: { ...line.blue }, red: { ...line.red } }, "red", small), trainingReturn(line, "red", small));
  const incomplete = { blue: { ...line.blue, top: null }, red: { ...line.red } };
  assert.equal(trainingReturn(incomplete, "red", small), null);
  const trainSource = await readFile(new URL("../src/draft-train.mjs", import.meta.url), "utf8");
  const coachSource = await readFile(new URL("../src/draft-coach.mjs", import.meta.url), "utf8");
  assert.equal(trainSource.includes("CLOSE_ORDER"), false);
  assert.equal(trainSource.includes("lanes.mjs"), false);
  assert.equal(coachSource.includes("CLOSE_ORDER"), false);
  assert.equal(coachSource.includes("trainDraftPolicy"), false);
});

test("the trained policy picks the later role the finished calculator scores higher", () => {
  const small = subset([...LOCKED, ...POOL]);
  const session = witnessSession();
  const step = currentStep(session);
  assert.equal(step.action, "pick");
  assert.equal(step.side, "red");
  const turns = pickTurns(session);
  assert.deepEqual(turns, ["red", "blue", "blue", "red"]);
  const actions = calculatorActions(session, [...POOL], small);
  const bestReturn = Math.max(...actions.map((action) => action.resistant));
  const winners = actions.filter((action) => action.resistant === bestReturn);
  assert.equal(winners.length, 1);
  const winner = winners[0];
  const earlier = actions.find(
    (action) =>
      RETIRED.indexOf(action.role) < RETIRED.indexOf(winner.role) &&
      action.resistant < winner.resistant,
  );
  assert.ok(earlier);
  assert.ok(winner.cooperative > winner.resistant);

  const spec = { seed: 1, picks: session.picks, remaining: [...POOL].reverse(), turns };
  const first = trainDraftPolicy(small, spec);
  const second = trainDraftPolicy(small, { ...spec, remaining: POOL });
  assert.equal(first.exact, true);
  assert.equal(first.side, "red");
  assert.deepEqual(first, second);
  const trained = first.actions.find(
    (action) => action.champion === winner.champion && action.role === winner.role,
  );
  assert.ok(trained);
  assert.equal(trainingReturn(trained.line, "red", small), winner.resistant);
  assert.notEqual(trainingReturn(trained.line, "red", small), winner.cooperative);
  const highestBlue = Math.max(
    ...actions
      .filter((action) => action.champion === winner.champion && action.role === winner.role)
      .map((action) => -action.resistant),
  );
  assert.equal(analyzeDraft(trained.line, small).score, highestBlue);
  assert.ok(RETIRED.indexOf(winner.role) > RETIRED.indexOf(earlier.role));
});

test("a short seeded run on a wider pool finishes and ranks calculator lines", () => {
  const extra = Object.keys(knowledge.champions)
    .filter((name) => !LOCKED.includes(name) && !POOL.includes(name) && !BANS.includes(name))
    .slice(0, 8);
  const wide = subset([...LOCKED, ...POOL, ...extra]);
  const session = witnessSession();
  const turns = pickTurns(session);
  const remaining = Object.keys(wide.champions).filter(
    (name) => !Object.values(session.picks.blue).includes(name) && !Object.values(session.picks.red).includes(name),
  );
  const spec = { seed: 1, picks: session.picks, remaining, turns };
  const first = trainDraftPolicy(wide, spec);
  const second = trainDraftPolicy(wide, spec);
  assert.equal(first.exact, false);
  assert.deepEqual(first, second);
  assert.ok(first.actions.length > 0);
  for (const action of first.actions) {
    const finished = analyzeDraft(action.line, wide);
    assert.equal(finished.status, "complete");
    assert.equal(action.blueScore, finished.score);
    assert.equal(trainingReturn(action.line, "red", wide), -finished.score);
  }
});
