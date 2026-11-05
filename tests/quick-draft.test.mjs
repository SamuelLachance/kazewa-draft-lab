import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compositionFromText, swapRoles } from "../src/quick-draft.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);

test("a comma list lands on the usual five roles", () => {
  const draft = compositionFromText("Sion, Maokai, Azir, Jinx, Lulu", knowledge);
  assert.deepEqual(draft.picks, {
    top: "Sion",
    jng: "Maokai",
    mid: "Azir",
    bot: "Jinx",
    sup: "Lulu",
  });
  assert.equal(draft.unknown.length, 0);
});

test("multi-word names, aliases and an unknown token stay distinct", () => {
  const draft = compositionFromText(
    "Lee Sin / Jarvan IV / monkey king / K'Sante / NotAChamp",
    knowledge,
  );
  assert.deepEqual(draft.champions, ["Lee Sin", "Jarvan IV", "Wukong", "K'Sante"]);
  assert.deepEqual(draft.unknown, ["NotAChamp"]);
  assert.equal(draft.picks.jng, "Lee Sin");
  assert.equal(draft.picks.top, "K'Sante");
});

test("a one-role support keeps support when a flex tank is also listed", () => {
  const draft = compositionFromText(
    "Nautilus Maokai Lee Sin Azir Jinx",
    knowledge,
  );
  assert.equal(draft.picks.sup, "Nautilus");
  assert.equal(draft.picks.jng, "Lee Sin");
  assert.equal(draft.picks.mid, "Azir");
  assert.equal(draft.picks.bot, "Jinx");
  assert.notEqual(draft.picks.top, "");
});

test("a short name and a one-letter swap still find Xin Zhao", () => {
  const short = compositionFromText("Xin", knowledge);
  assert.deepEqual(short.champions, ["Xin Zhao"]);
  assert.equal(short.picks.jng, "Xin Zhao");
  assert.equal(short.unknown.length, 0);
  const swapped = compositionFromText("Xin Zaho, Azir", knowledge);
  assert.deepEqual(swapped.champions, ["Xin Zhao", "Azir"]);
  assert.equal(swapped.unknown.length, 0);
  const spelled = compositionFromText("Xin Zhao", knowledge);
  assert.deepEqual(spelled.champions, ["Xin Zhao"]);
  const ambiguous = compositionFromText("Mal, NotAChamp", knowledge);
  assert.deepEqual(ambiguous.unknown, ["Mal", "NotAChamp"]);
  assert.equal(ambiguous.champions.length, 0);
});

test("swapping two roles exchanges the champions and leaves the others", () => {
  const picks = compositionFromText("Sion, Maokai, Azir, Jinx, Lulu", knowledge).picks;
  const swapped = swapRoles(picks, "top", "sup");
  assert.equal(swapped.top, "Lulu");
  assert.equal(swapped.sup, "Sion");
  assert.equal(swapped.jng, picks.jng);
  assert.equal(swapped.mid, picks.mid);
  assert.equal(swapped.bot, picks.bot);
  assert.equal(picks.top, "Sion");
  const same = swapRoles(picks, "mid", "mid");
  assert.equal(same.mid, "Azir");
  const moved = swapRoles({ ...picks, sup: "" }, "bot", "sup");
  assert.equal(moved.bot, "");
  assert.equal(moved.sup, "Jinx");
});

test("duplicates and a sixth champion are reported instead of entering the score", () => {
  const draft = compositionFromText(
    "Ahri, Ahri, Orianna, Syndra, Viktor, Zoe, Annie",
    knowledge,
  );
  assert.equal(draft.champions.length, 5);
  assert.deepEqual(draft.duplicates, ["Ahri"]);
  assert.deepEqual(draft.overflow, ["Annie"]);
  assert.equal(Object.values(draft.picks).filter(Boolean).length, 5);
});
