import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applicableArguments,
  championReads,
  fingerprint,
  indexMemory,
  precedents,
  recall,
} from "../src/memory.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const ROLES = ["top", "jng", "mid", "bot", "sup"];
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const swap = (draft) => ({ blue: draft.red, red: draft.blue });

const sample = {
  cases: [
    {
      id: "case_a",
      blue: team("Jax", "Nocturne", "Orianna", "Draven", "Nautilus"),
      red: team("Gragas", "Skarner", "Ahri", "Jhin", "Leona"),
      sides: "map",
      rosterVerified: true,
      later: { top: "red", jng: "red", mid: "blue", bot: "blue", sup: "red" },
      verdict: { side: "red", confidence: 2, timing: "draft", label: "Rouge devant" },
      reasons: ["Raison une", "Raison deux"],
      reads: [{ champion: "Gragas", side: "red", read: "Répond à Jax" }],
      claims: [
        {
          tag: "lane",
          favours: "red",
          champions: ["Gragas", "Jax"],
          role: "top",
          transferable: true,
          detail: "Gragas répond à Jax",
        },
        {
          tag: "synergy",
          favours: "blue",
          champions: ["Orianna", "Nocturne"],
          role: "",
          transferable: true,
          detail: "Orianna + Nocturne",
        },
      ],
      disagreements: [],
      winner: "red",
      match: { teams: { blue: "G2", red: "T1" }, date: "2024-10-11" },
      sources: [{ video: "-0iJco4hUdk", ts: 314 }],
    },
  ],
};
sample.cases[0].fingerprint = fingerprint(sample.cases[0]);

test("a fingerprint ignores which composition is called blue, but not the roles", () => {
  const draft = { blue: sample.cases[0].blue, red: sample.cases[0].red };
  assert.equal(fingerprint(draft), fingerprint(swap(draft)));
  const moved = {
    blue: { ...draft.blue, top: draft.blue.jng, jng: draft.blue.top },
    red: draft.red,
  };
  assert.notEqual(fingerprint(draft), fingerprint(moved));
});

test("a judged draft returns his verdict on the side that holds his preferred composition", () => {
  const index = indexMemory(sample);
  const draft = { blue: sample.cases[0].blue, red: sample.cases[0].red };
  const straight = recall(draft, index);
  assert.equal(straight.verdict.side, "red");
  assert.equal(straight.flipped, false);
  assert.equal(straight.teams.red, "T1");
  assert.equal(straight.reads[0].side, "red");

  const mirrored = recall(swap(draft), index);
  assert.equal(mirrored.verdict.side, "blue");
  assert.equal(mirrored.flipped, true);
  assert.equal(mirrored.teams.blue, "T1");
  assert.equal(mirrored.winner, "blue");
  assert.equal(mirrored.reads[0].side, "blue");
  assert.deepEqual(mirrored.later, {
    top: "blue",
    jng: "blue",
    mid: "red",
    bot: "red",
    sup: "blue",
  });
});

test("one different champion is no longer the draft he judged", () => {
  const index = indexMemory(sample);
  const draft = {
    blue: { ...sample.cases[0].blue, sup: "Thresh" },
    red: sample.cases[0].red,
  };
  assert.equal(recall(draft, index), null);
  assert.equal(recall({ blue: sample.cases[0].blue, red: {} }, index), null);
});

test("the closest judged draft is found in the orientation that fits", () => {
  const index = indexMemory(sample);
  const draft = {
    blue: { ...sample.cases[0].red },
    red: { ...sample.cases[0].blue, sup: "Thresh" },
  };
  const [first] = precedents(draft, index);
  assert.equal(first.id, "case_a");
  assert.equal(first.sharedChampions, 9);
  // His preferred composition (Gragas side) sits on blue in this draft.
  assert.equal(first.verdict.side, "blue");
  assert.deepEqual(first.sharedLanes, ["top", "jng", "mid", "bot"]);
  assert.deepEqual(precedents({ blue: team("Garen"), red: {} }, index), []);
});

test("an argument applies only when its champions keep the same relation and lane", () => {
  const index = indexMemory(sample);
  const base = {
    blue: team("Gragas", "Vi", "Syndra", "Kai'Sa", "Rell"),
    red: team("Jax", "Viego", "Azir", "Xayah", "Rakan"),
  };
  const found = applicableArguments(base, index);
  assert.equal(found.length, 1);
  assert.equal(found[0].tag, "lane");
  // Gragas is on blue here: the argument follows him.
  assert.equal(found[0].favours, "blue");
  assert.equal(found[0].sources[0].video, "-0iJco4hUdk");

  // Same two champions as allies: the matchup argument does not apply.
  const allies = {
    blue: team("Gragas", "Jax", "Syndra", "Kai'Sa", "Rell"),
    red: team("Ornn", "Viego", "Azir", "Xayah", "Rakan"),
  };
  assert.deepEqual(applicableArguments(allies, index), []);

  // Opponents, but not in the lane he was talking about.
  const offLane = {
    blue: team("Ornn", "Gragas", "Syndra", "Kai'Sa", "Rell"),
    red: team("Jax", "Viego", "Azir", "Xayah", "Rakan"),
  };
  assert.deepEqual(applicableArguments(offLane, index), []);

  // An ally pair he praised, on the other side this time.
  const duo = {
    blue: team("Ornn", "Vi", "Syndra", "Kai'Sa", "Rell"),
    red: team("Gnar", "Nocturne", "Orianna", "Xayah", "Rakan"),
  };
  const synergy = applicableArguments(duo, index);
  assert.equal(synergy.length, 1);
  assert.equal(synergy[0].favours, "red");
});

test("a draft's own arguments are not replayed as outside evidence", () => {
  const index = indexMemory(sample);
  const draft = { blue: sample.cases[0].blue, red: sample.cases[0].red };
  assert.deepEqual(applicableArguments(draft, index), []);
  assert.deepEqual(precedents(draft, index), []);
});

test("champion reads come back with their source", () => {
  const index = indexMemory(sample);
  const reads = championReads("Gragas", index);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].video, "-0iJco4hUdk");
  assert.deepEqual(championReads("Teemo", index), []);
});

test("the shipped memory is well formed and every case recalls itself both ways", async () => {
  const [memory, site, knowledge] = await Promise.all([
    load("kazewa-memory.json"),
    load("memory-site.json"),
    load("knowledge.json"),
  ]);
  assert.ok(memory.cases.length >= 250, "the memory lost cases");
  assert.equal(site.cases.length, memory.cases.length);
  const index = indexMemory(site);
  assert.equal(index.byFingerprint.size, site.cases.length, "duplicate drafts");
  const fullById = new Map(memory.cases.map((c) => [c.id, c]));
  for (const c of site.cases) {
    const full = fullById.get(c.id);
    assert.ok(full, `site case ${c.id} is not in the full memory`);
    assert.equal(c.verdict.side, full.verdict.side);
    assert.equal(c.fingerprint, fingerprint(c));
    const names = ["blue", "red"].flatMap((side) => ROLES.map((role) => c[side][role]));
    assert.equal(new Set(names).size, 10, `${c.id} repeats a champion`);
    for (const name of names)
      assert.ok(knowledge.champions[name], `${c.id}: unknown champion ${name}`);
    assert.ok(["blue", "red", "even"].includes(c.verdict.side));
    if (c.verdict.side !== "even") {
      assert.ok(["draft", "review", "late"].includes(c.verdict.timing));
      assert.ok(c.verdict.confidence >= 1 && c.verdict.confidence <= 3);
    }
    assert.ok(c.sources.length >= 1, `${c.id} has no source video`);
    if (c.later)
      for (const role of ROLES) assert.ok(["blue", "red"].includes(c.later[role]));
    for (const claim of c.claims) {
      assert.ok(["blue", "red"].includes(claim.favours));
      assert.ok(claim.champions.length >= 2);
      for (const name of claim.champions)
        assert.ok(names.includes(name), `${c.id}: argument about ${name}, not in the draft`);
    }
    const straight = recall({ blue: c.blue, red: c.red }, index);
    const mirrored = recall({ blue: c.red, red: c.blue }, index);
    assert.equal(straight.verdict.side, c.verdict.side);
    if (c.verdict.side !== "even")
      assert.notEqual(mirrored.verdict.side, c.verdict.side);
  }
});

test("every champion of the catalogue has a card, and the reviewed corrections are applied", async () => {
  const [cards, knowledge, overrides, memory] = await Promise.all([
    load("champion-cards.json"),
    load("knowledge.json"),
    load("memory-overrides.json"),
    load("kazewa-memory.json"),
  ]);
  for (const name of Object.keys(knowledge.champions)) {
    assert.ok(cards[name], `no card for ${name}`);
    assert.ok(cards[name].tag && cards[name].job, `empty card for ${name}`);
  }
  assert.equal(
    memory.audit.reviewedCorrections,
    Object.keys(overrides.records).length,
  );
});

test("a flex pick filed under another role is still the draft he judged", () => {
  const index = indexMemory(sample);
  const draft = {
    // Jax and Nocturne exchanged between top and jungle.
    blue: team("Nocturne", "Jax", "Orianna", "Draven", "Nautilus"),
    red: sample.cases[0].red,
  };
  const found = recall(draft, index);
  assert.equal(found.id, "case_a");
  assert.equal(found.rolesDiffer, true);
  assert.equal(found.verdict.side, "red");
  // The stored order is per lane: it does not carry over to other roles.
  assert.equal(found.later, null);
  // The roles returned are the ones of the real game.
  assert.equal(found.blue.top, "Jax");
  const mirrored = recall(swap(draft), index);
  assert.equal(mirrored.verdict.side, "blue");
  assert.equal(mirrored.flipped, true);
  // The judged draft is not listed as its own precedent or outside argument.
  assert.deepEqual(precedents(draft, index), []);
  assert.deepEqual(applicableArguments(draft, index), []);
});

test("an argument about the rest of a composition does not travel with two champions", () => {
  const withBroadClaims = structuredClone(sample);
  withBroadClaims.cases[0].claims = [
    {
      tag: "frontline",
      favours: "red",
      champions: ["Jax", "Nocturne"],
      role: "",
      transferable: true,
      detail: "Pas de frontline avec Jax et Nocturne",
    },
    {
      tag: "identity_clear",
      favours: "red",
      champions: ["Gragas", "Jax"],
      role: "",
      transferable: true,
      detail: "Plan clair contre plans mélangés",
    },
    {
      tag: "lane",
      favours: "red",
      champions: ["Gragas", "Skarner"],
      role: "top",
      transferable: true,
      detail: "Argument de lane qui ne nomme pas l'adversaire",
    },
  ];
  const index = indexMemory(withBroadClaims);
  const draft = {
    blue: team("Jax", "Nocturne", "Syndra", "Kai'Sa", "Rell"),
    red: team("Gragas", "Skarner", "Azir", "Xayah", "Rakan"),
  };
  assert.deepEqual(applicableArguments(draft, index), []);
});

test("a precedent that fits both orientations equally shows no side", () => {
  const index = indexMemory(sample);
  // Two champions of each stored team on each side: no orientation fits better.
  const draft = {
    blue: team("Jax", "Skarner", "Orianna", "Jhin", "Rell"),
    red: team("Gragas", "Nocturne", "Ahri", "Draven", "Rakan"),
  };
  assert.deepEqual(precedents(draft, index, { minimum: 1 }), []);
});
