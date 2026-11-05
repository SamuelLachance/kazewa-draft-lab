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
import { analyzeDraft, scorePartial } from "../src/engine.mjs";
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

test("the top pick is the calculator's best champion on the role the draft rules chose", () => {
  let session = afterOpeningBans();
  session = applyAction(session, "Caitlyn", "bot");
  session = applyAction(session, "Jinx", "bot");
  session = applyAction(session, "Azir", "mid");
  const advice = advise(session, knowledge);
  assert.equal(currentStep(session).side, "blue");
  assert.equal(advice.options[0].role, "mid");
  assert.match(advice.note, /calculateur/);
  assert.match(advice.note, /draft complète/);
  const small = subsetKnowledge([
    "Caitlyn",
    "Jinx",
    "Elise",
    "Lee Sin",
    "Lulu",
    "Nautilus",
    "Azir",
    "Renekton",
    "Tristana",
    "Aatrox",
  ]);
  const late = play([
    ...OUTSIDERS.slice(0, 6).map((champion) => ({ champion, role: null })),
    { champion: "Caitlyn", role: "bot" },
    { champion: "Jinx", role: "bot" },
    { champion: "Elise", role: "jng" },
    { champion: "Lee Sin", role: "jng" },
    { champion: "Lulu", role: "sup" },
    { champion: "Nautilus", role: "sup" },
    ...OUTSIDERS.slice(6, 10).map((champion) => ({ champion, role: null })),
    { champion: "Azir", role: "mid" },
    { champion: "Renekton", role: "top" },
  ]);
  assert.equal(currentStep(late).side, "blue");
  const counter = advise(late, small, { limit: 10 });
  const tristana = counter.options.find((option) => option.champion === "Tristana");
  assert.equal(tristana.role, "mid");
  assert.match(tristana.reasons.join(" "), /Azir/);
  const finished = analyzeDraft(
    {
      blue: { ...late.picks.blue, mid: "Tristana" },
      red: { ...late.picks.red, top: "Aatrox" },
    },
    small,
  );
  assert.equal(finished.status, "complete");
  assert.equal(tristana.score, finished.score);
  assert.ok(
    finished.signals.some(
      (signal) => signal.id === "named_lane_counter" && signal.side === "blue",
    ),
  );
});

test("a documented partner raises the paired champion on the finished draft", () => {
  const reach = (mid) => {
    const small = subsetKnowledge([
      "Jinx",
      "Lee Sin",
      mid,
      "Lulu",
      "Caitlyn",
      "Elise",
      "Syndra",
      "Nautilus",
      "Camille",
      "Aatrox",
    ]);
    const session = play([
      ...OUTSIDERS.slice(0, 6).map((champion) => ({ champion, role: null })),
      { champion: "Jinx", role: "bot" },
      { champion: "Caitlyn", role: "bot" },
      { champion: "Elise", role: "jng" },
      { champion: "Lee Sin", role: "jng" },
      { champion: mid, role: "mid" },
      { champion: "Syndra", role: "mid" },
      ...OUTSIDERS.slice(6, 10).map((champion) => ({ champion, role: null })),
      { champion: "Nautilus", role: "sup" },
      { champion: "Lulu", role: "sup" },
    ]);
    return { session, small };
  };
  const withPartner = reach("Galio");
  const without = reach("Orianna");
  const camilleOf = (built) =>
    advise(built.session, built.small, { limit: 10 }).options.find(
      (option) => option.champion === "Camille",
    );
  const paired = camilleOf(withPartner);
  const alone = camilleOf(without);
  assert.ok(paired);
  assert.ok(alone);
  assert.ok(paired.score > alone.score);
  assert.match(paired.reasons.join(" "), /Galio/);
  const finished = analyzeDraft(
    {
      blue: { ...withPartner.session.picks.blue, top: "Camille" },
      red: { ...withPartner.session.picks.red, top: "Aatrox" },
    },
    withPartner.small,
  );
  assert.equal(finished.status, "complete");
  assert.equal(paired.score, finished.score);
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

function afterOpeningBans() {
  const bans = ["Bard", "Ivern", "Yuumi", "Nami", "Soraka", "Milio"];
  let session = createSession("first");
  let ban = 0;
  while (currentStep(session).action === "ban")
    session = applyAction(session, bans[ban++]);
  return session;
}

test("a clicked champion receives a role without a manual choice", () => {
  const opened = afterOpeningBans();
  const adc = applyAction(opened, "Caitlyn");
  assert.equal(adc.picks.blue.bot, "Caitlyn");
  const mid = applyAction(opened, "Azir");
  assert.equal(mid.picks.blue.mid, "Azir");
  assert.equal(mid.picks.blue.bot, null);
  const topBlind = applyAction(opened, "Renekton", "top");
  const answer = applyAction(topBlind, "Darius");
  assert.equal(answer.picks.red.top, "Darius");
  const flexBlind = applyAction(opened, "Sett", "top");
  const flex = applyAction(flexBlind, "Shen");
  assert.equal(flex.picks.red.top, "Shen");
  const elsewhere = applyAction(flexBlind, "Azir");
  assert.equal(elsewhere.picks.red.mid, "Azir");
  assert.equal(elsewhere.picks.red.top, null);
});

function subsetKnowledge(names) {
  return {
    ...knowledge,
    champions: Object.fromEntries(
      names.map((name) => [name, knowledge.champions[name]]),
    ),
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
  const draftOf = (pick, answer) => ({
    blue: { ...session.picks.blue, top: pick },
    red: { ...session.picks.red, top: answer },
  });
  const partialOf = (pick) =>
    scorePartial(
      { blue: { ...session.picks.blue, top: pick }, red: { ...session.picks.red } },
      small,
    ).score;
  const finishedOf = (pick, answer) => analyzeDraft(draftOf(pick, answer), small).score;
  const resistant = (pick) =>
    Math.min(...pool.filter((name) => name !== pick).map((answer) => finishedOf(pick, answer)));
  const cooperative = (pick) =>
    Math.max(...pool.filter((name) => name !== pick).map((answer) => finishedOf(pick, answer)));
  assert.ok(partialOf("Rumble") > partialOf("Aatrox"));
  assert.ok(resistant("Aatrox") > resistant("Rumble"));
  assert.ok(resistant("Aatrox") > resistant("Akali"));
  assert.ok(resistant("Aatrox") > resistant("Akshan"));
  assert.notEqual(cooperative("Aatrox"), resistant("Aatrox"));
  const advice = advise(session, small, { limit: 10 });
  assert.equal(advice.options[0].champion, "Aatrox");
  assert.equal(advice.options[0].role, "top");
  assert.equal(advice.options[0].score, resistant("Aatrox"));
  assert.notEqual(advice.options[0].score, cooperative("Aatrox"));
  for (const name of pool)
    assert.equal(advice.options.some((option) => option.champion === name), true);
});

test("a ban follows the resistant finished-score gain when the partial threat disagrees", () => {
  const pool = ["Alistar", "Amumu", "Annie", "Aatrox", "Ambessa"];
  const locked = ["Jinx", "Lee Sin", "Azir", "Caitlyn", "Elise", "Orianna"];
  const small = subsetKnowledge([...locked, ...pool]);
  const session = play([
    ...OUTSIDERS.slice(0, 6).map((champion) => ({ champion, role: null })),
    { champion: "Jinx", role: "bot" },
    { champion: "Caitlyn", role: "bot" },
    { champion: "Elise", role: "jng" },
    { champion: "Lee Sin", role: "jng" },
    { champion: "Azir", role: "mid" },
    { champion: "Orianna", role: "mid" },
    ...OUTSIDERS.slice(6, 9).map((champion) => ({ champion, role: null })),
  ]);
  assert.equal(currentStep(session).action, "ban");
  assert.equal(currentStep(session).side, "blue");
  const shell = {
    blue: { ...session.picks.blue },
    red: { ...session.picks.red },
  };
  const finished = (blueSup, blueTop, redSup, redTop) =>
    analyzeDraft(
      {
        blue: { ...shell.blue, sup: blueSup, top: blueTop },
        red: { ...shell.red, sup: redSup, top: redTop },
      },
      small,
    ).score;
  const pass = finished("Amumu", "Aatrox", "Alistar", "Ambessa");
  const gains = {
    Ambessa: finished("Amumu", "Aatrox", "Alistar", "Annie") - pass,
    Annie: finished("Amumu", "Aatrox", "Alistar", "Ambessa") - pass,
    Alistar: finished("Annie", "Aatrox", "Amumu", "Ambessa") - pass,
    Aatrox: finished("Amumu", "Ambessa", "Alistar", "Annie") - pass,
    Amumu: finished("Annie", "Aatrox", "Alistar", "Ambessa") - pass,
  };
  const bestBan = Object.entries(gains).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))[0];
  assert.equal(bestBan[0], "Ambessa");
  const threat = (champion) => {
    const baseline = scorePartial(shell, small).score;
    const lanes = (LANES[champion] || []).filter((role) => !shell.red[role]);
    let best = -Infinity;
    for (const role of lanes) {
      const draft = { blue: { ...shell.blue }, red: { ...shell.red, [role]: champion } };
      const gained = -(scorePartial(draft, small).score - baseline);
      if (gained > best) best = gained;
    }
    return best;
  };
  assert.ok(threat("Alistar") > threat("Ambessa"));
  const advice = advise(session, small, { limit: 10 });
  assert.equal(advice.options[0].champion, "Ambessa");
  assert.equal(advice.options[0].role, null);
  assert.equal(advice.options[0].score, gains.Ambessa);
  for (const name of pool)
    assert.equal(advice.options.some((option) => option.champion === name), true);
});

test("the drafter opens on ADC and closes blinds before the next role", () => {
  assert.equal(advise(afterOpeningBans(), knowledge).options[0].role, "bot");

  const topBlind = applyAction(afterOpeningBans(), "Renekton", "top");
  assert.equal(currentStep(topBlind).side, "red");
  assert.equal(advise(topBlind, knowledge).options[0].role, "top");

  const flexBlind = applyAction(afterOpeningBans(), "Sett", "top");
  const flex = advise(flexBlind, knowledge).options[0];
  assert.ok(LANES[flex.champion].includes("top"), flex.champion);
  assert.ok(LANES[flex.champion].includes("sup"), flex.champion);

  let session = applyAction(afterOpeningBans(), "Caitlyn", "bot");
  session = applyAction(session, "Jinx", "bot");
  const pairs = {
    jng: ["Lee Sin", "Viego"],
    mid: ["Azir", "Orianna"],
    sup: ["Thresh", "Nautilus"],
    top: ["Renekton", "Darius"],
  };
  const extraBans = ["Braum", "Rakan", "Leona", "Alistar"];
  let extraBan = 0;
  for (const role of ["jng", "mid", "sup", "top"]) {
    assert.equal(advise(session, knowledge).options[0].role, role, role);
    session = applyAction(session, pairs[role][0], role);
    assert.equal(advise(session, knowledge).options[0].role, role, `close ${role}`);
    session = applyAction(session, pairs[role][1], role);
    while (currentStep(session)?.action === "ban")
      session = applyAction(session, extraBans[extraBan++]);
  }
  assert.equal(currentStep(session), null);
});
