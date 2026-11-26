import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { bestPick, judgeDraft, stateOf } from "../src/draft-system/chooser.mjs";
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
    assert.ok(LANES[option.champion].includes(option.role), `${option.champion} is not played in ${option.role}`);
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
  const plain = bestPick(withPartner, "blue", { champions, links: buildLinks({}), limit: 1000 });
  const linked = bestPick(withPartner, "blue", { champions, links, limit: 1000 });
  const score = (list, name) => list.find((o) => o.champion === name).score;
  assert.ok(score(linked, "Zac") < score(plain, "Zac"), "Zac is a bad duo of Viktor");
  assert.ok(linked.find((o) => o.champion === "Zac").reasons.some((r) => r.rule === "combo" && r.with === "Viktor" && r.saved < 0));
});

test("a counter counts in the lane it faces: a champion played only in that role is penalised by its counter", () => {
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
