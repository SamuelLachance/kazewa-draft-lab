import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { bestPick, costOf, judgeDraft, stateOf } from "../src/draft-system/chooser.mjs";
import { buildLinks } from "../src/draft-system/links.mjs";
import { FUNCTIONS, teamVector, vectorOf } from "../src/draft-system/profile.mjs";
import { RULES, violations } from "../src/draft-system/rules.mjs";
import { LANES } from "../src/lanes.mjs";

const champions = JSON.parse(await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8")).champions;
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const names = (picks) => Object.values(picks).flatMap((side) => Object.values(side)).filter(Boolean);

test("the state knows what is locked, what is open, and what is banned", () => {
  const state = stateOf({ blue: team("Gnar", null, null, null, null), red: {} }, ["Ahri"]);
  assert.deepEqual(state.blue.names, ["Gnar"]);
  assert.deepEqual(state.blue.open, ["jng", "mid", "bot", "sup"]);
  assert.deepEqual(state.red.open, ["top", "jng", "mid", "bot", "sup"]);
  assert.ok(state.taken.has("Gnar") && state.taken.has("Ahri"));
});

test("a pick is always a free champion, in one of its own lanes, for an open role", () => {
  const picks = { blue: team("Gnar", null, null, null, null), red: team(null, "Xin Zhao", null, null, null) };
  const options = bestPick(picks, "blue", { champions, bans: ["Ahri"], limit: 8 });
  assert.ok(options.length > 0);
  const taken = new Set([...names(picks), "Ahri"]);
  for (const option of options) {
    assert.ok(!taken.has(option.champion), option.champion);
    const open = ["jng", "mid", "bot", "sup"];
    const lanes = LANES[option.champion].filter((role) => open.includes(role));
    assert.ok(lanes.length === 0 || lanes.includes(option.role), `${option.champion} is not played in ${option.role}`);
    assert.ok(open.includes(option.role), `${option.role} is an open role`);
    assert.notEqual(option.role, "top", "the open roles of blue exclude top");
  }
  assert.equal(new Set(options.map((o) => o.champion)).size, options.length, "one entry per champion");
});

test("the needs are adaptive: a disengage is rewarded only when the other team has an all-in to answer", () => {
  const allIn = { blue: {}, red: team("Malphite", "Vi", "Yasuo", "Jhin", "Leona") };
  const against = bestPick(allIn, "blue", { champions, limit: 200 });
  const pickedDisengage = against.find((o) => o.reasons.some((r) => r.rule === "disengage_against_engage"));
  const calm = bestPick({ blue: {}, red: team("Gwen", "Kayn", "Sylas", "Smolder", "Karma") }, "blue", { champions, limit: 200 });
  assert.ok(pickedDisengage, "a pick that answers the all-in exists");
  assert.ok(!calm.some((o) => o.reasons.some((r) => r.rule === "disengage_against_engage")), "no all-in, no answer needed");
});

test("the judgement of a finished draft is symmetric: swapping the sides swaps the verdict", () => {
  const blue = team("Jax", "Nocturne", "Orianna", "Draven", "Nautilus");
  const red = team("Gragas", "Skarner", "Ahri", "Jhin", "Leona");
  const straight = judgeDraft({ blue, red }, { champions });
  const swapped = judgeDraft({ blue: red, red: blue }, { champions });
  assert.equal(straight.score, -swapped.score);
  assert.ok(["blue", "red", "even"].includes(straight.side));
});

test("a rule is zero for a team whose state does not trigger it", () => {
  const none = vectorOf(null);
  for (const rule of Object.values(RULES)) assert.equal(rule.violation(none, none) >= 0, true);
  assert.equal(RULES.immobile_into_catch.violation(vectorOf(champions.Orianna), vectorOf(champions.Malphite)), 0);
});

test("the system reads the knowledge base only: no team, no player, no professional statistic", () => {
  const code = ["profile.mjs", "rules.mjs", "chooser.mjs"]
    .map((f) => readFileSync(new URL(`../src/draft-system/${f}`, import.meta.url), "utf8"))
    .map((text) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join("\n"))
    .join("\n");
  assert.ok(!/\bimport\b[^;]*(results|memory|coach|oe-|pro-)/i.test(code));
  assert.ok(!/\.teams?\b|\.players?\b|winner|\bmatch\b/i.test(code), "a team, player, winner or match in the code");
  assert.ok(FUNCTIONS.length === 18);
});

// The links of the knowledge base: families, duos and counters.
const method = JSON.parse(readFileSync(new URL("../data/method.json", import.meta.url), "utf8"));
const cards = JSON.parse(readFileSync(new URL("../data/champion-cards.json", import.meta.url), "utf8"));
const links = buildLinks({ method, cards });

test("the links come from the knowledge: families, duos, counters", () => {
  assert.ok(links.size.combos > 500 && links.size.counters > 1000);
  assert.equal(links.combo("Viktor", "Zac"), -1, "a bad duo he named");
  assert.ok(links.families("Gnar").has("all-in-wombo"));
});

test("a bad duo with a locked partner makes the pick worse, and only with that partner", () => {
  const withPartner = { blue: team(null, null, null, null, null), red: {} };
  withPartner.blue.mid = "Viktor";
  // The same links, where the duo of Viktor and Zac is not named: the only difference is that duo.
  const unnamed = { ...links, combo: (a, b) => ([a, b].sort().join("|") === "Viktor|Zac" ? 0 : links.combo(a, b)) };
  const plain = bestPick(withPartner, "blue", { champions, links: unnamed, limit: 1000 });
  const linked = bestPick(withPartner, "blue", { champions, links, limit: 1000 });
  const score = (list, name) => list.find((o) => o.champion === name).score;
  assert.ok(score(linked, "Zac") < score(plain, "Zac"), "Zac is a bad duo of Viktor");
  assert.ok(linked.find((o) => o.champion === "Zac").reasons.some((r) => r.rule === "combo" && r.with === "Viktor" && r.saved < 0));
});

test("a counter counts whatever the role: a champion is penalised by its counter in any role", () => {
  // A bad matchup written in the knowledge base, where a can only play the role of b: a is
  // bad against b in their lane, and b punishes a there.
  let pair = null;
  for (const a of Object.keys(LANES)) {
    for (const b of Object.keys(LANES)) {
      if (a !== b && links.counter(a, b) === -1 && LANES[a].length === 1 && LANES[a].includes(LANES[b][0])) {
        pair = { a, b, bRole: LANES[b][0] };
        break;
      }
    }
    if (pair) break;
  }
  assert.ok(pair, "the knowledge base names a bad matchup");
  const enemy = { blue: {}, red: { [pair.bRole]: pair.b } };
  const options = bestPick(enemy, "blue", { champions, links, limit: 1000 });
  const mine = options.find((o) => o.champion === pair.a);
  assert.ok(mine, `${pair.a} is a legal pick here`);
  assert.ok(mine.reasons.some((r) => r.rule === "counter" && r.with === pair.b && r.saved < 0), `${pair.b} punishes ${pair.a}`);
});

test("a pick that can fill several open roles keeps flexibility, and only while roles stay open", () => {
  const start = bestPick({ blue: {}, red: {} }, "blue", { champions, links, limit: 1000 });
  const flexible = start.find((o) => o.reasons.some((r) => r.rule === "flex"));
  assert.ok(flexible, "a flexible champion is valued at the start of the draft");
  const late = bestPick({ blue: team("Gnar", "Xin Zhao", "Viktor", "Draven", null), red: {} }, "blue", { champions, links, limit: 1000 });
  assert.ok(late.every((o) => !o.reasons.some((r) => r.rule === "flex")), "one role left: no flexibility to keep");
});

test("the blind pick is worth more for a champion that joins several families and plays several roles", () => {
  const options = bestPick({ blue: {}, red: {} }, "blue", { champions, links, limit: 1000 });
  const blind = (name) => options.find((o) => o.champion === name)?.reasons.find((r) => r.rule === "blind")?.saved ?? 0;
  const flexible = Object.keys(LANES).find((c) => links.families(c).size >= 2 && LANES[c].length >= 2);
  const single = Object.keys(LANES).find((c) => links.families(c).size === 1 && LANES[c].length === 1);
  assert.ok(flexible && single, "the knowledge has both kinds of champion");
  assert.ok(blind(flexible) > blind(single), `${flexible} gives more options than ${single}`);
});

test("after the other team answers, the team locks into one family: its champions are rewarded, the others pay unless they answer", () => {
  // Our blind pick: a champion of at least two families. Their answer: a champion they lock in mid.
  const blind = Object.keys(LANES).find((c) => links.families(c).size >= 2 && LANES[c].includes("top"));
  const answer = Object.keys(LANES).find((c) => c !== blind && LANES[c].includes("mid") && !links.families(c).size === false);
  assert.ok(blind && answer, "the knowledge has a blind pick and an answer");
  const picks = { blue: team(blind, null, null, null, null), red: team(null, null, answer, null, null) };
  const options = bestPick(picks, "blue", { champions, links, limit: 1000 });
  const locks = options.map((o) => o.reasons.find((r) => r.rule === "lock")).filter(Boolean);
  assert.ok(locks.length > 0, "a locked family is named after the blind pick");
  const family = locks[0].with;
  assert.ok(links.families(blind).has(family), "the lock is one of the blind pick's families");
  for (const option of options) {
    const lock = option.reasons.find((r) => r.rule === "lock");
    if (!lock) continue;
    assert.equal(lock.saved > 0, links.families(option.champion).has(family), `${option.champion} follows the lock`);
  }
});

test("a counter is role-free: Sylas answers Maokai whatever role Maokai plays", () => {
  assert.equal(links.counter("Sylas", "Maokai"), 1, "Sylas is good against Maokai in the knowledge base");
  for (const role of ["top", "jng", "sup"]) {
    const withMaokai = { blue: { [role]: "Maokai" }, red: {} };
    const sylas = bestPick(withMaokai, "red", { champions, links, limit: 1000 }).find((o) => o.champion === "Sylas");
    assert.ok(sylas, `Sylas is a legal answer when Maokai plays ${role}`);
    assert.ok(sylas.reasons.some((r) => r.rule === "counter" && r.with === "Maokai" && r.saved > 0), `Sylas counters Maokai in ${role}`);
  }
});

test("a champion the knowledge base does not name as good against Maokai is not an answer to it", () => {
  assert.ok(!(links.counter("Rumble", "Maokai") > 0), "Rumble is a duo of Maokai, not a counter");
  assert.equal(links.combo("Rumble", "Maokai"), 1, "Rumble and Maokai are a good duo");
  const options = bestPick({ blue: { jng: "Maokai" }, red: {} }, "red", { champions, links, limit: 1000 });
  const rumble = options.find((o) => o.champion === "Rumble");
  assert.ok(rumble, "Rumble stays a legal pick");
  assert.ok(!rumble.reasons.some((r) => r.rule === "counter" && r.with === "Maokai" && r.saved > 0), "no counter reason for Rumble");
});

test("the needs of the rules weigh less early in the draft, and all of them at the last pick", () => {
  const own = [{ name: "Gwen", role: "top" }];
  const enemy = [{ name: "Malphite", role: "top" }, { name: "Vi", role: "jng" }];
  const full = costOf(own, enemy, { champions, links }).total;
  const early = costOf(own, enemy, { champions, links, needsScale: 0.2 }).total;
  const rulesOnly = violations(teamVector(own.map((m) => m.name), champions), teamVector(enemy.map((m) => m.name), champions)).total;
  assert.ok(rulesOnly > 0, "Gwen alone lacks needs");
  assert.ok(Math.abs((full - early) - rulesOnly * 0.8) < 1e-9, "the needs are scaled, the counters and duos are not");
});

test("the blind pick is chosen on its families and roles, not on the needs of an empty draft", () => {
  const options = bestPick({ blue: {}, red: {} }, "blue", { champions, links, limit: 1000 });
  for (const option of options.slice(0, 5)) assert.ok(links.families(option.champion).size >= 2, `${option.champion} opens several families`);
});

test("a champion whose usual roles are all taken is still offered: the system guesses an open role for it", () => {
  // Xin Zhao takes the jungle and Morgana the support: Maokai plays neither, so it is guessed in an open role.
  const picks = { blue: team(null, "Xin Zhao", null, null, "Morgana"), red: {} };
  const maokai = bestPick(picks, "blue", { champions, links, limit: 1000 }).filter((o) => o.champion === "Maokai");
  assert.equal(maokai.length, 1, "one entry for Maokai");
  assert.ok(["top", "mid", "bot"].includes(maokai[0].role), `Maokai is guessed in an open role, not ${maokai[0].role}`);
});

test("a documented duo is worth taking: after Nocturne, its duo partners are near the top of the board", () => {
  assert.equal(links.strong("Nocturne", "Twisted Fate"), true, "a duo Shanei documents as a combo");
  const board = bestPick({ blue: team(null, "Nocturne", null, null, null), red: {} }, "blue", { champions, links, limit: 1000 });
  const rank = (name) => board.findIndex((o) => o.champion === name) + 1;
  assert.ok(rank("Twisted Fate") <= 20, `Twisted Fate is ${rank("Twisted Fate")}`);
  assert.ok(rank("Jhin") <= 10, `Jhin is ${rank("Jhin")}`);
});

test("a team of three with no documented duo pays for it, and a pick that makes one removes the cost", () => {
  const own = [{ name: "Nocturne", role: "jng" }, { name: "Gwen", role: "top" }, { name: "Sylas", role: "mid" }];
  assert.equal(links.strong("Nocturne", "Gwen"), false);
  assert.equal(links.strong("Nocturne", "Sylas"), false);
  const short = costOf(own, [], { champions, links, needsScale: 1 });
  assert.ok(short.parts.comboMissing > 0, "no documented duo in the team");
  const made = costOf([...own, { name: "Ashe", role: "bot" }], [], { champions, links, needsScale: 1 });
  assert.equal(links.strong("Ashe", "Nocturne"), true, "Ashe is a documented duo of Nocturne");
  assert.equal(made.parts.comboMissing, 0, "the duo removes the cost");
});

test("two immobile champions are not offered together while another pick is legal (kp-67)", () => {
  const options = bestPick({ blue: team(null, null, null, null, null), red: {} }, "blue", { champions, links, limit: 1000 });
  // Ashe is immobile: a second immobile champion beside it breaks the rule, so it is ranked after every pick that keeps it.
  const withAshe = bestPick({ blue: team(null, null, null, "Ashe", null), red: {} }, "blue", { champions, links, limit: 1000 });
  const immobile = (name) => (champions[name]?.immobile ?? 0) >= 2;
  assert.ok(options.length > 0 && withAshe.length > 0);
  assert.ok(!immobile(withAshe[0].champion), `the best pick beside Ashe is not immobile: ${withAshe[0].champion}`);
  const sound = withAshe.filter((o) => !immobile(o.champion));
  const broken = withAshe.filter((o) => immobile(o.champion));
  assert.ok(broken.every((o) => o.score < Math.min(...sound.map((s) => s.score))), "every immobile pick ranks below the sound ones");
});

test("a champion picked without a role gives its role to a pick that needs it, when it can take another free role", () => {
  for (const held of ["jng", "sup"]) {
    const only = Object.keys(LANES).find((n) => n !== "Maokai" && (LANES[n] ?? []).length === 1 && LANES[n][0] === held);
    assert.ok(only, `a champion played only in ${held}`);
    const picks = { blue: { [held]: "Maokai" }, red: {} };
    const options = bestPick(picks, "blue", { champions, links, flexRoles: { Maokai: ["jng", "sup"] }, limit: 1000 });
    const pick = options.find((o) => o.champion === only);
    assert.ok(pick, `${only} is offered`);
    assert.equal(pick.role, held, `${only} takes ${held}, Maokai moves to the other role`);
  }
});
