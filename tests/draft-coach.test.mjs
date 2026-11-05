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
    assert.equal(DRAFT_STEPS.filter((s) => s.side === side && s.action === "ban").length, 5);
    assert.equal(DRAFT_STEPS.filter((s) => s.side === side && s.action === "pick").length, 5);
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

test("advice stays inside the remaining pool and pick advice names an open role", () => {
  let session = createSession("first");
  const opening = advise(session, knowledge);
  assert.equal(opening.options.length, 5);
  assert.ok(opening.options.every((option) => option.role === null));
  assert.equal(
    opening.options.every((option, index, all) => index === 0 || option.score <= all[index - 1].score),
    true,
  );
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
  assert.ok(pick.options.every((option) => ["top", "jng", "mid", "bot", "sup"].includes(option.role)));
});

test("every modeled champion has a usual lane and early picks stay on it", () => {
  for (const name of Object.keys(knowledge.champions))
    assert.ok(LANES[name]?.length, name);
  let session = createSession("first");
  const bans = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"];
  let ban = 0;
  while (currentStep(session).action === "ban")
    session = applyAction(session, bans[ban++]);
  const options = advise(session, knowledge, { limit: 400 }).options;
  const roleOf = (name) => options.find((option) => option.champion === name)?.role;
  assert.equal(roleOf("Azir"), "mid");
  assert.equal(roleOf("Caitlyn"), "bot");
  assert.equal(roleOf("Lee Sin"), "jng");
  assert.equal(roleOf("Thresh"), "sup");
  assert.equal(roleOf("Briar"), "jng");
  assert.ok(options.slice(0, 5).every((option) => LANES[option.champion].includes(option.role)));
});

test("a documented partner raises the paired champion above the same champion alone", () => {
  const reach = (firstPick) => {
    const bans = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"];
    let session = createSession("first");
    let ban = 0;
    while (currentStep(session).action === "ban")
      session = applyAction(session, bans[ban++]);
    session = applyAction(session, firstPick, "mid");
    session = applyAction(session, "Renekton", "top");
    session = applyAction(session, "Lee Sin", "jng");
    return session;
  };
  const withPartner = advise(reach("Galio"), knowledge, { limit: 200 }).options.find(
    (option) => option.champion === "Camille",
  );
  const without = advise(reach("Orianna"), knowledge, { limit: 200 }).options.find(
    (option) => option.champion === "Camille",
  );
  assert.ok(withPartner);
  assert.ok(without);
  assert.ok(withPartner.score > without.score);
  assert.match(withPartner.reasons.join(" "), /Galio/);
});

test("following the advice completes a legal draft and only then asks the engine", () => {
  let session = createSession("second");
  while (currentStep(session)) {
    const advice = advise(session, knowledge);
    const choice = advice.options[0];
    session = applyAction(session, choice.champion, choice.role);
  }
  const done = advise(session, knowledge);
  assert.equal(done.done, true);
  assert.equal(done.result.status, "complete");
  assert.equal(undo(session).log.length, 19);
  assert.throws(() => applyAction(session, "Ahri", "mid"), /complète/);
});

test("a banned or duplicate champion cannot be entered", () => {
  const session = applyAction(createSession("first"), "Ahri");
  assert.throws(() => applyAction(session, "Ahri"), /déjà/);
});
