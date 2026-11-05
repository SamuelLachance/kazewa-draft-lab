import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DRAFT_STEPS,
  advise,
  applyAction,
  createSession,
  currentStep,
  undo,
} from "../src/draft-coach.mjs";
import { trainingReturn } from "../src/draft-train.mjs";
import { scorePartial, ROLES } from "../src/engine.mjs";
import { LANES } from "../src/lanes.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);

test("competitive order gives five bans and five picks to each side", () => {
  assert.equal(DRAFT_STEPS.length, 20);
  assert.deepEqual(DRAFT_STEPS[0], { action: "ban", side: "blue" });
  assert.deepEqual(DRAFT_STEPS[6], { action: "pick", side: "blue" });
  assert.deepEqual(DRAFT_STEPS[7], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[8], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[12], { action: "ban", side: "red" });
  assert.deepEqual(DRAFT_STEPS[16], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[19], { action: "pick", side: "red" });
  for (const side of ["blue", "red"]) {
    assert.equal(DRAFT_STEPS.filter((step) => step.side === side && step.action === "ban").length, 5);
    assert.equal(DRAFT_STEPS.filter((step) => step.side === side && step.action === "pick").length, 5);
  }
});

test("first pick acts on the opening ban and second pick waits", () => {
  const first = currentStep(createSession("first"));
  const second = currentStep(createSession("second"));
  assert.equal(first.ours, true);
  assert.equal(first.action, "ban");
  assert.equal(first.side, "blue");
  assert.equal(second.ours, false);
  assert.equal(second.userSide ?? createSession("second").userSide, "red");
});

test("a ban ranks the whole pool by the opponent's current calculator score", () => {
  const advice = advise(createSession("first"), knowledge, { limit: 8 });
  assert.equal(advice.step.action, "ban");
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length);
  assert.equal(advice.options.length, 8);
  assert.deepEqual(advice.options, advice.pool.slice(0, 8));
  assert.ok(advice.pool.every((option) => option.role === null && Number.isFinite(option.score)));
  assert.ok(advice.pool.some((option) => option.score !== 0));
  for (let index = 1; index < advice.pool.length; index += 1)
    assert.ok(advice.pool[index - 1].score >= advice.pool[index].score);
  assert.match(advice.note, /pool entier/);
  assert.match(advice.note, /autre côté/);
  const top = advice.pool[0];
  const next = applyAction(createSession("first"), top.champion);
  const again = advise(next, knowledge, { limit: 8 });
  assert.equal(again.pool.some((option) => option.champion === top.champion), false);
  const survivor = again.pool.find((option) => option.champion === advice.pool[1].champion);
  assert.equal(survivor.score, advice.pool[1].score);
});

test("advice stays inside the remaining pool and pick advice names an open role", () => {
  let session = createSession("first");
  const opening = advise(session, knowledge);
  assert.equal(opening.options.length, 5);
  assert.equal(opening.pool.length, Object.keys(knowledge.champions).length);
  assert.ok(opening.options.every((option) => option.role === null && Number.isFinite(option.score)));
  session = applyAction(session, opening.options[0].champion);
  assert.equal(
    advise(session, knowledge).options.some((option) => option.champion === opening.options[0].champion),
    false,
  );
  while (currentStep(session).action === "ban")
    session = applyAction(session, advise(session, knowledge).options[0].champion);
  const pick = advise(session, knowledge);
  assert.equal(pick.step.action, "pick");
  assert.equal(pick.step.side, "blue");
  assert.ok(pick.options.length > 0);
  assert.ok(pick.options.every((option) => ROLES.includes(option.role)));
  assert.ok(pick.options.every((option, index, all) => index === 0 || option.score <= all[index - 1].score));
  assert.equal(pick.pool.length, Object.keys(knowledge.champions).length - 6);
  assert.match(pick.note, /draft actuelle/);
});

test("following the advice completes a legal draft and only then asks the engine", () => {
  let session = createSession("second");
  while (currentStep(session)) {
    const advice = advise(session, knowledge);
    const choice = advice.options[0];
    assert.ok(choice);
    session = applyAction(session, choice.champion, choice.role);
  }
  const done = advise(session, knowledge);
  assert.equal(done.done, true);
  assert.equal(done.result.status, "complete");
  assert.equal(done.result.score, trainingReturn(session.picks, "blue", knowledge));
  assert.equal(undo(session).log.length, 19);
  assert.throws(() => applyAction(session, "Ahri", "mid"), /complète/);
});

test("a banned or duplicate champion cannot be entered", () => {
  const session = applyAction(createSession("first"), "Ahri");
  assert.throws(() => applyAction(session, "Ahri"), /déjà/);
});

test("an explicit role is accepted even off the champion's usual lane", () => {
  const placed = applyAction(afterOpeningBans(), "Azir", "jng");
  assert.equal(placed.picks.blue.jng, "Azir");
  assert.equal(placed.picks.blue.mid, null);
});

function afterOpeningBans() {
  const bans = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"];
  let session = createSession("first");
  let ban = 0;
  while (currentStep(session).action === "ban")
    session = applyAction(session, bans[ban++]);
  return session;
}

test("the whole pool is ordered by the calculator score of the current draft", () => {
  const session = afterOpeningBans();
  const advice = advise(session, knowledge, { limit: 8 });
  const banned = new Set(["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"]);
  assert.equal(advice.step.action, "pick");
  assert.equal(advice.step.side, "blue");
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length - banned.size);
  assert.deepEqual(advice.options, advice.pool.slice(0, 8));
  for (let index = 1; index < advice.pool.length; index += 1)
    assert.ok(advice.pool[index - 1].score >= advice.pool[index].score);
  for (const row of advice.pool) assert.equal(banned.has(row.champion), false);
  const top = advice.pool[0];
  assert.equal(
    top.score,
    scorePartial(
      { blue: { ...session.picks.blue, [top.role]: top.champion }, red: { ...session.picks.red } },
      knowledge,
    ).score,
  );
  const placed = applyAction(session, top.champion, null, knowledge);
  assert.equal(placed.picks.blue[top.role], top.champion);
  const alistar = advice.pool.find((row) => row.champion === "Alistar");
  assert.equal(alistar.role, "sup");
  assert.deepEqual(LANES.Alistar, ["sup"]);
  const braum = advice.pool.find((row) => row.champion === "Braum");
  assert.equal(braum.role, "sup");
  assert.equal(LANES.Braum.includes("top"), false);
});

test("champion values change once the draft locks a champion", () => {
  let session = afterOpeningBans();
  const before = advise(session, knowledge, { limit: 1 });
  const earlier = new Map(before.pool.map((row) => [row.champion, row.score]));
  session = applyAction(session, "Jinx", "bot", knowledge);
  session = applyAction(session, "Caitlyn", "bot", knowledge);
  session = applyAction(session, "Lulu", "sup", knowledge);
  assert.equal(currentStep(session).side, "blue");
  assert.equal(currentStep(session).action, "pick");
  const after = advise(session, knowledge, { limit: 1 });
  let changed = 0;
  for (const row of after.pool) {
    if (earlier.has(row.champion) && earlier.get(row.champion) !== row.score) changed += 1;
  }
  assert.ok(changed > 0);
  const maokaiBefore = earlier.get("Maokai");
  const maokaiAfter = after.pool.find((row) => row.champion === "Maokai");
  assert.notEqual(maokaiBefore, maokaiAfter.score);
});

test("a later ban phase scores the same champions against the locked draft", () => {
  let session = afterOpeningBans();
  const opening = new Map(
    advise(session, knowledge, { limit: 1 }).pool.map((row) => [row.champion, row.score]),
  );
  for (const [champion, role] of [
    ["Jinx", "bot"],
    ["Caitlyn", "bot"],
    ["Elise", "jng"],
    ["Lee Sin", "jng"],
    ["Orianna", "mid"],
    ["Azir", "mid"],
  ])
    session = applyAction(session, champion, role, knowledge);
  assert.equal(currentStep(session).action, "ban");
  const later = advise(session, knowledge, { limit: 1 });
  let changed = 0;
  for (const row of later.pool) {
    if (opening.has(row.champion) && opening.get(row.champion) !== row.score) changed += 1;
  }
  assert.ok(changed > 0);
  assert.equal(later.pool.some((row) => row.champion === "Jinx"), false);
});

test("an off-role wins when the current board scores it higher, and the click plays it", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Rumble", "top", knowledge);
  assert.equal(currentStep(session).side, "red");
  assert.equal(currentStep(session).action, "pick");
  const advice = advise(session, knowledge, { limit: 400 });
  const galio = advice.pool.find((row) => row.champion === "Galio");
  const byRole = Object.fromEntries(
    ROLES.map((role) => [
      role,
      -scorePartial(
        {
          blue: { ...session.picks.blue },
          red: { ...session.picks.red, [role]: "Galio" },
        },
        knowledge,
      ).score,
    ]),
  );
  const best = Math.max(...Object.values(byRole));
  assert.ok(byRole.top > byRole.mid);
  assert.equal(galio.role, "top");
  assert.equal(galio.flex, false);
  assert.equal(galio.score, best);
  assert.equal(galio.score, byRole.top);
  assert.equal(LANES.Galio.includes("top"), false);
  const placed = applyAction(session, "Galio", null, knowledge);
  assert.equal(placed.picks.red.top, "Galio");
  for (const option of advice.options) {
    const clicked = applyAction(session, option.champion, null, knowledge);
    assert.equal(clicked.picks.red[option.role], option.champion);
  }
});

test("a tied off-role stays flexible instead of pretending one lane was chosen", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Dr. Mundo", "top", knowledge);
  session = applyAction(session, "Jinx", "bot", knowledge);
  session = applyAction(session, "Lulu", "sup", knowledge);
  assert.equal(currentStep(session).side, "blue");
  const advice = advise(session, knowledge, { limit: 1 });
  const ornn = advice.pool.find((row) => row.champion === "Ornn");
  const open = ROLES.filter((role) => !session.picks.blue[role]);
  const scores = open.map((role) =>
    scorePartial(
      { blue: { ...session.picks.blue, [role]: "Ornn" }, red: { ...session.picks.red } },
      knowledge,
    ).score,
  );
  const highest = Math.max(...scores);
  const tied = open.filter((role, index) => scores[index] === highest);
  assert.ok(tied.length > 1);
  assert.equal(tied.some((role) => LANES.Ornn.includes(role)), false);
  assert.equal(ornn.flex, true);
  assert.equal(ornn.score, highest);
  assert.ok(tied.includes(ornn.role));
  const placed = applyAction(session, "Ornn", null, knowledge);
  assert.equal(placed.picks.blue[ornn.role], "Ornn");
});
