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
import { analyzeDraft, scorePartial, ROLES } from "../src/engine.mjs";

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

test("a ban adds nothing to the calculator score", () => {
  const advice = advise(createSession("first"), knowledge, { limit: 8 });
  assert.equal(advice.step.action, "ban");
  assert.equal(advice.options.length, 8);
  assert.ok(advice.options.every((option) => option.role === null && option.score === 0));
  const names = advice.options.map((option) => option.champion);
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b, "fr")), names);
  assert.match(advice.note, /ban ne change pas le score du calculateur/);
});

test("advice stays inside the remaining pool and pick advice names an open role", () => {
  let session = createSession("first");
  const opening = advise(session, knowledge);
  assert.equal(opening.options.length, 5);
  assert.ok(opening.options.every((option) => option.role === null && option.score === 0));
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
  assert.match(pick.note, /Politique entraînée/);
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

function subsetKnowledge(names) {
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

const OUTSIDERS = [
  "Bard",
  "Ivern",
  "Yuumi",
  "Nami",
  "Soraka",
  "Milio",
  "Braum",
  "Rakan",
  "Leona",
  "Zyra",
];

test("a pick follows the resistant finished score when the partial board disagrees", () => {
  const pool = ["Aatrox", "Akali", "Akshan", "Rumble"];
  const locked = ["Jinx", "Lee Sin", "Azir", "Lulu", "Caitlyn", "Elise", "Orianna", "Nautilus"];
  const small = subsetKnowledge([...locked, ...pool]);
  const session = play([
    ...OUTSIDERS.slice(0, 6).map((champion) => ({ champion, role: null })),
    { champion: "Jinx", role: "bot" },
    { champion: "Caitlyn", role: "bot" },
    { champion: "Elise", role: "jng" },
    { champion: "Lee Sin", role: "jng" },
    { champion: "Azir", role: "mid" },
    { champion: "Orianna", role: "mid" },
    ...OUTSIDERS.slice(6, 10).map((champion) => ({ champion, role: null })),
    { champion: "Nautilus", role: "sup" },
    { champion: "Lulu", role: "sup" },
  ]);
  assert.equal(currentStep(session).action, "pick");
  assert.equal(currentStep(session).side, "blue");
  const open = ROLES.filter((role) => !session.picks.blue[role]);
  assert.deepEqual(open, ["top"]);
  const draftOf = (pick, answer) => ({
    blue: { ...session.picks.blue, top: pick },
    red: { ...session.picks.red, top: answer },
  });
  const partialOf = (pick) =>
    scorePartial(
      { blue: { ...session.picks.blue, top: pick }, red: { ...session.picks.red } },
      small,
    ).score;
  const answersFor = (pick) => pool.filter((name) => name !== pick);
  const resistant = (pick) =>
    Math.min(...answersFor(pick).map((answer) => analyzeDraft(draftOf(pick, answer), small).score));
  const cooperative = (pick) =>
    Math.max(...answersFor(pick).map((answer) => analyzeDraft(draftOf(pick, answer), small).score));
  const best = pool
    .map((name) => ({ name, resistant: resistant(name), partial: partialOf(name) }))
    .reduce((left, right) => (right.resistant > left.resistant ? right : left));
  const partialBest = pool
    .map((name) => ({ name, partial: partialOf(name) }))
    .reduce((left, right) => (right.partial > left.partial ? right : left));
  assert.notEqual(partialBest.name, best.name);
  assert.notEqual(cooperative(best.name), best.resistant);
  const advice = advise(session, small, { limit: 10 });
  assert.equal(advice.options[0].champion, best.name);
  assert.equal(advice.options[0].role, open[0]);
  assert.equal(advice.options[0].score, best.resistant);
  assert.equal(advice.options[0].score, trainingReturn(
    draftOf(
      best.name,
      answersFor(best.name).reduce((left, right) =>
        analyzeDraft(draftOf(best.name, right), small).score <
        analyzeDraft(draftOf(best.name, left), small).score
          ? right
          : left,
      ),
    ),
    "blue",
    small,
  ));
  for (const name of pool)
    assert.equal(advice.options.some((option) => option.champion === name), true);
});
