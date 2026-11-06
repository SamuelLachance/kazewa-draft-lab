import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeDraft } from "../src/engine.mjs";
import {
  emptyDraft,
  validateEndpoint,
  draftFromHash,
  buildDraftHash,
  validateClientSnapshot,
  getLiveReadiness,
  displayedVerdict,
} from "../src/presentation.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"),
);

const now = Date.parse("2026-10-29T17:00:00Z");
const match = () => ({
  id: "test-1",
  status: "draft",
  rolesConfirmed: true,
  observedAt: new Date(now).toISOString(),
  blue: {
    name: "A",
    picks: {
      top: "Sion",
      jng: "Maokai",
      mid: "Azir",
      bot: "Jinx",
      sup: "Lulu",
    },
  },
  red: {
    name: "B",
    picks: {
      top: "Jayce",
      jng: "Nidalee",
      mid: "LeBlanc",
      bot: "Jhin",
      sup: "Pyke",
    },
  },
});
const snapshot = () => ({
  version: 1,
  status: "ok",
  capabilities: { draftPhase: true },
  matches: [match()],
});

test("shared drafts round-trip punctuation and strip unrelated metadata", () => {
  const draft = emptyDraft();
  draft.blue.top = "K'Sante";
  draft.red.sup = "Nunu & Willump";
  const result = draftFromHash(
    buildDraftHash({ ...draft, result: "blue", team: "famous" }),
  );
  assert.deepEqual(result, draft);
  assert.equal(result.result, undefined);
  assert.equal(draftFromHash("#draft=%7Bbroken"), null);
});
test("a final live verdict requires fresh ten picks and confirmed roles", () => {
  const s = snapshot(),
    m = s.matches[0];
  assert.equal(getLiveReadiness(s, m, { now }).ready, true);
  m.rolesConfirmed = false;
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  m.rolesConfirmed = true;
  m.blue.picks.top = null;
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
});
test("fresh fetch timestamps cannot revive stale observations", () => {
  const s = snapshot(),
    m = s.matches[0];
  s.fetchedAt = new Date(now).toISOString();
  m.observedAt = new Date(now - 100000).toISOString();
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  m.observedAt = new Date(now + 61000).toISOString();
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  m.observedAt = null;
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
});
test("a globally stale or invalid snapshot cannot contradict its suspended live verdict", () => {
  const s = snapshot(),
    m = s.matches[0];
  s.stale = true;
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  s.stale = false;
  s.observedAt = new Date(now - 100000).toISOString();
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  s.observedAt = "invalid";
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  s.observedAt = new Date(now).toISOString();
  assert.equal(getLiveReadiness(s, m, { now }).ready, true);
});
test("finished, unavailable and unguaranteed draft feeds cannot generate live calls", () => {
  const s = snapshot(),
    m = s.matches[0];
  s.capabilities.draftPhase = false;
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  m.status = "in_game";
  assert.equal(getLiveReadiness(s, m, { now }).ready, true);
  m.status = "finished";
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
  s.status = "unavailable";
  m.status = "in_game";
  assert.equal(getLiveReadiness(s, m, { now }).ready, false);
});
test("client validates shape and rejects duplicate match ids and non-string picks", () => {
  assert.equal(validateClientSnapshot(snapshot()).matches.length, 1);
  const s = snapshot();
  s.matches.push(match());
  assert.throws(() => validateClientSnapshot(s));
  s.matches.pop();
  s.matches[0].blue.picks.top = { champion: "Sion" };
  assert.throws(() => validateClientSnapshot(s));
});
test("browser configuration cannot place credentials or tokens in URLs", () => {
  assert.equal(
    validateEndpoint("https://feed.example/api/live"),
    "https://feed.example/api/live",
  );
  assert.equal(
    validateEndpoint("http://localhost:4173/api/live"),
    "http://localhost:4173/api/live",
  );
  for (const value of [
    "javascript:alert(1)",
    "http://public.example/api/live",
    "https://user:secret@feed.example/api/live",
    "https://feed.example/api/live?token=secret",
    "https://feed.example/api/live#secret",
  ])
    assert.throws(() => validateEndpoint(value));
  assert.throws(() =>
    validateEndpoint({ url: "https://feed.example/api/live" }),
  );
});

const EXAMPLE = {
  blue: { top: "Sion", jng: "Maokai", mid: "Azir", bot: "Jinx", sup: "Lulu" },
  red: { top: "Jayce", jng: "Nidalee", mid: "LeBlanc", bot: "Jhin", sup: "Pyke" },
};

test("the displayed winner is the signed sum of the calculator signals", () => {
  const result = analyzeDraft(EXAMPLE, knowledge);
  const shown = displayedVerdict(result);
  const sum = result.signals.reduce(
    (total, signal) => total + (signal.side === "blue" ? 1 : -1) * signal.weight,
    0,
  );
  assert.equal(shown.winner, result.winner);
  assert.equal(shown.score, result.score);
  assert.equal(shown.score, sum);
  assert.equal(shown.winner, "blue");
  assert.ok(shown.score > 0);
  const flipped = displayedVerdict(
    analyzeDraft({ blue: EXAMPLE.red, red: EXAMPLE.blue }, knowledge),
  );
  assert.equal(flipped.winner, "red");
  assert.equal(flipped.score, -shown.score);
});

test("a stale winner field cannot override the signal sum", () => {
  const shown = displayedVerdict({
    status: "complete",
    winner: "blue",
    score: 4,
    signals: [
      { side: "red", weight: 2 },
      { side: "blue", weight: 0.5 },
    ],
  });
  assert.equal(shown.winner, "red");
  assert.equal(shown.score, -1.5);
  assert.equal(shown.confidence, "faible");
  assert.equal(displayedVerdict({ status: "incomplete", winner: "blue", score: 9, signals: [] }), null);
});
