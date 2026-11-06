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

test("a ban ranks the pool by what the opponent can actually lock", () => {
  const advice = advise(createSession("first"), knowledge, { limit: 8 });
  assert.equal(advice.step.action, "ban");
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length);
  assert.equal(advice.options.length, 8);
  assert.deepEqual(advice.options, advice.pool.slice(0, 8));
  assert.ok(advice.pool.every((option) => option.role === null && Number.isFinite(option.score)));
  assert.ok(advice.pool.some((option) => option.score !== 0));
  for (let index = 1; index < advice.pool.length; index += 1)
    assert.ok(advice.pool[index - 1].priority >= advice.pool[index].priority);
  assert.match(advice.note, /pool entier/);
  assert.match(advice.note, /autre côté/);
  const top = advice.pool[0];
  assert.equal(["Caitlyn", "Varus", "Aphelios", "Jinx", "Xayah", "Braum"].includes(top.champion), false);
  const varus = advice.pool.find((row) => row.champion === "Varus");
  assert.ok(top.priority > varus.priority);
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
  assert.ok(
    pick.options.every((option, index, all) => index === 0 || option.priority <= all[index - 1].priority),
  );
  assert.equal(pick.pool.length, Object.keys(knowledge.champions).length - 6);
  assert.match(pick.note, /draft actuelle/);
});

test("following the advice completes a legal draft and only then asks the engine", () => {
  let session = createSession("second");
  while (currentStep(session)) {
    const advice = advise(session, knowledge);
    const choice = advice.options[0];
    assert.ok(choice);
    assert.equal(choice.playable, true);
    session = applyAction(session, choice.champion, choice.role, knowledge);
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

test("the portrait score stays the calculator, and the order refuses a blind", () => {
  const session = afterOpeningBans();
  const advice = advise(session, knowledge, { limit: 8 });
  const banned = new Set(["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"]);
  assert.equal(advice.step.action, "pick");
  assert.equal(advice.step.side, "blue");
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length - banned.size);
  assert.deepEqual(advice.options, advice.pool.slice(0, 8));
  for (let index = 1; index < advice.pool.length; index += 1)
    assert.ok(advice.pool[index - 1].priority >= advice.pool[index].priority);
  for (const row of advice.pool) assert.equal(banned.has(row.champion), false);
  const top = advice.pool[0];
  assert.ok(["Caitlyn", "Varus", "Aphelios", "Jinx", "Xayah"].includes(top.champion));
  assert.equal(top.role, "bot");
  assert.equal(
    top.score,
    scorePartial(
      { blue: { ...session.picks.blue, [top.role]: top.champion }, red: { ...session.picks.red } },
      knowledge,
    ).score,
  );
  const braum = advice.pool.find((row) => row.champion === "Braum");
  const mundo = advice.pool.find((row) => row.champion === "Dr. Mundo");
  assert.ok(top.priority > braum.priority);
  assert.ok(top.priority > mundo.priority);
  assert.ok(mundo.score > top.score);
  const placed = applyAction(session, top.champion, null, knowledge);
  assert.equal(placed.picks.blue[top.role], top.champion);
  const alistar = advice.pool.find((row) => row.champion === "Alistar");
  assert.equal(alistar.role, "sup");
  assert.deepEqual(LANES.Alistar, ["sup"]);
  assert.equal(braum.role, "sup");
  assert.equal(LANES.Braum.includes("top"), false);
});

test("Braum is not blinded before the carry exists", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Dr. Mundo", "top", knowledge);
  session = applyAction(session, "Maokai", "jng", knowledge);
  session = applyAction(session, "Jhin", "bot", knowledge);
  assert.equal(currentStep(session).side, "blue");
  assert.equal(currentStep(session).action, "pick");
  const advice = advise(session, knowledge, { limit: 8 });
  assert.notEqual(advice.options[0].champion, "Braum");
  assert.ok(["bot", "jng", "mid"].includes(advice.options[0].role));
  const braum = advice.pool.find((row) => row.champion === "Braum");
  assert.equal(braum.role, "sup");
  assert.ok(advice.options[0].priority > braum.priority);
  assert.match(braum.reasons[0], /Blind réactif/);
  const ready = advise(
    {
      ...session,
      picks: {
        blue: { ...session.picks.blue, bot: "Lucian" },
        red: { ...session.picks.red },
      },
    },
    knowledge,
    { limit: 400 },
  );
  const braumReady = ready.pool.find((row) => row.champion === "Braum");
  assert.ok(braumReady.priority > braum.priority);
  assert.match(braumReady.reasons[0], /duo|Lucian|répond/);
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

test("a champion is not dumped on an open role when every usual lane is closed", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Dr. Mundo", "top", knowledge);
  session = applyAction(session, "Jinx", "bot", knowledge);
  session = applyAction(session, "Lulu", "sup", knowledge);
  assert.equal(currentStep(session).side, "blue");
  const advice = advise(session, knowledge, { limit: 8 });
  const ornn = advice.pool.find((row) => row.champion === "Ornn");
  assert.equal(session.picks.blue.top, "Dr. Mundo");
  assert.deepEqual(LANES.Ornn, ["top"]);
  assert.equal(ornn.playable, false);
  assert.equal(ornn.role, null);
  assert.equal(ornn.flex, false);
  assert.equal(ornn.score, null);
  assert.equal(advice.options.some((row) => row.champion === "Ornn"), false);
  assert.throws(() => applyAction(session, "Ornn", null, knowledge), /rôle/);
});

test("Elise stays a jungler and is not suggested as ADC once jungle is locked", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Lee Sin", "jng", knowledge);
  session = applyAction(session, "Viego", "jng", knowledge);
  assert.equal(currentStep(session).action, "pick");
  assert.equal(currentStep(session).side, "red");
  const advice = advise(session, knowledge, { limit: 400 });
  const elise = advice.pool.find((row) => row.champion === "Elise");
  assert.deepEqual(LANES.Elise, ["jng"]);
  assert.equal(elise.playable, false);
  assert.equal(elise.role, null);
  assert.equal(elise.flex, false);
  assert.equal(
    advice.options.some((row) => row.champion === "Elise" && row.role === "bot"),
    false,
  );
  assert.equal(
    advice.pool.some((row) => row.playable && row.champion === "Elise" && row.role === "bot"),
    false,
  );
  for (const row of advice.options) {
    assert.equal(row.playable, true);
    assert.ok((LANES[row.champion] || []).includes(row.role), `${row.champion} ${row.role}`);
  }
  assert.throws(() => applyAction(session, "Elise", null, knowledge), /rôle/);
  const forced = applyAction(session, "Elise", "bot", knowledge);
  assert.equal(forced.picks.red.bot, "Elise");
});
