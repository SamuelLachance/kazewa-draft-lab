import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DRAFT_VALUE_WEIGHT, draftValueReason, draftValueShift } from "../src/draft-value.mjs";
import { WEIGHTS, coachTables, rankPicks } from "../src/coach.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const empty = () => ({ blue: team(null, null, null, null, null), red: team(null, null, null, null, null) });
const noBans = () => ({ blue: [], red: [] });

// A value table written for the tests: Jax is worth +0.6 logit blue-side in each role.
const values = {
  heldOut: { accuracy: 0.543 },
  values: Object.fromEntries(["top", "jng", "mid", "bot", "sup"].map((role) => [role, { Jax: 0.6, Gnar: -0.6 }])),
};

test("a champion's value favours the side that holds it and counts against the other", () => {
  const blue = draftValueShift(values, { side: "blue", role: "top", champion: "Jax" });
  const red = draftValueShift(values, { side: "red", role: "top", champion: "Jax" });
  assert.ok(blue > 0);
  assert.ok(red < 0);
  assert.ok(Math.abs(blue + red) < 1e-9, "the two sides are symmetric around 50 %");
  assert.ok(draftValueShift(values, { side: "blue", role: "top", champion: "Gnar" }) < 0);
});

test("no value means no reason: an unknown champion or role is not guessed", () => {
  assert.equal(draftValueShift(values, { side: "blue", role: "top", champion: "Nobody" }), null);
  assert.equal(draftValueShift(values, { side: "blue", role: "flex", champion: "Jax" }), null);
  assert.equal(draftValueShift(null, { side: "blue", role: "top", champion: "Jax" }), null);
  assert.equal(draftValueReason(values, { side: "blue", role: "top", champion: "Nobody" }), null);
});

test("the reason is labelled as professional, says it reads the composition alone, and carries its measured weight", () => {
  const reason = draftValueReason(values, { side: "blue", role: "top", champion: "Jax" });
  assert.equal(reason.kind, "draftvalue");
  assert.equal(reason.coach, "pro");
  assert.ok(reason.points > 0);
  assert.equal(reason.points, Math.round(draftValueShift(values, { side: "blue", role: "top", champion: "Jax" }) * DRAFT_VALUE_WEIGHT * 100) / 100);
  assert.match(reason.text, /composition seule/);
  assert.match(reason.text, /54,3 %/);
  assert.match(reason.text, /Jax en top/);
  const red = draftValueReason(values, { side: "red", role: "top", champion: "Jax" });
  assert.ok(red.points < 0);
});

test("the coach adds the value to a candidate, and not without it", () => {
  const tables = coachTables({ cases: [] }, null);
  const base = { side: "blue", picks: empty(), bans: noBans(), slot: 1, tables, champions: ["Jax"] };
  const without = rankPicks(base).find((row) => row.champion === "Jax");
  assert.ok(!without.reasons.some((reason) => reason.kind === "draftvalue"));
  const withValue = rankPicks({ ...base, draftValues: values }).find((row) => row.champion === "Jax");
  const reason = withValue.reasons.find((item) => item.kind === "draftvalue");
  assert.ok(reason, "a draftvalue reason is added");
  assert.ok(reason.points > 0);
  assert.equal(withValue.score, Math.round((without.score + reason.points) * 100) / 100);
  assert.equal(WEIGHTS.draftValue, DRAFT_VALUE_WEIGHT);
});

test("the shipped values are the composition-only model, with no team and no player in them", async () => {
  const shipped = await load("draft-values.json");
  const roles = ["top", "jng", "mid", "bot", "sup"];
  for (const role of roles) assert.ok(Object.keys(shipped.values[role]).length >= 100, role);
  assert.equal(shipped.trainedUntil, "2026-11-22");
  assert.equal(shipped.heldOut.n, 19979);
  assert.ok(shipped.heldOut.accuracy > 0.5 && shipped.heldOut.accuracy < 0.56);
  const text = readFileSync(new URL("../data/draft-values.json", import.meta.url), "utf8");
  assert.ok(!/"teams"|"players"|"team"|"player"|"mid_team"/.test(text), "a team or a player key in the values");
  assert.ok(!/"gameid"|"winner"|"date"/.test(text), "game rows in the values");
});

test("the value module reads nothing but the values it is given", () => {
  const code = readFileSync(new URL("../src/draft-value.mjs", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
    .join("\n");
  assert.ok(!/\bimport\b/.test(code), "no import: nothing outside the values");
  assert.ok(!/\bteams?\b|\bplayers?\b|\bmatch\b|\bmeta\b/i.test(code), "a team, player, match or meta name in the code");
});

test("the published professional results carry no team name, and the script that writes them writes none", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../data/pro-results/", import.meta.url);
  const shards = readdirSync(dir).filter((name) => /^[0-9a-f]{2}\.json$/.test(name));
  assert.ok(shards.length >= 200, `only ${shards.length} shards`);
  let rows = 0;
  for (const name of shards) {
    const shard = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    for (const list of Object.values(shard))
      for (const row of list) {
        rows += 1;
        assert.equal(row[0], null, `${name}: a team name in the first column`);
        assert.equal(row[1], null, `${name}: a team name in the second column`);
      }
  }
  assert.ok(rows > 70000, `only ${rows} rows`);
  const writer = readFileSync(new URL("../scripts/build-pro-results.mjs", import.meta.url), "utf8");
  assert.ok(!/team\(game\.teams/.test(writer), "the writer still reads team names");
});

test("the published texts carry no team or player name of the professional data", async (t) => {
  const { loadNames, buildPattern, KEEP_KEYS } = await import("../scripts/redact-names.mjs");
  const { teams, players } = loadNames();
  if (!teams.length) return t.skip("the professional match data is not in .cache: nothing to scan against");
  const teamRe = buildPattern(teams);
  const playerRe = buildPattern(players);
  const files = ["memory-site.json", "coach.json", "champion-cards.json"];
  const leaks = [];
  for (const name of files) {
    // Identifiers (video ids, dates, keys) are not prose: they are left out of the scan.
    const data = JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
    const text = JSON.stringify(data, (key, value) => (KEEP_KEYS.has(key) ? undefined : value));
    for (const re of [teamRe, playerRe]) {
      re.lastIndex = 0;
      const hit = re.exec(text);
      if (hit) leaks.push(`${name}: ${hit[0]}`);
    }
  }
  assert.deepEqual(leaks, [], "a team or player name is still published");
});
