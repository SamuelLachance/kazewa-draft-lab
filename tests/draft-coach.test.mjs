import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DRAFT_STEPS,
  advise,
  applyAction,
  coachContext,
  createSession,
  currentStep,
  inferPickRole,
  undo,
} from "../src/draft-coach.mjs";
import {
  WEIGHTS,
  coachTables,
  playableRoles,
  rankBans,
  rankPicks,
  recentOpinion,
  scorePick,
} from "../src/coach.mjs";
import { ROLES } from "../src/engine.mjs";
import { LANES } from "../src/lanes.mjs";
import { cardRelations } from "../src/relations.mjs";

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
const [knowledge, memory, cards, data, method] = await Promise.all([
  load("knowledge.json"),
  load("memory-site.json"),
  load("champion-cards.json"),
  load("coach.json"),
  load("method.json"),
]);
const context = () =>
  coachContext({ knowledge, memory, relations: cardRelations(cards), data, method });
const team = (top, jng, mid, bot, sup) => ({ top, jng, mid, bot, sup });
const empty = () => ({ blue: team(null, null, null, null, null), red: team(null, null, null, null, null) });
const noBans = () => ({ blue: [], red: [] });

// A small memory written for the tests: who he said beats whom, who goes with whom.
const claim = (tag, favours, champions, detailFr, more = {}) => ({
  tag,
  favours,
  champions,
  role: "",
  transferable: true,
  detailFr,
  ...more,
});
const sample = {
  cases: [
    {
      id: "a",
      blue: team("Jax", "Vi", "Azir", "Jinx", "Lulu"),
      red: team("Gnar", "Sejuani", "Orianna", "Kai'Sa", "Nautilus"),
      sources: [{ video: "aaaaaaaaaaa", title: "Vidéo A", ts: 10 }],
      claims: [
        claim("lane", "blue", ["Jax", "Gnar"], "Jax bat Gnar en lane", { role: "top" }),
        claim("synergy", "blue", ["Jinx", "Lulu"], "Jinx et Lulu vont ensemble"),
        claim("synergy", "blue", ["Gnar", "Sejuani"], "Leur seule synergie est Gnar avec Sejuani"),
        claim("answer", "red", ["Nautilus", "Lulu"], "Nautilus punit Lulu"),
        claim("answer", "blue", ["Vi", "Orianna"], "Vi attrape Orianna"),
        claim("answer", "blue", ["Azir", "Sejuani"], "Azir tient Sejuani à distance"),
        claim("lane", "blue", ["Azir", "Orianna"], "Azir gagne contre Orianna", { role: "mid" }),
        claim("pick_order", "blue", ["Azir", "Orianna"], "Azir pris trop tôt", { transferable: false }),
        claim("lane", "blue", ["Jax", "Gnar", "Vi"], "Trois champions : pas une paire", { role: "top" }),
      ],
    },
    {
      // The same video judges the mid lane the other way round in another game.
      id: "b",
      blue: team("Gnar", "Sejuani", "Orianna", "Jinx", "Lulu"),
      red: team("Jax", "Vi", "Azir", "Kai'Sa", "Nautilus"),
      sources: [{ video: "bbbbbbbbbbb", title: "Vidéo B", ts: 20 }],
      claims: [claim("lane", "blue", ["Orianna", "Azir"], "Orianna gagne contre Azir", { role: "mid" })],
    },
  ],
};
const meta = {
  games: 100,
  to: "2026-11-01",
  picks: { Jax: { top: 40, jng: 10 }, Gnar: { top: 20 }, Jinx: { bot: 30 }, Lulu: { sup: 30 }, Nautilus: { sup: 10 }, Azir: { mid: 20 } },
  bans: { Jax: 30, Nautilus: 60 },
  stages: { Jax: [5, 10, 35], Jinx: [20, 8, 2] },
  slots: Array.from({ length: 10 }, (_, slot) =>
    slot < 3 ? { top: 5, jng: 35, mid: 20, bot: 30, sup: 10 } : { top: 40, jng: 10, mid: 20, bot: 10, sup: 20 },
  ),
};
const pick = (more) =>
  scorePick({ side: "blue", picks: empty(), bans: noBans(), slot: 8, tables: coachTables(sample), meta, ...more });

test("competitive order gives five bans and five picks to each side", () => {
  assert.equal(DRAFT_STEPS.length, 20);
  assert.deepEqual(DRAFT_STEPS[0], { action: "ban", side: "blue" });
  assert.deepEqual(DRAFT_STEPS[6], { action: "pick", side: "blue" });
  assert.deepEqual(DRAFT_STEPS[7], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[8], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[12], { action: "ban", side: "red" });
  assert.deepEqual(DRAFT_STEPS[16], { action: "pick", side: "red" });
  assert.deepEqual(DRAFT_STEPS[19], { action: "pick", side: "red" });
  for (const side of ["blue", "red"]) {
    assert.equal(DRAFT_STEPS.filter((step) => step.side === side && step.action === "ban").length, 5);
    assert.equal(DRAFT_STEPS.filter((step) => step.side === side && step.action === "pick").length, 5);
  }
});

test("first pick acts on the opening ban and second pick waits", () => {
  const first = currentStep(createSession("first"));
  const second = currentStep(createSession("second"));
  assert.equal(first.ours, true);
  assert.equal(first.action, "ban");
  assert.equal(first.side, "blue");
  assert.equal(first.slot, null);
  assert.equal(second.ours, false);
  assert.equal(createSession("second").userSide, "red");
});

test("what he said about two champions is filed by relation and by role", () => {
  const tables = coachTables(sample);
  // Opponents in the same lane: the favoured one beats the other.
  assert.equal(tables.beats.get("Jax>Gnar").length, 1);
  assert.equal(tables.beats.get("Gnar>Jax"), undefined);
  assert.deepEqual(tables.beats.get("Jax>Gnar")[0].roles, { Jax: "top", Gnar: "top" });
  assert.equal(tables.beats.get("Nautilus>Lulu")[0].detail, "Nautilus punit Lulu");
  assert.equal(tables.beatenBy.get("Lulu")[0].winner, "Nautilus");
  // Allies: a synergy he credits to the pair's own side.
  assert.equal(tables.allies.get("Jinx|Lulu").length, 1);
  assert.equal(tables.allies.get("Jinx|Lulu")[0].good, true);
  // "Their only synergy is…", said in favour of the other side, is about the
  // rest of the composition: it is not turned into an anti-synergy.
  assert.equal(tables.allies.get("Gnar|Sejuani"), undefined);
  // Not carried over: remarks on pick order, and arguments naming three champions.
  assert.equal(tables.allies.get("Azir|Orianna"), undefined);
  assert.equal(tables.beats.get("Jax>Gnar").length + (tables.beats.get("Jax>Vi")?.length ?? 0), 1);
});

test("a pick scores what he said; the professional figures do not move it", () => {
  const picks = empty();
  picks.red.top = "Gnar";
  const jax = pick({ champion: "Jax", role: "top", picks });
  assert.deepEqual(jax.reasons.map((reason) => reason.kind), ["said"]);
  const said = jax.reasons[0];
  // The opponent of his own lane weighs more than another champion.
  assert.equal(said.points, WEIGHTS.saidLane);
  assert.equal(said.detail, "Jax bat Gnar en lane");
  assert.equal(said.sources[0].video, "aaaaaaaaaaa");
  assert.match(said.text, /Prend le dessus en lane sur Gnar/);
  assert.equal(jax.score, Math.round(jax.reasons.reduce((n, r) => n + r.points, 0) * 100) / 100);
  // Presence, moment and stage of the pro games carry no weight.
  // The same statement counts against the champion it names as the loser.
  const other = empty();
  other.red.top = "Jax";
  const gnar = pick({ champion: "Gnar", role: "top", picks: other });
  assert.equal(gnar.reasons.find((reason) => reason.kind === "said").points, -WEIGHTS.saidLaneLost);
  assert.ok(WEIGHTS.saidLaneLost > WEIGHTS.saidLane);
  assert.match(gnar.reasons.find((reason) => reason.kind === "said").text, /Jax prend le dessus en lane sur lui/);
  // It does not apply in another role: he spoke of the top lane.
  assert.equal(pick({ champion: "Jax", role: "jng", picks }).reasons.some((reason) => reason.kind === "said"), false);
  // Synergy with an ally already locked.
  const duo = empty();
  duo.blue.bot = "Jinx";
  const lulu = pick({ champion: "Lulu", role: "sup", picks: duo, slot: 5 });
  assert.match(lulu.reasons.find((reason) => reason.kind === "said").text, /Va bien avec Jinx/);
  assert.equal(lulu.reasons.find((reason) => reason.kind === "said").points, WEIGHTS.said);
});

test("a matchup he judged both ways gives no point, and a contrary statement is never hidden by the cap", () => {
  // Azir against Orianna: one video each way.
  const picks = empty();
  picks.red.mid = "Orianna";
  const azir = pick({ champion: "Azir", role: "mid", picks });
  assert.equal(azir.reasons.some((reason) => reason.kind === "said"), false);
  const note = azir.reasons.find((reason) => reason.kind === "note");
  assert.match(note.text, /dans les deux sens/);
  assert.equal(note.points, 0);
  const mirror = empty();
  mirror.red.mid = "Azir";
  assert.equal(pick({ champion: "Orianna", role: "mid", picks: mirror }).reasons.some((reason) => reason.kind === "said"), false);
  // Statements of one direction stop at the cap; the one against still counts.
  const tables = coachTables(sample);
  const many = (n) => Array.from({ length: n }, (_, i) => ({ winner: "Vi", loser: "x", roles: { Vi: "jng", [`E${i}`]: "top" }, detail: "d", sources: [], said: `v${i}` }));
  for (const [i, lane] of ["top", "mid", "bot", "sup"].entries())
    tables.beats.set(`Vi>E${i}`, [{ ...many(1)[0], roles: { Vi: "jng", [`E${i}`]: lane }, said: `v${i}` }]);
  tables.beats.set("Foe>Vi", [{ winner: "Foe", loser: "Vi", roles: { Vi: "jng", Foe: "jng" }, detail: "contre", sources: [], said: "w" }]);
  const board = empty();
  Object.assign(board.red, { top: "E0", mid: "E1", bot: "E2", sup: "E3", jng: "Foe" });
  const vi = scorePick({ champion: "Vi", role: "jng", side: "blue", picks: board, bans: noBans(), slot: 10, tables, meta: null });
  const saidPoints = vi.reasons.filter((reason) => reason.kind === "said").map((reason) => reason.points);
  // Role order: top (+1), the jungle opponent (-1.5), mid (+1), bot (+1), support (+1).
  assert.deepEqual(saidPoints, [WEIGHTS.said, -WEIGHTS.saidLaneLost, WEIGHTS.said, WEIGHTS.said, WEIGHTS.said]);
  // Two junglers do not meet "en lane".
  const jungle = vi.reasons.find((reason) => reason.points < 0);
  assert.match(jungle.text, /Foe prend le dessus en jungle sur lui/);
  const capped = empty();
  Object.assign(capped.red, { top: "E0", mid: "E1", bot: "E2", sup: "E3" });
  const piled = scorePick({ champion: "Vi", role: "jng", side: "blue", picks: capped, bans: noBans(), slot: 10, tables, meta: null });
  assert.equal(
    piled.reasons.filter((reason) => reason.kind === "said").reduce((n, reason) => n + reason.points, 0),
    WEIGHTS.saidCap,
  );
});

test("an anti-synergy he stated counts against the pair, and a duo judged both ways gives no point", () => {
  const withBad = structuredClone(sample);
  withBad.cases[0].claims.push(
    claim("synergy", "red", ["Jinx", "Vi"], "Jinx + Vi est une anti-synergie"),
    claim("synergy", "red", ["Azir", "Lulu"], "Azir avec Lulu ne marche pas"),
  );
  withBad.cases[1].claims.push(claim("synergy", "red", ["Azir", "Nautilus"], "Azir + Nautilus fonctionne"));
  withBad.cases.push({
    id: "c",
    blue: team("Jax", "Vi", "Azir", "Jinx", "Lulu"),
    red: team("Gnar", "Sejuani", "Orianna", "Kai'Sa", "Nautilus"),
    sources: [{ video: "ccccccccccc", title: "Vidéo C", ts: 0 }],
    claims: [claim("synergy", "blue", ["Azir", "Lulu"], "Azir + Lulu, ça marche")],
  });
  const tables = coachTables(withBad);
  assert.equal(tables.allies.get("Jinx|Vi")[0].good, false);
  const picks = empty();
  picks.blue.jng = "Vi";
  const jinx = scorePick({ champion: "Jinx", role: "bot", side: "blue", picks, bans: noBans(), slot: 4, tables, meta });
  const against = jinx.reasons.find((reason) => reason.kind === "said");
  assert.equal(against.points, -WEIGHTS.said);
  assert.match(against.text, /Va mal avec Vi d’après lui/);
  assert.equal(against.detail, "Jinx + Vi est une anti-synergie");
  // One video for, one against: said both ways, no point.
  const duo = empty();
  duo.blue.sup = "Lulu";
  const azir = scorePick({ champion: "Azir", role: "mid", side: "blue", picks: duo, bans: noBans(), slot: 4, tables, meta });
  assert.equal(azir.reasons.some((reason) => reason.kind === "said"), false);
  assert.match(azir.reasons.find((reason) => reason.kind === "note").text, /Avec Lulu, il a jugé ce duo dans les deux sens/);
  // In a ban list, a champion that goes badly with their pick is a less urgent ban.
  const theirs = empty();
  theirs.red.jng = "Vi";
  const ban = rankBans({ side: "blue", picks: theirs, bans: noBans(), tables, meta, champions: ["Jinx"] })[0];
  assert.match(ban.reasons.find((reason) => reason.kind === "said").text, /^Moins urgent : Jinx va mal avec leur Vi/);
});

test("his champion cards speak where he said nothing more precise, of champions in their usual role", () => {
  const set = (entries) => new Map(entries.map(([name, list]) => [name, new Set(list)]));
  const relations = {
    goodWith: set([["Jinx", ["Nautilus"]], ["Yasuo", ["Jinx"]]]),
    badWith: set([["Jinx", ["Azir"]]]),
    goodAgainst: set([["Jinx", ["Gnar", "Kai'Sa"]]]),
    badAgainst: set([["Jinx", ["Vi"]], ["Lulu", ["Jinx"]]]),
  };
  const tables = { ...coachTables(sample), relations };
  const picks = empty();
  // Each ally in the role it is known for: Yasuo has no professional game here, so his first listed lane.
  Object.assign(picks.blue, { sup: "Nautilus", [LANES.Yasuo[0]]: "Yasuo" });
  Object.assign(picks.red, { top: "Gnar", bot: "Kai'Sa", jng: "Vi", sup: "Lulu" });
  const jinx = scorePick({ champion: "Jinx", role: "bot", side: "blue", picks, bans: noBans(), slot: 9, tables, meta });
  const cards = jinx.reasons.filter((reason) => reason.kind === "card");
  const text = (name) => cards.find((reason) => reason.with === name)?.text;
  const points = (name) => cards.find((reason) => reason.with === name)?.points;
  assert.match(text("Nautilus"), /bon partenaire de Nautilus/);
  assert.equal(points("Nautilus"), WEIGHTS.card);
  // "de Yasuo", not "d’Yasuo".
  assert.match(text("Yasuo"), /bon partenaire de Yasuo/);
  assert.equal(points("Gnar"), WEIGHTS.card);
  // The opponent of the same lane weighs more.
  const lane = empty();
  lane.red.bot = "Kai'Sa";
  const facing = scorePick({ champion: "Jinx", role: "bot", side: "blue", picks: lane, bans: noBans(), slot: 4, tables, meta }).reasons.find((reason) => reason.kind === "card");
  assert.equal(facing.points, WEIGHTS.cardLane);
  assert.match(text("Vi"), /puni par Vi/);
  // Lulu's card says she is punished by Jinx: Jinx is strong against her.
  const onlyLulu = empty();
  onlyLulu.red.sup = "Lulu";
  const other = scorePick({ champion: "Jinx", role: "bot", side: "blue", picks: onlyLulu, bans: noBans(), slot: 4, tables, meta }).reasons.find((reason) => reason.kind === "card");
  assert.match(other.text, /fort contre Lulu/);
  assert.equal(other.points, WEIGHTS.card);
  // A bad partner, with the elision French asks for.
  const withAzir = empty();
  withAzir.blue.mid = "Azir";
  const bad = scorePick({ champion: "Jinx", role: "bot", side: "blue", picks: withAzir, bans: noBans(), slot: 4, tables, meta }).reasons.find((reason) => reason.kind === "card");
  assert.match(bad.text, /mauvais partenaire d’Azir/);
  assert.equal(bad.points, -WEIGHTS.card);
  // Relations of one direction stop at the cap: the running total never passes it.
  let running = 0;
  for (const reason of cards) {
    running += reason.points;
    assert.ok(Math.abs(running) <= WEIGHTS.cardCap);
  }
  // A statement of his on the same champion replaces the card.
  const said = { ...coachTables(sample), relations: { ...relations, goodWith: set([["Lulu", ["Jinx"]]]) } };
  const duo = empty();
  duo.blue.bot = "Jinx";
  const lulu = scorePick({ champion: "Lulu", role: "sup", side: "blue", picks: duo, bans: noBans(), slot: 5, tables: said, meta });
  assert.equal(lulu.reasons.filter((reason) => reason.with === "Jinx").length, 1);
  assert.equal(lulu.reasons.find((reason) => reason.with === "Jinx").kind, "said");
  // A champion locked outside its usual role: its card is not read (Jax is 80 % top).
  const odd = empty();
  odd.red.jng = "Jax";
  const usual = empty();
  usual.red.top = "Jax";
  const again = { ...coachTables({ cases: [] }), relations: { ...relations, goodAgainst: set([["Jinx", ["Jax"]]]) } };
  const base = { champion: "Jinx", role: "bot", side: "blue", bans: noBans(), slot: 4, tables: again, meta };
  assert.equal(scorePick({ ...base, picks: odd }).reasons.some((reason) => reason.kind === "card"), false);
  assert.equal(scorePick({ ...base, picks: usual }).reasons.filter((reason) => reason.kind === "card").length, 1);
});

test("his recent word on a champion's strength counts; an old one does not", () => {
  // The reference is the date of his newest remark, not any professional file.
  const strong = [{ date: "2026-08-10", patch: "16.15", tag: "meta_strong", text: "Très fort en ce moment", video: "ccccccccccc", ts: 5 }];
  const weak = [{ date: "2026-09-20", patch: "16.18", tag: "meta_weak", text: "Trop faible", video: "ddddddddddd", ts: null }];
  const old = [{ date: "2025-01-10", patch: "15.1", tag: "meta_strong", text: "Fort à l’époque", video: "eeeeeeeeeee", ts: null }];
  const order = [{ date: "2026-10-01", patch: "16.20", tag: "pick_order", text: "Pris trop tôt", video: "fffffffffff", ts: null }];
  const asOf = "2026-09-20";
  assert.equal(recentOpinion(strong, asOf).text, "Très fort en ce moment");
  assert.equal(recentOpinion(weak, asOf).text, "Trop faible");
  assert.equal(recentOpinion(old, asOf), null);
  assert.equal(recentOpinion(order, asOf), null);
  assert.equal(recentOpinion(strong, null), null);
  const up = pick({ champion: "Jinx", role: "bot", notes: strong, asOf }).reasons.find((reason) => reason.kind === "opinion");
  assert.equal(up.points, WEIGHTS.opinion);
  assert.match(up.text, /Il le jugeait fort en août 2026/);
  assert.equal(pick({ champion: "Jinx", role: "bot", notes: strong, asOf: null }).reasons.some((reason) => reason.kind === "opinion"), false);
});

test("a counter still available is a warning, not a penalty", () => {
  const open = pick({ champion: "Lulu", role: "sup", slot: 5 });
  const warning = open.reasons.find((reason) => reason.kind === "answer");
  assert.deepEqual(warning.answers, ["Nautilus"]);
  assert.equal(warning.points, 0);
  // Banned, or the opponent's support already locked: nobody is left to answer.
  const banned = pick({ champion: "Lulu", role: "sup", slot: 5, bans: { blue: ["Nautilus"], red: [] } });
  assert.equal(banned.reasons.some((reason) => reason.kind === "answer"), false);
  assert.equal(banned.score, open.score);
  const filled = empty();
  filled.red.sup = "Karma";
  assert.equal(pick({ champion: "Lulu", role: "sup", slot: 5, picks: filled }).reasons.some((reason) => reason.kind === "answer"), false);
});

test("the moment of the draft is no reason: the professional timing does not move a pick", () => {
  assert.equal(pick({ champion: "Gnar", role: "top", slot: 1 }).reasons.some((reason) => reason.kind === "timing"), false);
  assert.equal(pick({ champion: "Gnar", role: "top", slot: 1 }).reasons.some((reason) => reason.kind === "stage"), false);
});


test("a champion goes to the role of its lane table, whatever the moment of the draft and the professional roles", () => {
  // The lane table decides the roles; professional play does not.
  assert.deepEqual(playableRoles(meta, "Jax"), LANES.Jax);
  assert.deepEqual(playableRoles(null, "Jax"), LANES.Jax);
  const stray = { ...meta, picks: { Jax: { top: 60, jng: 1 } } };
  assert.deepEqual(playableRoles(stray, "Jax"), LANES.Jax);
  for (let slot = 1; slot <= 10; slot += 1) {
    const rows = rankPicks({ side: "blue", picks: empty(), bans: noBans(), slot, tables: coachTables(sample), champions: ["Jax", "Gnar", "Jinx"] });
    const jax = rows.find((row) => row.champion === "Jax");
    assert.ok(LANES.Jax.includes(jax.role), `slot ${slot}`);
  }
  // Top taken: the jungle is then the only place left for him.
  const taken = empty();
  taken.blue.top = "Gnar";
  const rows = rankPicks({ side: "blue", picks: taken, bans: noBans(), slot: 4, tables: coachTables(sample), champions: ["Jax"] });
  assert.equal(rows[0].role, "jng");
  assert.equal(rows[0].playable, true);
  // Every champion of the catalogue has a lane, and the coach never reads the professional roles to choose one.
  for (const name of Object.keys(LANES)) assert.ok(playableRoles(null, name).length >= 1, name);
  const source = readFileSync(new URL("../src/coach.mjs", import.meta.url), "utf8");
  assert.ok(!/roleShare|proPicks|presence\(/.test(source), "the coach still reads a professional share");
});

test("the frontline is read by the procedure of the two coaches, not by a count of the profiles", () => {
  const picks = empty();
  Object.assign(picks.blue, { mid: "Azir", bot: "Jinx", sup: "Lulu" });
  const frontliner = Object.keys(knowledge.champions).find(
    (name) => knowledge.champions[name].frontline >= 2 && (LANES[name] ?? []).includes("top"),
  );
  assert.equal(pick({ champion: frontliner, role: "top", picks, profiles: knowledge.champions }).reasons.some((reason) => reason.kind === "need"), false);
});

test("bans: what he said and what the picks locked change, not the professional ban list", () => {
  const tables = coachTables(sample);
  const champions = ["Jax", "Gnar", "Jinx", "Lulu", "Nautilus", "Teemo"];
  const first = rankBans({ side: "blue", picks: empty(), bans: noBans(), tables, meta, champions });
  assert.ok(first.every((row) => row.role === null));
  assert.ok(first.every((row) => row.reasons.every((reason) => reason.kind !== "meta" && reason.kind !== "timing")));
  // We locked Gnar top: Jax, who beats him, is worth more as a ban.
  const picks = empty();
  picks.blue.top = "Gnar";
  const second = rankBans({ side: "blue", picks, bans: noBans(), tables, meta, champions });
  const jax = second.find((row) => row.champion === "Jax");
  assert.ok(jax.score > first.find((row) => row.champion === "Jax").score);
  assert.match(jax.reasons.find((reason) => reason.kind === "said").text, /Jax prend le dessus sur ton Gnar/);
  // Said to the other side when the opponent is the one who bans.
  const theirs = rankBans({ side: "blue", picks, bans: noBans(), tables, meta, champions, mine: false });
  assert.match(
    theirs.find((row) => row.champion === "Jax").reasons.find((reason) => reason.kind === "said").text,
    /Jax prend le dessus sur leur Gnar/,
  );
  // A champion that loses to a pick already locked is a less urgent ban, and says so.
  const weak = empty();
  weak.blue.top = "Jax";
  const gnar = rankBans({ side: "blue", picks: weak, bans: noBans(), tables, meta, champions }).find((row) => row.champion === "Gnar");
  assert.match(gnar.reasons.find((reason) => reason.kind === "said").text, /^Moins urgent : ton Jax prend le dessus sur Gnar/);
  // A champion whose roles the opponent has all filled is not worth a ban.
  const closed = empty();
  closed.red.sup = "Karma";
  const third = rankBans({ side: "blue", picks: closed, bans: noBans(), tables, meta, champions });
  assert.equal(third.find((row) => row.champion === "Nautilus").playable, false);
});

test("the side that picks right after the bans does not ban its own best pick", () => {
  const tables = coachTables(sample);
  const champions = ["Jax", "Nautilus", "Jinx"];
  const plain = rankBans({ side: "blue", picks: empty(), bans: noBans(), tables, meta, champions });
  const best = plain[0].champion;
  const held = rankBans({ side: "blue", picks: empty(), bans: noBans(), tables, meta, champions, ownPicks: new Set([best]) });
  assert.notEqual(held[0].champion, best);
  const own = held.find((row) => row.champion === best).reasons.find((reason) => reason.kind === "own");
  assert.equal(own.points, -WEIGHTS.own);
  assert.match(own.text, /ton meilleur pick/);
});

test("picks: only roles the champion is played in, and never a champion already taken", () => {
  const tables = coachTables(sample);
  const picks = empty();
  picks.blue.top = "Gnar";
  const rows = rankPicks({ side: "blue", picks, bans: { blue: ["Lulu"], red: [] }, slot: 4, tables, meta, champions: Object.keys(knowledge.champions) });
  assert.equal(rows.some((row) => row.champion === "Lulu" || row.champion === "Gnar"), false);
  for (const row of rows) {
    if (!row.playable) {
      assert.equal(row.role, null);
      continue;
    }
    assert.ok(playableRoles(meta, row.champion).includes(row.role), row.champion);
    assert.notEqual(row.role, "top");
  }
  // Best first among the playable ones.
  const playable = rows.filter((row) => row.playable);
  for (let index = 1; index < playable.length; index += 1)
    assert.ok(playable[index - 1].score >= playable[index].score);
});

test("with the shipped data, the first bans come from what he said, never from the professional ban rates", () => {
  const brain = context();
  const advice = advise(createSession("first"), brain, { limit: 5 });
  assert.equal(advice.step.action, "ban");
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length);
  for (const option of advice.options) {
    assert.ok(option.reasons.every((reason) => reason.kind !== "meta" && reason.kind !== "timing"), option.champion);
    assert.ok(
      option.reasons.some((reason) => reason.points > 0 && (reason.coach === "kazewa" || reason.kind === "opinion" || reason.kind === "said")),
      option.champion,
    );
  }
});

test("a whole draft played on the first suggestion gives two playable teams, with a reason at every step", () => {
  const brain = context();
  let session = createSession("first");
  for (let index = 0; index < 20; index += 1) {
    const advice = advise(session, brain, { limit: 5 });
    assert.equal(advice.done, false);
    const best = advice.options[0];
    assert.ok(best, `no suggestion at step ${index + 1}`);
    assert.ok(best.reasons.some((reason) => reason.points > 0));
    for (const reason of best.reasons) {
      assert.ok(reason.text.length > 10);
      assert.equal(/calculateur|bloc papier|tank\(s\)/.test(reason.text), false);
      // "ton" and "leur" never meet a bare "de Orianna" or "Le ADC".
      assert.equal(/\bde [AEIOU]|\bLe ADC\b|d’[YH]/.test(reason.text), false, reason.text);
      assert.equal(reason.kind === "own", false);
    }
    assert.ok(Number.isFinite(best.score));
    if (advice.step.action === "pick") {
      assert.ok(playableRoles(data.meta, best.champion).includes(best.role));
      assert.notEqual(best.rare, true);
      // What he named against or with the picks locked, outside the first five.
      assert.ok(advice.answers.length <= 3);
      for (const row of advice.answers) {
        assert.equal(advice.options.includes(row), false);
        assert.ok(row.reasons.some((reason) => reason.kind === "said" && reason.points > 0));
      }
    } else assert.deepEqual(advice.answers, []);
    session = applyAction(session, best.champion, best.role, brain);
  }
  assert.equal(advise(session, brain).done, true);
  const all = [];
  for (const side of ["blue", "red"]) {
    assert.equal(session.bans[side].length, 5);
    for (const role of ROLES) {
      const name = session.picks[side][role];
      assert.ok(name && playableRoles(data.meta, name).includes(role), `${side} ${role}`);
      all.push(name);
    }
    all.push(...session.bans[side]);
  }
  assert.equal(new Set(all).size, 20);
  // Twenty boards visited: the cache keeps the draft, not every draft ever played.
  assert.ok(brain.cache.size <= 24);
});

test("a click without a role puts the champion in its usual role, an explicit role wins, an undo replays the log", () => {
  const brain = context();
  let session = createSession("first");
  // Six bans, none of them one of the two champions the test checks.
  const bans = ["Bard", "Mel", "Nocturne", "Cassiopeia", "Varus", "Yone"];
  for (const name of bans) session = applyAction(session, name, null, brain);
  // Ashe is played ADC, never support; Cho'Gath jungle more than top.
  for (const [name, role] of [["Ashe", "bot"], ["Jax", "top"]]) {
    if (bans.includes(name)) continue;
    // Shanei never first-picks a top: Jax goes where his lane table lets him.
    assert.ok(LANES[name].includes(inferPickRole(session, name, brain)), name);
    // An explicit role wins over the inferred one.
    assert.equal(applyAction(session, name, role, brain).picks.blue[role], name);
  }
  const flex = advise(session, brain, { limit: 173 }).pool.find((row) => row.playable && row.roles.length > 1);
  assert.ok(flex);
  const picked = applyAction(session, flex.champion, null, brain);
  assert.equal(picked.picks.blue[flex.role], flex.champion);
  assert.equal(currentStep(picked).slot, 2);
  // An explicit role wins when it is free.
  const other = flex.roles.find((role) => role !== flex.role);
  assert.equal(applyAction(session, flex.champion, other, brain).picks.blue[other], flex.champion);
  // Taken champions are refused; undo goes back one step.
  assert.throws(() => applyAction(picked, flex.champion, null, brain), /déjà banni ou pick/);
  assert.throws(() => applyAction(picked, bans[0], null, brain), /déjà banni ou pick/);
  const back = undo(picked);
  assert.deepEqual(back.picks, session.picks);
  assert.equal(back.log.length, 6);
  assert.equal(undo(createSession("second")).log.length, 0);
});

test("with nothing to go on the coach suggests nothing, and the draft can still be played", () => {
  const bare = coachContext({ knowledge });
  const advice = advise(createSession("first"), bare, { limit: 5 });
  // No professional figures, nothing said: an alphabetical list is not advice.
  assert.deepEqual(advice.options, []);
  assert.equal(advice.pool.length, Object.keys(knowledge.champions).length);
  let session = createSession("first");
  for (let index = 0; index < 8; index += 1) {
    const any = advise(session, bare).pool.find((row) => row.playable);
    session = applyAction(session, any.champion, any.role, bare);
  }
  assert.equal(session.log.length, 8);
  assert.equal(ROLES.filter((role) => session.picks.blue[role]).length, 1);
});

test("the shipped coach data is recent professional play and notes about the champion they sit under", () => {
  assert.ok(data.meta.games >= 300);
  assert.ok(data.meta.from < data.meta.to);
  assert.match(data.source, /Oracle's Elixir/);
  assert.equal(data.meta.slots.length, 10);
  for (const row of data.meta.slots)
    assert.equal(ROLES.reduce((n, role) => n + row[role], 0), data.meta.games);
  for (const [name, byRole] of Object.entries(data.meta.picks)) {
    assert.ok(knowledge.champions[name], name);
    const picks = Object.values(byRole).reduce((n, v) => n + v, 0);
    assert.equal(data.meta.stages[name].reduce((n, v) => n + v, 0), picks, name);
  }
  // A ban is counted once per team and per game.
  for (const [name, count] of Object.entries(data.meta.bans)) assert.ok(count <= 2 * data.meta.games, name);
  const others = Object.keys(knowledge.champions);
  let dated = 0;
  for (const [name, notes] of Object.entries(data.notes)) {
    assert.ok(knowledge.champions[name], name);
    assert.ok(notes.length >= 1 && notes.length <= 4);
    for (let index = 1; index < notes.length; index += 1)
      assert.ok(String(notes[index - 1].date ?? "") >= String(notes[index].date ?? ""), name);
    for (const note of notes) {
      assert.ok(["pick_order", "meta_strong", "meta_weak"].includes(note.tag));
      assert.match(note.video, /^[a-zA-Z0-9_-]{11}$/);
      if (note.date) dated++;
      // The note names this champion, and names it before any other one.
      const at = note.text.indexOf(name);
      assert.ok(at >= 0, `${name}: ${note.text}`);
      for (const other of others) {
        if (other === name || name.includes(other) || other.includes(name)) continue;
        const where = note.text.search(new RegExp(`(?<![\\p{L}\\p{N}])${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u"));
        assert.ok(where < 0 || where > at, `${name}: ${note.text}`);
      }
      assert.ok(note.role === null || ROLES.includes(note.role));
    }
  }
  assert.ok(dated > 300);
  // The window holds no academy series.
  assert.match(data.source, /but the academy series/);
});
