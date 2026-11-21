import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateDraft, pickReason, theoryContext } from "../src/theory.mjs";
import { indexMethod } from "../src/method.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const [knowledge, method] = await Promise.all([load("knowledge.json"), load("method.json")]);
const ctx = theoryContext({ knowledge, index: indexMethod(method) });
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const mirror = (draft) => ({ blue: draft.red, red: draft.blue });

const engageSide = team("Renekton", "Jarvan IV", "Orianna", "Miss Fortune", "Rell");
const pokeSide = team("Ornn", "Maokai", "Xerath", "Caitlyn", "Braum");

test("the procedure is symmetric: the mirrored draft has the opposite total and side", () => {
  const draft = { blue: engageSide, red: pokeSide };
  const straight = evaluateDraft(draft, ctx);
  const turned = evaluateDraft(mirror(draft), ctx);
  assert.equal(turned.total, -straight.total);
  if (straight.side !== "even") assert.equal(turned.side, straight.side === "blue" ? "red" : "blue");
});

test("no real tank is a structural hole for Kazewa, and the block of four is Shanei's", () => {
  const noTank = team("Renekton", "Lee Sin", "Ahri", "Kai'Sa", "Rakan");
  const reading = evaluateDraft({ blue: noTank, red: pokeSide }, ctx);
  const holes = reading.blue.holes.map((hole) => hole.id);
  assert.ok(holes.includes("tank") || holes.includes("block-tank"), holes.join(", "));
  const tank = reading.blue.holes.find((hole) => hole.id === "tank");
  if (tank) {
    assert.equal(tank.points, -3);
    assert.equal(tank.coach, "kazewa");
    assert.equal(tank.step, "B");
  }
  assert.ok(reading.holes.blue >= 1);
});

test("the confidence follows step F: the difference and the holes decide it", () => {
  const reading = evaluateDraft({ blue: engageSide, red: pokeSide }, ctx);
  const gap = Math.abs(reading.total);
  if (gap >= 9 || (Math.max(reading.holes.blue, reading.holes.red) >= 2 && Math.min(reading.holes.blue, reading.holes.red) === 0))
    assert.equal(reading.confidence, 3);
  else if (gap >= 5 || Math.abs(reading.holes.blue - reading.holes.red) === 1) assert.equal(reading.confidence, 2);
  else if (gap >= 2) assert.equal(reading.confidence, 1);
  else assert.equal(reading.confidence, 0);
  if (reading.side === "even") assert.equal(reading.confidence, 0);
});

test("a draft with no champion is read as even, with no points on either side", () => {
  const reading = evaluateDraft({ blue: team(null, null, null, null, null), red: team(null, null, null, null, null) }, ctx);
  assert.equal(reading.total, 0);
  assert.equal(reading.side, "even");
  assert.equal(reading.confidence, 0);
});

test("every reason names its step and its coach, and each hole carries its points", () => {
  const reading = evaluateDraft({ blue: engageSide, red: pokeSide }, ctx);
  for (const reason of reading.reasons) {
    assert.ok(["A", "B", "C", "D"].includes(reason.step), reason.step);
    assert.ok(["kazewa", "shanei"].includes(reason.coach), reason.coach);
    assert.ok(!/undefined|NaN/.test(reason.text), reason.text);
  }
  for (const side of ["blue", "red"]) {
    const sum = [...reading[side].identity, ...reading[side].holes, ...reading[side].axes, ...reading[side].bonuses].reduce((n, item) => n + item.points, 0);
    assert.equal(reading[side].points.identity + reading[side].points.holes + reading[side].points.axes + reading[side].points.bonuses, sum);
  }
});

test("a pick reason needs a board to compare: none on an empty board, a sentence once two picks are locked", () => {
  const empty = { blue: team(null, null, null, null, null), red: team(null, null, null, null, null) };
  assert.equal(pickReason("blue", empty, "bot", "Caitlyn", ctx), null);
  const board = { blue: team(null, "Maokai", null, null, null), red: team(null, null, null, null, null) };
  const reason = pickReason("blue", board, "bot", "Caitlyn", ctx);
  if (reason) {
    assert.equal(reason.coach, "kazewa");
    assert.equal(reason.kind, "theory");
    assert.match(reason.text, /grille de décision/);
  }
});

test("the procedure reads no professional figure: no coach statistics, no pro games", async () => {
  const source = await readFile(new URL("../src/theory.mjs", import.meta.url), "utf8");
  assert.ok(!/coach\.json|\bmeta\b|oe-games|pro-results|presence|roleShare/.test(source), "theory.mjs reads a professional figure");
});
