import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { indexMemory } from "../src/memory.mjs";
import { playedGames, resultKey, shardOf } from "../src/results.mjs";
import { chooseReading, judgeDraft } from "../src/verdict.mjs";
import { loadResults } from "../scripts/evaluate.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));

const draft = {
  blue: { top: "Gnar", jng: "Vi", mid: "Azir", bot: "Jinx", sup: "Lulu" },
  red: { top: "Jax", jng: "Viego", mid: "Ahri", bot: "Kai'Sa", sup: "Nautilus" },
};
const mirrored = { blue: draft.red, red: draft.blue };

test("a draft has one results key, whatever the roles and the side order", () => {
  const straight = resultKey(draft);
  const other = resultKey(mirrored);
  assert.equal(straight.key, other.key);
  assert.notEqual(straight.first, other.first);
  const shuffled = {
    blue: { top: "Lulu", jng: "Gnar", mid: "Vi", bot: "Azir", sup: "Jinx" },
    red: draft.red,
  };
  assert.equal(resultKey(shuffled).key, straight.key);
  assert.match(straight.key, /^[0-9a-f]{13}$/);
  assert.equal(shardOf(straight.key), straight.key.slice(0, 2));
  assert.equal(resultKey({ blue: draft.blue, red: { ...draft.red, sup: null } }), null);
  const changed = { blue: { ...draft.blue, sup: "Milio" }, red: draft.red };
  assert.notEqual(resultKey(changed).key, straight.key);
});

test("the winner follows the composition, not the side it is entered on", () => {
  const { key, first } = resultKey(draft);
  const second = first === "blue" ? "red" : "blue";
  // Stored rows: first team, second team, winner index, date, league, game.
  const shard = { [key]: [["Alpha", "Beta", 1, "2025-03-01", "LEC", 2]] };
  const played = playedGames(draft, shard);
  assert.equal(played.side, second);
  // Team names are not kept: the game carries its winning side only.
  assert.equal("teams" in played.games[0], false);
  assert.equal(played.games[0].winner, second);
  // The same composition wins when the draft is entered the other way round.
  const flipped = playedGames(mirrored, shard);
  assert.equal(flipped.side, played.side === "blue" ? "red" : "blue");
  assert.equal(flipped.games[0].winner, flipped.side);
  assert.equal(playedGames(draft, {}), null);
  assert.equal(playedGames(draft, null), null);
  // Two games that went opposite ways: no side.
  const split = { [key]: [["Alpha", "Beta", 1, "2025-03-01", "LEC", 2], ["Alpha", "Beta", 0, "2025-04-01", "LEC", 1]] };
  assert.equal(playedGames(draft, split).side, "even");
  assert.deepEqual(playedGames(draft, split).wins, { blue: 1, red: 1 });
});

test("the result of a played game is measured first, but is never the estimate of a draft he did not judge", async () => {
  assert.deepEqual(
    chooseReading({ resultSide: "red", argumentSide: "blue", cardSide: "blue", calculatorSide: "blue" }),
    { basis: "result", side: "red" },
  );
  assert.equal(chooseReading({ argumentSide: "blue", cardSide: null, calculatorSide: null }).basis, "arguments");
  const [knowledge, memory] = await Promise.all([load("knowledge.json"), load("memory-site.json")]);
  const index = indexMemory(memory);
  const { key, first } = resultKey(draft);
  let calls = 0;
  const played = (value) => {
    calls++;
    return playedGames(value, { [key]: [["Alpha", "Beta", 0, "2025-03-01", "LEC", 1]] });
  };
  const unseen = judgeDraft(draft, { knowledge, memory: index, played });
  assert.equal(unseen.source, "unseen");
  // The result of the game is a fact shown with the draft: it is not the verdict.
  assert.notEqual(unseen.lean.basis, "result");
  assert.equal(unseen.played.games.length, 1);
  assert.equal(calls, 1);
  // Without a results lookup the same draft falls back to the other readings.
  assert.notEqual(judgeDraft(draft, { knowledge, memory: index }).lean.basis, "result");
  // Two games that went opposite ways: the result says nothing, the other
  // readings answer exactly as if there were no result.
  const splitShard = { [key]: [["Alpha", "Beta", 0, "2025-03-01", "LEC", 1], ["Alpha", "Beta", 1, "2025-03-02", "LEC", 2]] };
  const split = judgeDraft(draft, { knowledge, memory: index, played: (value) => playedGames(value, splitShard) });
  assert.equal(split.played.side, "even");
  assert.deepEqual(split.lean, judgeDraft(draft, { knowledge, memory: index }).lean);
  // The lookup is made with the catalogue names, however the draft was typed.
  const typed = {
    blue: { top: "gnar", jng: "vi", mid: "azir", bot: "jinx", sup: "lulu" },
    red: { top: "jax", jng: "viego", mid: "ahri", bot: "kaisa", sup: "nautilus" },
  };
  assert.deepEqual(judgeDraft(typed, { knowledge, memory: index, played }).lean, unseen.lean);
  // The source's placeholder is not a team name.
  const nameless = playedGames(draft, { [key]: [["unknown team", "Beta", 0, "2025-03-01", "LEC", 1]] });
  assert.equal("teams" in nameless.games[0], false);
  // A draft he commented without choosing stays his: no result is looked up.
  const torn = memory.cases.find((item) => item.verdict.side === "even");
  calls = 0;
  const undecided = judgeDraft({ blue: torn.blue, red: torn.red }, { knowledge, memory: index, played });
  assert.equal(undecided.lean.basis, "undecided");
  assert.equal(calls, 0);
  // A draft he judged: his verdict, and the results are not even looked up.
  const judged = memory.cases.find((item) => item.verdict.side !== "even");
  calls = 0;
  const known = judgeDraft({ blue: judged.blue, red: judged.red }, { knowledge, memory: index, played });
  assert.equal(known.lean.basis, "memory");
  assert.equal(known.played, null);
  assert.equal(calls, 0);
});

test("the shipped results hold every verified game of the memory, with its winner", async () => {
  const [memory, index] = await Promise.all([
    load("kazewa-memory.json"),
    load("pro-results/index.json"),
  ]);
  const dir = new URL("../data/pro-results/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => /^[0-9a-f]{2}\.json$/.test(name));
  assert.equal(files.length, index.files);
  let games = 0;
  let pairs = 0;
  for (const name of files) {
    const shard = JSON.parse(await readFile(new URL(name, dir), "utf8"));
    for (const [key, rows] of Object.entries(shard)) {
      assert.equal(shardOf(key), name.slice(0, 2));
      pairs++;
      games += rows.length;
      for (const row of rows) {
        assert.ok(row[2] === 0 || row[2] === 1);
        assert.notEqual(String(row[0]).toLowerCase(), "unknown team");
        assert.notEqual(String(row[1]).toLowerCase(), "unknown team");
      }
      // One game is stored once, even when the source has it under two ids. Team names are
      // not published, so a game is identified by its winner, date, league and number.
      const identities = rows.map((row) => JSON.stringify([row[2], row[3], row[4], row[5]]));
      // One source record of an NLC game sits under two team labels (both rows were
      // published with their names before). It is kept as it was: one extra row.
      if (key === "c1c8f8860687d") assert.equal(identities.length - new Set(identities).size, 1, key);
      else assert.equal(new Set(identities).size, identities.length, key);
    }
  }
  assert.equal(games, index.games);
  assert.equal(pairs, index.rosterPairs);
  assert.match(index.source, /Oracle's Elixir/);

  const played = loadResults();
  const verified = memory.cases.filter((item) => item.match?.gameId && item.winnerSource === "match_data");
  assert.ok(verified.length >= 280);
  for (const item of verified) {
    const found = played({ blue: item.blue, red: item.red });
    assert.ok(found, `absent des résultats : ${item.id}`);
    const same = found.games.find((game) => game.date === item.match.date && game.game === item.match.game);
    assert.ok(same, `partie introuvable : ${item.id}`);
    assert.equal(same.winner, item.winner, item.id);
    assert.equal("teams" in same, false, item.id);
  }
});

test("the report measures the result reading and keeps it apart from a draft never played", async () => {
  const [evaluation, model] = await Promise.all([load("evaluation.json"), load("model.json")]);
  const won = evaluation.unseen.matchResult;
  assert.ok(won.n >= 250 && won.n <= evaluation.memory.decided);
  assert.equal(won.draftTiming.n + won.afterTheGame.n, won.n);
  assert.ok(won.low <= won.agreement && won.agreement <= won.high);
  assert.equal(model.reliability.result.agreement, won.agreement);
  assert.equal(model.reliability.result.n, won.n);
  assert.equal(model.reliability.result.draftTiming.agreement, won.draftTiming.agreement);
  const opposed = won.withArguments.oppositeSides;
  assert.ok(opposed.n > 0 && opposed.resultRight <= opposed.n);
  // The never-played chain does not use the result; the played chain does.
  const every = evaluation.unseen.everyDraft;
  assert.equal(every.heldOut.byReading.result, undefined);
  assert.ok(every.played.heldOut.byReading.result.n > 0);
  // Both chains see the same drafts; the played one answers the ones with no estimate too.
  assert.equal(
    every.played.heldOut.all.n + every.played.heldOut.unanswered.n,
    every.heldOut.all.n + every.heldOut.unanswered.n,
  );
  assert.ok(every.played.heldOut.all.n >= every.heldOut.all.n);
  assert.equal(model.reliability.everyDraftPlayed.agreement, every.played.heldOut.all.agreement);
  assert.equal(model.reliability.everyDraft.agreement, every.heldOut.all.agreement);
});
