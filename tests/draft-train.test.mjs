import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DRAFT_STEPS, advise, applyAction, createSession, currentStep } from "../src/draft-coach.mjs";
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
  assert.equal(coachSource.includes("lanes.mjs"), false);
});

test("the trained policy and the coach pick the later role the calculator scores higher", () => {
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

  const advice = advise(session, small, { seed: 1, limit: 12 });
  assert.equal(advice.options[0].champion, winner.champion);
  assert.equal(advice.options[0].role, winner.role);
  assert.equal(advice.options[0].score, winner.resistant);
  assert.equal(advice.options[0].score, trainingReturn(trained.line, "red", small));
  assert.ok(advice.note.includes(winner.champion));
  assert.ok(advice.note.includes(String(winner.resistant)));
  const rankedEarlier = advice.options.find(
    (option) => option.champion === earlier.champion && option.role === earlier.role,
  );
  assert.ok(rankedEarlier);
  assert.ok(advice.options[0].score > rankedEarlier.score);
  assert.ok(RETIRED.indexOf(advice.options[0].role) > RETIRED.indexOf(rankedEarlier.role));
  const again = advise(session, small, { seed: 1, limit: 12 });
  assert.deepEqual(again, advice);

  const clicked = applyAction(session, winner.champion, null, small);
  assert.equal(clicked.picks.red[winner.role], winner.champion);
  const placed = applyAction(session, earlier.champion, null, small);
  const sameChampion = advice.options.find((option) => option.champion === earlier.champion);
  assert.equal(placed.picks.red[sameChampion.role], earlier.champion);
});

test("a short seeded run on a wider pool is what the coach quotes", () => {
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
  const advice = advise(session, wide, { seed: 1, limit: 12 });
  const chosen = first.actions.find(
    (action) => action.champion === advice.options[0].champion && action.role === advice.options[0].role,
  );
  assert.ok(chosen);
  const quoted = trainingReturn(chosen.line, "red", wide);
  assert.equal(advice.options[0].score, quoted);
  const best = Math.max(...first.actions.map((action) => trainingReturn(action.line, "red", wide)));
  assert.equal(advice.options[0].score, best);
  for (let index = 1; index < advice.options.length; index += 1)
    assert.ok(advice.options[index - 1].score >= advice.options[index].score);
  const top = advice.options[0];
  const placed = applyAction(session, top.champion, null, wide);
  assert.equal(placed.picks[turns[0]][top.role], top.champion);
  assert.equal(top.score, trainingReturn(chosen.line, turns[0], wide));
  const finishedForChampion = first.actions.filter((action) => action.champion === top.champion);
  const bestForChampion = Math.max(
    ...finishedForChampion.map((action) => trainingReturn(action.line, turns[0], wide)),
  );
  assert.equal(trainingReturn(chosen.line, turns[0], wide), bestForChampion);
});

test("a bounded suggestion and a click with no role play the same finished line", () => {
  const bans = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"];
  let session = createSession("first");
  for (const champion of bans) session = applyAction(session, champion);
  const advice = advise(session, knowledge, { seed: 1, limit: 8 });
  const turns = pickTurns(session);
  const remaining = Object.keys(knowledge.champions).filter((name) => !bans.includes(name));
  const policy = trainDraftPolicy(knowledge, {
    seed: 1,
    picks: session.picks,
    remaining,
    turns,
  });
  assert.equal(policy.exact, false);
  const top = advice.options[0];
  const placed = applyAction(session, top.champion, null, knowledge);
  assert.equal(placed.picks[turns[0]][top.role], top.champion);
  const played = policy.actions.find(
    (action) => action.champion === top.champion && action.role === top.role,
  );
  assert.ok(played);
  assert.equal(top.score, trainingReturn(played.line, turns[0], knowledge));
  const finishedForChampion = policy.actions.filter((action) => action.champion === top.champion);
  const bestForChampion = Math.max(
    ...finishedForChampion.map((action) => trainingReturn(action.line, turns[0], knowledge)),
  );
  assert.equal(trainingReturn(played.line, turns[0], knowledge), bestForChampion);
  for (const option of advice.options) {
    const firstShown = advice.options.find((item) => item.champion === option.champion);
    const clicked = applyAction(session, option.champion, null, knowledge);
    assert.equal(clicked.picks[turns[0]][firstShown.role], option.champion);
  }
});
