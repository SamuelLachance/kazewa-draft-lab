import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ROLES } from "../src/engine.mjs";
import { cardRelations } from "../src/relations.mjs";
import { indexMemory } from "../src/memory.mjs";
import { judgeDraft } from "../src/verdict.mjs";
import { rankBans, rankPicks, coachTables } from "../src/coach.mjs";
import { advise, applyAction, coachContext, createSession, currentStep, PLANS } from "../src/draft-coach.mjs";
import {
  METHOD_WEIGHTS,
  banNotes,
  composition,
  compositionStatus,
  indexMethod,
  pickNotes,
  shaneiReading,
  stepBrief,
} from "../src/method.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const [knowledge, memory, cards, data, method] = await Promise.all([
  load("knowledge.json"),
  load("memory-site.json"),
  load("champion-cards.json"),
  load("coach.json"),
  load("method.json"),
]);
const index = indexMethod(method);
const profiles = knowledge.champions;
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const empty = () => team(null, null, null, null, null);
const board = (blue = {}, red = {}) => ({ blue: { ...empty(), ...blue }, red: { ...empty(), ...red } });
const notes = (args) => pickNotes({ index, profiles, taken: new Set(), ...args });
const kinds = (list, kind) => list.filter((reason) => reason.kind === kind);
const total = (list, kind) => kinds(list, kind).reduce((sum, reason) => sum + reason.points, 0);

test("the method data covers every champion and only cites rules that exist", async () => {
  for (const name of Object.keys(knowledge.champions)) {
    const entry = method.champions[name];
    assert.ok(entry, `${name} has no entry`);
    assert.ok(["cited", "deduced"].includes(entry.basis));
    // A family he gives himself comes with the video where he gives it.
    if (entry.basis === "cited") assert.match(entry.source.video, /^[A-Za-z0-9_-]{11}$/);
    else assert.equal(entry.source, null);
    for (const role of entry.flexRoles) assert.ok(ROLES.includes(role));
  }
  for (const [id, rule] of Object.entries(method.rules)) {
    assert.match(id, /^(sp|sr|sf|kp)-\d+$/);
    assert.ok(["shanei", "kazewa"].includes(rule.coach));
    assert.equal(rule.coach === "kazewa", id.startsWith("kp-"), `${id} is filed under the wrong coach`);
    assert.match(rule.video, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(rule.text.length > 20);
    for (const name of rule.champions) assert.ok(knowledge.champions[name], `${id}: ${name}`);
  }
  for (const pair of method.pairs) {
    assert.ok(knowledge.champions[pair.a] && knowledge.champions[pair.b]);
    assert.ok(pair.origin === "course" ? pair.rule === null : method.rules[pair.rule], `${pair.a}+${pair.b}`);
  }
  for (const ban of method.bans) assert.ok(method.rules[ban.rule]);
  // Every rule id written in the code exists, under the coach the code names.
  for (const file of ["method.mjs"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    for (const id of new Set(source.match(/\b(?:sp|sr|sf|kp)-\d+\b/g))) assert.ok(method.rules[id], `${id} is cited in ${file} and missing`);
    // The uncertain rules the code may name: each is said hedged and without points.
    const hedged = new Set(["kp-8", "kp-9", "kp-15"]);
    for (const id of new Set(source.match(/\b(?:sp|sr|sf|kp)-\d+\b/g)))
      if (method.rules[id].uncertain) assert.ok(hedged.has(id), `${id} is uncertain and cited in ${file}`);
  }
});

test("the rules the grid leans on say what the code makes them say", () => {
  const says = (id, pattern) => assert.match(method.rules[id].text, pattern, id);
  says("sp-74", /tank/i);
  says("sp-75", /full AD|full AP/i);
  says("sp-0", /top/i);
  says("sp-3", /support/i);
  says("sp-7", /support/i);
  says("sp-6", /top/i);
  says("sf-29", /enchanteur/i);
  says("sf-45", /mid/i);
  says("sp-48", /Sylas/);
  says("sp-9", /enchanteur|pièces rares|support/i);
  says("sf-6", /poke|engage/i);
  says("kp-67", /immobile/i);
  says("kp-56", /scaling/i);
  assert.equal(method.rules["sp-74"].coach, "shanei");
  assert.equal(method.rules["kp-59"].coach, "kazewa");
});

test("a composition is read in one of his three families", () => {
  const hyper = composition(team("Ornn", "Sejuani", "Orianna", "Jinx", "Lulu"), index);
  assert.equal(hyper.family, "hypercarry");
  assert.equal(hyper.carry.name, "Jinx");
  assert.equal(hyper.core.enchanter.name, "Lulu");
  assert.equal(hyper.tank.name, "Sejuani");
  const poke = composition(team("Rumble", "Maokai", "Xerath", "Caitlyn", "Braum"), index);
  assert.equal(poke.family, "poke");
  assert.equal(poke.off.length, 0);
  const allIn = composition(team("Kennen", "Jarvan IV", "Orianna", "Miss Fortune", "Rell"), index);
  assert.equal(allIn.family, "all-in");
  assert.equal(allIn.sub, "all-in-wombo");
  // The top is not part of the block of four: it does not make the family.
  const split = composition(team("Fiora", "Maokai", "Xerath", "Caitlyn", "Braum"), index);
  assert.equal(split.family, "poke");
  // One pick says nothing; a hypercarry alone announces the family.
  assert.equal(composition({ ...empty(), jng: "Vi" }, index).family, null);
  assert.equal(composition({ ...empty(), bot: "Jinx" }, index).family, "hypercarry");
  // A plan wins over what the picks suggest.
  const planned = composition({ ...empty(), jng: "Vi", mid: "Ahri" }, index, "poke");
  assert.equal(planned.family, "poke");
  assert.equal(planned.basis, "plan");
});

test("Shanei's reading faults what he faults", () => {
  const has = (side, rule, kind = "fault") => side.items.some((item) => item.rule === rule && item.kind === kind);
  // No real tank among jungle, mid, ADC and support: the top does not count.
  const noTank = shaneiReading(
    { blue: team("Ornn", "Lee Sin", "Ahri", "Kai'Sa", "Rakan"), red: team("Renekton", "Sejuani", "Orianna", "Miss Fortune", "Rell") },
    index,
  );
  assert.ok(has(noTank.blue, "sp-74"));
  assert.ok(!has(noTank.red, "sp-74"));
  assert.equal(noTank.side, "red");
  // Full AP.
  const fullAp = shaneiReading(
    { blue: team("Rumble", "Lillia", "Viktor", "Ziggs", "Leona"), red: team("Renekton", "Sejuani", "Orianna", "Miss Fortune", "Rell") },
    index,
  );
  assert.ok(has(fullAp.blue, "sp-75"));
  // A hypercarry without its enchanter; an anti-synergy he names.
  const pieces = shaneiReading(
    { blue: team("Ornn", "Zac", "Viktor", "Jinx", "Nautilus"), red: team("Renekton", "Sejuani", "Orianna", "Miss Fortune", "Rell") },
    index,
  );
  assert.ok(has(pieces.blue, "sf-29"));
  assert.ok(has(pieces.blue, "sr-20"), "Viktor + Zac is an anti-synergy");
  assert.ok(has(pieces.red, "sf-80", "strength"), "Rell + Miss Fortune is a combo he names");
  // An ultimate offered to Sylas.
  const sylas = shaneiReading(
    { blue: team("Ornn", "Sejuani", "Galio", "Jinx", "Lulu"), red: team("Renekton", "Vi", "Sylas", "Miss Fortune", "Rell") },
    index,
  );
  assert.ok(has(sylas.blue, "sp-48"));
});

test("the reading follows the compositions, not the colour of the side", () => {
  const blue = team("Ornn", "Lee Sin", "Ahri", "Kai'Sa", "Rakan");
  const red = team("Renekton", "Sejuani", "Orianna", "Miss Fortune", "Rell");
  const straight = shaneiReading({ blue, red }, index);
  const mirrored = shaneiReading({ blue: red, red: blue }, index);
  assert.equal(straight.margin, -mirrored.margin);
  assert.deepEqual(straight.blue.items, mirrored.red.items);
  assert.equal(shaneiReading({ blue, red: { ...red, sup: null } }, index), null, "an unfinished draft is not read");
});

test("on shipped data every draft he judged gets a reading, each line with a rule", async () => {
  const full = await load("kazewa-memory.json");
  for (const item of full.cases) {
    const reading = shaneiReading({ blue: item.blue, red: item.red }, index);
    assert.ok(reading, item.id);
    for (const side of ["blue", "red"]) {
      assert.ok(reading[side].items.length > 0);
      for (const line of reading[side].items) {
        assert.ok(line.rule === null ? line.course : method.rules[line.rule], `${item.id}: ${line.text}`);
        assert.equal(line.rule ? method.rules[line.rule].coach : "shanei", "shanei", "Shanei's reading cites Shanei only");
        assert.ok(!/undefined|null|NaN/.test(line.text), line.text);
      }
    }
  }
});

test("the order of roles: ADC early, support before the top, top last", () => {
  // First pick of the draft.
  assert.ok(total(notes({ champion: "Camille", role: "top", side: "blue", picks: board(), slot: 1 }), "order") < 0);
  assert.ok(total(notes({ champion: "Caitlyn", role: "bot", side: "blue", picks: board(), slot: 1 }), "order") > 0);
  assert.ok(total(notes({ champion: "Rakan", role: "sup", side: "red", picks: board({ bot: "Caitlyn" }), slot: 2 }), "order") < 0);
  // A top he accepts to blind costs less than another one.
  const renekton = total(notes({ champion: "Renekton", role: "top", side: "red", picks: board({ bot: "Caitlyn" }), slot: 2 }), "order");
  const camille = total(notes({ champion: "Camille", role: "top", side: "red", picks: board({ bot: "Caitlyn" }), slot: 2 }), "order");
  assert.ok(camille < renekton && renekton < 0);
  // Fourth pick of red: the support, to keep the last pick for the top.
  const late = board({ top: "Ornn", jng: "Vi", bot: "Caitlyn" }, { jng: "Sejuani", mid: "Orianna", bot: "Jinx" });
  assert.ok(total(notes({ champion: "Lulu", role: "sup", side: "red", picks: late, slot: 7 }), "order") > 0);
  assert.ok(total(notes({ champion: "Camille", role: "top", side: "red", picks: late, slot: 7 }), "order") > 0, "their top is out: it can be countered");
  const unseen = board({ jng: "Vi", mid: "Ahri", bot: "Caitlyn" }, { jng: "Sejuani", mid: "Orianna", bot: "Jinx" });
  assert.ok(total(notes({ champion: "Camille", role: "top", side: "red", picks: unseen, slot: 7 }), "order") < 0, "top before the support");
  // Last pick of the draft: the top.
  const end = board({ jng: "Vi", mid: "Ahri", bot: "Caitlyn", sup: "Nautilus", top: "Ornn" }, { jng: "Sejuani", mid: "Orianna", bot: "Jinx", sup: "Lulu" });
  const last = notes({ champion: "Camille", role: "top", side: "red", picks: end, slot: 10 });
  assert.ok(total(last, "order") > 0);
  assert.ok(kinds(last, "order").some((reason) => reason.coach === "kazewa" && reason.rule === "kp-22"));
});

test("his first-pick lists and the picks he does not blind", () => {
  const first = (champion, role) => notes({ champion, role, side: "blue", picks: board(), slot: 1 });
  assert.ok(total(first("Caitlyn", "bot"), "first") > 0);
  assert.ok(total(first("Karma", "sup"), "first") > 0);
  assert.ok(total(first("Ezreal", "bot"), "first") < 0);
  // Kazewa's word on a first pick is his own line; an uncertain one scores nothing.
  assert.ok(first("Karma", "sup").some((reason) => reason.coach === "kazewa" && reason.points > 0));
  const cassio = first("Cassiopeia", "mid").find((reason) => reason.coach === "kazewa");
  assert.equal(cassio.points, 0);
  assert.equal(cassio.kind, "note");
  // Darius in the blind, then once their top is out.
  const blind = notes({ champion: "Darius", role: "top", side: "red", picks: board({ bot: "Caitlyn" }), slot: 3 });
  assert.ok(total(blind, "blind") < 0);
  const seen = notes({ champion: "Darius", role: "top", side: "red", picks: board({ top: "Ornn" }), slot: 3 });
  assert.equal(total(seen, "blind"), 0);
  // Sylas only late.
  assert.ok(total(notes({ champion: "Sylas", role: "mid", side: "blue", picks: board({ bot: "Caitlyn" }), slot: 4 }), "blind") < 0);
});

test("the family of the composition, the missing pieces and the duos", () => {
  // Jinx is locked: her enchanter is the rare piece, even early.
  const jinx = board({ bot: "Jinx" });
  const lulu = notes({ champion: "Lulu", role: "sup", side: "blue", picks: jinx, slot: 4 });
  assert.ok(total(lulu, "need") >= METHOD_WEIGHTS.rare);
  assert.equal(total(lulu, "order"), 0, "securing the enchanter is not blinding a support");
  // Without a plan, a family counts once three picks are locked.
  const two = board({ jng: "Jarvan IV", mid: "Orianna" });
  assert.equal(total(notes({ champion: "Ezreal", role: "bot", side: "blue", picks: two, slot: 5 }), "family"), 0);
  const three = board({ jng: "Jarvan IV", mid: "Orianna", sup: "Rell" });
  assert.ok(total(notes({ champion: "Ezreal", role: "bot", side: "blue", picks: three, slot: 8 }), "family") < 0);
  assert.ok(total(notes({ champion: "Miss Fortune", role: "bot", side: "blue", picks: three, slot: 8 }), "family") > 0);
  // With a plan, from the first pick.
  assert.ok(total(notes({ champion: "Xerath", role: "mid", side: "blue", picks: board(), slot: 1, plan: "poke" }), "family") > 0);
  assert.ok(total(notes({ champion: "Xerath", role: "mid", side: "blue", picks: board(), slot: 1, plan: "poke" }), "need") > 0, "the poke mid");
  // The plan is the reader's: it does not steer the other side.
  assert.equal(total(notes({ champion: "Xerath", role: "mid", side: "blue", picks: board(), slot: 1, plan: "poke", mine: false }), "family"), 0);
  // Duos: a combo he names, a duo of his course table, an anti-synergy.
  const combo = notes({ champion: "Miss Fortune", role: "bot", side: "blue", picks: board({ sup: "Rell" }), slot: 4 });
  assert.equal(total(combo, "combo"), METHOD_WEIGHTS.combo);
  assert.equal(kinds(combo, "combo")[0].rule, "sf-80");
  const anti = notes({ champion: "Zac", role: "jng", side: "blue", picks: board({ mid: "Viktor" }), slot: 4 });
  assert.ok(total(anti, "combo") < 0);
  // The tank of the block of four, once the jungler is not one.
  const noTank = board({ jng: "Nocturne", bot: "Caitlyn" });
  const braum = notes({ champion: "Braum", role: "sup", side: "blue", picks: noTank, slot: 5 });
  assert.ok(kinds(braum, "need").some((reason) => reason.rule === "sr-57" && reason.points > 0));
  // Never full AP.
  const ap = board({ top: "Rumble", jng: "Lillia", mid: "Viktor" });
  assert.ok(total(notes({ champion: "Ziggs", role: "bot", side: "blue", picks: ap, slot: 8 }), "build") < 0);
  assert.ok(total(notes({ champion: "Jinx", role: "bot", side: "blue", picks: ap, slot: 8 }), "build") > 0);
});

test("answers to what the opponent shows", () => {
  const vsSylas = board({}, { mid: "Sylas" });
  assert.ok(total(notes({ champion: "Galio", role: "mid", side: "blue", picks: vsSylas, slot: 4 }), "counter") < 0);
  const vsHyper = board({}, { bot: "Jinx", sup: "Lulu" });
  assert.ok(total(notes({ champion: "Draven", role: "bot", side: "blue", picks: vsHyper, slot: 4 }), "counter") > 0, "full early against a hypercarry");
  const vsPoke = board({}, { mid: "Xerath", bot: "Caitlyn", sup: "Karma" });
  assert.ok(total(notes({ champion: "Bard", role: "sup", side: "blue", picks: vsPoke, slot: 8 }), "counter") > 0);
});

test("a ban protects the composition and never removes one of its pieces", () => {
  const draven = board({ bot: "Draven" });
  const braum = banNotes({ champion: "Braum", side: "blue", picks: draven, index, profiles });
  assert.equal(braum[0].points, METHOD_WEIGHTS.banWith);
  assert.equal(braum[0].rule, "sp-50");
  // With a plan and no pick yet.
  const planned = banNotes({ champion: "Twisted Fate", side: "blue", picks: board(), plan: "hypercarry", index, profiles });
  assert.ok(planned[0].points > 0);
  assert.deepEqual(banNotes({ champion: "Twisted Fate", side: "blue", picks: board(), index, profiles }), []);
  // My Jinx still waits for an enchanter: banning Lulu removes my own piece.
  const own = banNotes({ champion: "Lulu", side: "blue", picks: board({ bot: "Jinx" }), index, profiles });
  assert.ok(own.some((reason) => reason.points < 0 && reason.rule === "sp-56"));
  // Their hypercarry: its enchanters are the ban.
  const theirs = banNotes({ champion: "Milio", side: "blue", picks: board({}, { bot: "Jinx", jng: "Sejuani", mid: "Orianna" }), index, profiles });
  assert.ok(theirs.some((reason) => reason.points > 0 && reason.rule === "sp-62"));
});

test("each step comes with the rules of both coaches", () => {
  let session = createSession("first");
  const seen = new Set();
  const context = coachContext({ knowledge, memory, relations: cardRelations(cards), data, method });
  for (let i = 0; i < 20; i++) {
    const advice = advise(session, context);
    assert.ok(advice.brief.length >= 2, `step ${i + 1}`);
    assert.ok(advice.brief.some((line) => line.coach === "shanei"));
    assert.ok(advice.brief.some((line) => line.coach === "kazewa"));
    for (const line of advice.brief) {
      assert.equal(method.rules[line.id].text, line.text);
      seen.add(line.id);
    }
    assert.ok(advice.status.blue && advice.status.red);
    session = applyAction(session, advice.options[0].champion, advice.options[0].role, context);
  }
  const end = advise(session, context);
  assert.ok(end.done);
  assert.ok(end.brief.some((line) => line.id === "sp-73"), "the final check");
  assert.ok(seen.size >= 15, "the brief changes with the step");
  assert.deepEqual(stepBrief(currentStep(createSession("first")), null), []);
});

test("a draft played on the first suggestion never says something it cannot source", () => {
  const context = coachContext({ knowledge, memory, relations: cardRelations(cards), data, method });
  for (const seat of ["first", "second"])
    for (const plan of [null, ...PLANS]) {
      let session = createSession(seat);
      for (let i = 0; i < 20; i++) {
        const advice = advise(session, context, { plan });
        const pick = advice.options[0];
        assert.ok(pick, `no suggestion at step ${i + 1} with plan ${plan}`);
        for (const option of [...advice.options, ...advice.answers])
          for (const reason of option.reasons) {
            assert.ok(!/undefined|NaN/.test(reason.text), reason.text);
            if (reason.rule) {
              const rule = method.rules[reason.rule];
              assert.ok(rule, reason.rule);
              // The coach named on the line is the coach of the rule, and an
              // uncertain rule never gives a point.
              assert.equal(rule.coach, reason.coach, `${reason.rule}: ${reason.text}`);
              if (rule.uncertain) assert.equal(reason.points, 0, `${reason.rule} is uncertain and scores`);
            }
            for (const id of reason.also ?? []) {
              assert.ok(method.rules[id], id);
              assert.equal(method.rules[id].uncertain, false, `${id} is uncertain and cited as support`);
            }
            // A scored line of the method cites a rule or a clause of his sheet.
            if (reason.coach === "shanei" && reason.points)
              assert.ok(reason.rule || reason.sources?.length || /table des combos/.test(reason.text), reason.text);
          }
        session = applyAction(session, pick.champion, pick.role, context, plan);
      }
      for (const side of ["blue", "red"]) assert.equal(ROLES.filter((role) => session.picks[side][role]).length, 5);
      // Once the draft is finished the plan no longer names the family: the
      // five picks do, as in Shanei's reading of the same draft.
      const end = advise(session, context, { plan });
      const own = seat === "first" ? "blue" : "red";
      assert.equal(end.status[own].basis === "plan", false);
      assert.equal(end.status[own].family, shaneiReading(session.picks, index)[own].family);
    }
});

test("the last pick that can bring a missing piece brings it", () => {
  const tables = coachTables(memory, cardRelations(cards));
  const shared = { tables, meta: data.meta, champions: Object.keys(knowledge.champions), profiles, method: index, bans: { blue: [], red: [] } };
  const first = (rows, role) => rows.find((row) => row.playable && !row.rare && row.role === role);
  // A poke plan: the mid is the one place for the poke mid.
  const poke = rankPicks({ ...shared, side: "blue", picks: board({ jng: "Maokai", bot: "Caitlyn", sup: "Karma" }, { jng: "Lee Sin", bot: "Lucian", sup: "Nautilus" }), slot: 8, plan: "poke" });
  const mid = first(poke, "mid");
  assert.ok(method.champions[mid.champion].poker || method.champions[mid.champion].families[0] === "disengage", `${mid.champion} is not a poke mid`);
  // No tank among jungle, mid and ADC: the support is the last place for it.
  const tank = rankPicks({ ...shared, side: "blue", picks: board({ jng: "Lee Sin", mid: "Ahri", bot: "Lucian" }, { jng: "Vi", mid: "Orianna", bot: "Jinx" }), slot: 8 });
  assert.ok(method.champions[first(tank, "sup").champion].tank, `${first(tank, "sup").champion} is not a tank`);
  // A hypercarry waits for its enchanter: the support is that enchanter.
  const carry = rankPicks({ ...shared, side: "blue", picks: board({ jng: "Sejuani", bot: "Jinx" }, { jng: "Vi", bot: "Lucian" }), slot: 5, plan: "hypercarry" });
  assert.ok(method.champions[first(carry, "sup").champion].hyper, `${first(carry, "sup").champion} is not his enchanter`);
});

test("the reader's plan is never shown to the other side, and never hides the picks", () => {
  const picks = board({ jng: "Jarvan IV", mid: "Orianna", sup: "Rell" });
  const counter = (plan) =>
    total(notes({ champion: "Morgana", role: "sup", side: "red", picks, slot: 6, plan, mine: false }), "counter");
  assert.ok(counter(null) > 0, "Morgana answers the all-in the picks show");
  assert.equal(counter("all-in"), counter(null));
  assert.equal(counter("poke"), counter(null));
  const poke = board({ mid: "Xerath", bot: "Ezreal", sup: "Karma" });
  const ban = (plan) => banNotes({ champion: "Azir", side: "red", picks: poke, plan, index, profiles, mine: false });
  assert.deepEqual(ban("poke"), ban(null));
  assert.ok(ban(null).some((reason) => reason.points > 0));
});

test("what the review of the method found stays fixed", () => {
  const pairOf = (a, b) => method.pairs.find((pair) => [pair.a, pair.b].sort().join("|") === [a, b].sort().join("|"));
  // He plays Ezreal with Xerath: not an anti-synergy. An empty duo is not a fault.
  assert.equal(pairOf("Ezreal", "Xerath"), undefined);
  assert.equal(pairOf("Xin Zhao", "Orianna").soft, true);
  assert.equal(pairOf("Bel'Veth", "Rakan").uncertain, true);
  const soft = shaneiReading({ blue: team("Ornn", "Xin Zhao", "Orianna", "Xayah", "Rakan"), red: team("Renekton", "Sejuani", "Viktor", "Miss Fortune", "Rell") }, index);
  assert.ok(!soft.blue.items.some((item) => item.kind === "fault" && ["sr-22", "sr-23"].includes(item.rule)));
  // An uncertain rule is said, hedged, never counted.
  const unsure = shaneiReading({ blue: team("Ornn", "Bel'Veth", "Galio", "Xayah", "Rakan"), red: team("Renekton", "Sejuani", "Viktor", "Miss Fortune", "Rell") }, index);
  const line = unsure.blue.items.find((item) => item.rule === "sf-37");
  assert.equal(line.kind, "remark");
  assert.equal(line.unsure, true);
  // A tank or an AP mid is a source of magic damage: not "full AD".
  const galio = shaneiReading({ blue: team("Gnar", "Xin Zhao", "Galio", "Varus", "Rell"), red: team("Renekton", "Sejuani", "Viktor", "Miss Fortune", "Rell") }, index);
  assert.ok(!galio.blue.items.some((item) => item.rule === "sp-75"));
  // Azir is the mid of the disengage half of the poke family.
  const azir = shaneiReading({ blue: team("Ornn", "Maokai", "Azir", "Caitlyn", "Braum"), red: team("Renekton", "Sejuani", "Viktor", "Miss Fortune", "Rell") }, index);
  assert.ok(!azir.blue.items.some((item) => item.rule === "sf-45"));
  // The no-tank exception is the one he gives, Kled included.
  const speed = shaneiReading({ blue: team("Renekton", "Hecarim", "Lissandra", "Sivir", "Karma"), red: team("Ornn", "Sejuani", "Viktor", "Miss Fortune", "Rell") }, index);
  assert.ok(speed.blue.items.some((item) => item.rule === "sp-74" && item.kind === "fault"));
  // A hypercarry alone among three all-in picks does not make the draft a hypercarry one.
  const lone = shaneiReading({ blue: team("Renekton", "Jarvan IV", "Orianna", "Aphelios", "Rell"), red: team("Ornn", "Sejuani", "Viktor", "Miss Fortune", "Nautilus") }, index);
  assert.equal(lone.blue.family, "all-in");
  // The real carry comes before an ADC that only becomes one next to an enchanter.
  const gwen = composition(team("Gwen", "Sejuani", "Orianna", "Sivir", "Lulu"), index);
  assert.equal(gwen.carry.name, "Gwen");
  assert.equal(method.champions.Sivir.carry, 0);
  // Malphite top is not a top he blinds.
  const malphite = notes({ champion: "Malphite", role: "top", side: "blue", picks: board({ bot: "Caitlyn" }), slot: 4 });
  assert.ok(!malphite.some((reason) => /sans trop de risque/.test(reason.text)));
  // A sentence about the other side's pick speaks to the reader.
  const theirs = notes({ champion: "Camille", role: "top", side: "red", picks: board({ top: "Ornn" }), slot: 3, mine: false });
  assert.ok(theirs.some((reason) => /Ton top est sorti/.test(reason.text)));
  // "He does not blind it" comes with his own words on blinding it, and their video.
  const jax = notes({ champion: "Jax", role: "top", side: "red", picks: board({ bot: "Caitlyn" }), slot: 3 }).find((reason) => reason.kind === "blind" && reason.coach === "shanei");
  assert.match(method.champions.Jax.blindSaid.text, /blind/);
  assert.ok(jax.text.endsWith(`${method.champions.Jax.blindSaid.text}.`));
  assert.match(jax.sources[0].video, /^[A-Za-z0-9_-]{11}$/);
  // That clause is about the top: it says nothing of Jax in the jungle.
  assert.ok(!notes({ champion: "Jax", role: "jng", side: "red", picks: board({ bot: "Caitlyn" }), slot: 3 }).some((reason) => reason.kind === "blind" && reason.coach === "shanei"));
  // He plays Zac in the jungle: nothing he says of him is credited to a support pick.
  const zac = notes({ champion: "Zac", role: "sup", side: "red", picks: board({}, { jng: "Lee Sin", mid: "Orianna", bot: "Lucian" }), slot: 7 });
  assert.ok(!zac.some((reason) => reason.points > 0 && ["family", "need", "combo"].includes(reason.kind)));
  // A ban of a combo partner the side can no longer pick is not "its own piece".
  const vi = banNotes({ champion: "Vi", side: "blue", picks: board({ jng: "Jarvan IV", mid: "Orianna", bot: "Ezreal" }), index, profiles, roles: ["jng"] });
  assert.ok(!vi.some((reason) => reason.rule === "sp-56"));
  // The texts carry no pointer to a numbered note.
  for (const [id, rule] of Object.entries(method.rules)) assert.ok(!/\bvid(?:éo)?s?\.? ?\d\d\b|\[\d+:\d\d/.test(rule.text), id);
  for (const entry of Object.values(method.champions)) assert.ok(!/\bvid(?:éo)?s?\.? ?\d\d\b/.test(entry.piece));
});

test("what the second review of the method found stays fixed", () => {
  const read = (blue, red = team("Renekton", "Sejuani", "Viktor", "Miss Fortune", "Rell")) => shaneiReading({ blue, red }, index);
  // Caitlyn next to Janna in a poke / disengage block is not a hypercarry; next to Lulu she is.
  const poke = read(team("K'Sante", "Trundle", "Azir", "Caitlyn", "Janna"), team("Renekton", "Vi", "Ahri", "Kai'Sa", "Nautilus"));
  assert.equal(poke.blue.family, "poke");
  assert.ok(!poke.red.items.some((item) => item.rule === "sf-59"));
  assert.equal(composition(team("Ornn", "Sejuani", "Orianna", "Caitlyn", "Lulu"), index).family, "hypercarry");
  // A disengage tag on a jungler and a tank support does not make a poke composition.
  assert.equal(composition({ ...empty(), jng: "Xin Zhao", bot: "Lucian", sup: "Braum" }, index).family, "all-in");
  // One block pick and a top: no family yet.
  assert.equal(composition({ ...empty(), top: "Darius", bot: "Caitlyn" }, index).family, null);
  // An ADC he first files under hypercarry announces it, even with a second family.
  assert.equal(composition({ ...empty(), bot: "Twitch" }, index).family, "hypercarry");
  // The enchanter of the core sits at support or in the jungle, and is one he accepts for that carry.
  assert.equal(composition(team("Ornn", "Sejuani", "Karma", "Jinx", "Nautilus"), index).core, null);
  assert.equal(composition(team("Ornn", "Sejuani", "Orianna", "Jinx", "Janna"), index).core, null);
  // The mid of a poke composition: a poker, or Azir. Not any disengage champion.
  const mid = (champion) => total(notes({ champion, role: "mid", side: "blue", picks: board(), slot: 1, plan: "poke" }), "need");
  assert.ok(mid("Xerath") > 0 && mid("Azir") > 0);
  assert.ok(mid("Morgana") < 0 && mid("Anivia") < 0);
  // Under a declared hypercarry plan, Karma is the enchanter of a Varus.
  const karma = notes({ champion: "Karma", role: "sup", side: "blue", picks: board({ jng: "Maokai", bot: "Varus" }), slot: 5, plan: "hypercarry" });
  assert.ok(total(karma, "need") > 0);
  // Milio + Varus is an anti-synergy in a poke composition, not in a hypercarry one.
  const milio = (plan) => total(notes({ champion: "Milio", role: "sup", side: "blue", picks: board({ jng: "Maokai", bot: "Varus" }), slot: 5, plan }), "combo");
  assert.ok(milio("poke") < 0);
  assert.equal(milio("hypercarry"), 0);
  // Varus + Karma is a bot-lane duo: not with Varus at the top.
  const varusTop = notes({ champion: "Varus", role: "top", side: "blue", picks: board({ bot: "Caitlyn", sup: "Karma" }), slot: 9 });
  assert.equal(total(varusTop, "combo"), 0);
  // An ultimate offered to a Sylas already locked costs as much as his statements can add up to.
  const galio = notes({ champion: "Galio", role: "mid", side: "red", picks: board({ mid: "Sylas" }), slot: 6 });
  assert.ok(total(galio, "counter") <= -METHOD_WEIGHTS.offPlan);
  // A top taken at the fourth blue pick is not blamed for its order: the fifth follows at once.
  assert.equal(total(notes({ champion: "Ambessa", role: "top", side: "blue", picks: board({ jng: "Maokai", mid: "Orianna", bot: "Varus" }), slot: 8 }), "order"), 0);
  // Malphite top in the blind: his sheet forbids it, and says so with its video.
  const malphite = notes({ champion: "Malphite", role: "top", side: "blue", picks: board({ bot: "Caitlyn" }), slot: 4 }).find((reason) => reason.kind === "blind");
  assert.ok(malphite.points < 0 && malphite.sources[0].video);
  // The pick that completes the one composition he lets go without a tank is not blamed for it.
  const speed = notes({ champion: "Karma", role: "sup", side: "blue", picks: board({ top: "Kled", jng: "Hecarim", mid: "Orianna", bot: "Sivir" }), slot: 9 });
  assert.ok(!speed.some((reason) => reason.rule === "sp-74" && reason.points < 0));
  // A family line never describes the champion in another family.
  for (const [champion, role, plan] of [["Lucian", "bot", "poke"], ["Taliyah", "mid", "all-in"], ["Xayah", "bot", "poke"], ["Zilean", "sup", "all-in"]])
    for (const reason of notes({ champion, role, side: "blue", picks: board(), slot: 4, plan }).filter((item) => item.kind === "family" && item.points > 0)) {
      const opens = (reason.text.match(/\(/g) ?? []).length;
      assert.equal(opens, (reason.text.match(/\)/g) ?? []).length, reason.text);
    }
  // On a finished draft the status box leaves nothing "to do".
  const done = compositionStatus(team("Renekton", "Vi", "Ahri", "Caitlyn", "Nautilus"), empty(), index, { profiles });
  assert.ok(!done.items.some((item) => item.state === "todo"), JSON.stringify(done.items));
  // The course table: every duo line is read, the one with a forgotten slash too.
  const pairOf = (a, b) => method.pairs.find((pair) => [pair.a, pair.b].sort().join("|") === [a, b].sort().join("|"));
  assert.equal(pairOf("Heimerdinger", "Maokai").origin, "course");
  assert.equal(pairOf("Heimerdinger", "Bard").origin, "course");
  assert.equal(pairOf("Braum", "Xin Zhao").origin, "course");
  // No rule text is left with a dangling pointer.
  for (const [id, rule] of Object.entries(method.rules)) assert.ok(!/\b(?:de la|comme la)\s*[,)]|\bvidéo [A-Za-z0-9_-]{11}\b/.test(rule.text), id);
});

test("a hypercarry plan brings the carry, then its enchanter", () => {
  const context = coachContext({ knowledge, memory, relations: cardRelations(cards), data, method });
  const tables = coachTables(memory, cardRelations(cards));
  const shared = { tables, meta: data.meta, champions: Object.keys(knowledge.champions), profiles, method: index, bans: { blue: [], red: [] } };
  const withPlan = rankPicks({ ...shared, side: "red", picks: board({ jng: "Maokai" }), slot: 2, plan: "hypercarry" });
  const without = rankPicks({ ...shared, side: "red", picks: board({ jng: "Maokai" }), slot: 2 });
  const place = (rows, name) => rows.findIndex((row) => row.champion === name);
  assert.ok(place(withPlan, "Jinx") < place(without, "Jinx"));
  const after = rankPicks({ ...shared, side: "red", picks: board({ jng: "Maokai" }, { bot: "Jinx" }), slot: 3, plan: "hypercarry" });
  assert.ok(place(after, "Lulu") < 5, "the enchanter comes right after the carry");
  // Bans of the plan: the globals he bans when he plays hypercarry move up.
  const bans = (plan) => rankBans({ ...shared, side: "red", picks: board(), plan });
  assert.ok(place(bans("hypercarry"), "Shen") < place(bans(null), "Shen"));
  assert.ok(context.method);
});

test("where a composition stands while it is drafted", () => {
  const status = compositionStatus({ ...empty(), jng: "Lee Sin", mid: "Ahri", bot: "Jinx" }, empty(), index, { profiles });
  assert.equal(status.family, "hypercarry");
  assert.ok(status.items.some((item) => item.rule === "sf-29" && item.state === "todo"));
  assert.ok(status.items.some((item) => item.rule === "sp-74" && item.state === "todo"));
  const done = compositionStatus(team("Ornn", "Lee Sin", "Ahri", "Jinx", "Rakan"), empty(), index, { profiles });
  assert.ok(done.items.some((item) => item.rule === "sp-74" && item.state === "bad"));
  assert.ok(done.items.some((item) => item.rule === "sf-29" && item.state === "bad"));
  assert.equal(compositionStatus(empty(), empty(), null), null);
});

test("Shanei's reading sits next to the verdict and never changes it", async () => {
  const full = await load("kazewa-memory.json");
  const lookup = { knowledge, memory: indexMemory(memory), relations: cardRelations(cards) };
  let read = 0;
  for (const item of full.cases.slice(0, 60)) {
    const draft = { blue: item.blue, red: item.red };
    const plain = judgeDraft(draft, lookup);
    const both = judgeDraft(draft, { ...lookup, method: index });
    assert.deepEqual(both.lean, plain.lean);
    assert.equal(plain.shanei, null);
    assert.ok(both.shanei);
    read++;
  }
  assert.equal(read, 60);
  const unfinished = judgeDraft({ blue: team("Ornn", "Vi", "Ahri", "Jinx", null), red: team("Gnar", "Sejuani", "Orianna", "Caitlyn", "Lulu") }, { ...lookup, method: index });
  assert.equal(unfinished.shanei, null);
});

test("the report says what the grid is worth and that the verdict does not use it", async () => {
  const [evaluation, model] = await Promise.all([load("evaluation.json"), load("model.json")]);
  const grid = evaluation.unseen.shaneiGrid;
  assert.equal(grid.usedForTheVerdict, false);
  assert.ok(grid.n > 200 && grid.n <= evaluation.memory.decided);
  assert.ok(grid.low <= grid.agreement && grid.agreement <= grid.high);
  // A second opinion, not a predictor: the interval holds one time in two.
  assert.ok(grid.low < 0.5 && grid.high > 0.5, "the site's wording assumes the grid is not a predictor: rewrite it if this changes");
  assert.equal(model.reliability.shanei.agreement, grid.agreement);
  if (grid.proGames) assert.ok(grid.proGames.n > 10000 && Math.abs(grid.proGames.agreement - 0.5) < 0.02);
});
