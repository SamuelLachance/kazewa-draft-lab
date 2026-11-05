import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compositionFromText } from "../src/quick-draft.mjs";

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
