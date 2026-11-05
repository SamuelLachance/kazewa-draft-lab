import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeDraft, normalizeChampion, ROLES } from "../src/engine.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DEFAULT_GATE = Object.freeze({
  minimumAgreement: 0.85,
  minimumCoverage: 0.8,
  minimumCases: 50,
  minimumVideos: 10,
});

// These conservative tags identify information the ten-pick model cannot observe.
// They are an auditable eligibility screen, not a semantic guarantee about labels.
export const INFLUENCE_PATTERNS = Object.freeze({
  draft_process:
    /\b(?:blind(?:ed)?|first[- ]pick(?:ed)?|last[- ]pick|counter[- ]pick(?:ed)?|pick order|ban(?:ned|ning|s)?|left open|leave[s]? .{0,28}open|B[1-5]|R[1-5])\b/i,
  historical_meta:
    /\b(?:meta|patch|win[- ]?rate|presence|currently|current patch|in this tournament|in this season)\b|\b\d{1,2}\.\d{1,2}\b/i,
  player_or_team_strength:
    /\b(?:comfort|signature|better team|weaker team|stronger team|team gap|skill gap|player gap|genius|Faker|Zeus|Kiin|Chovy|Doran|Canna|Caps|Doinb|Oner|Gumayusi|Peyz|Ruler|Viper|JackeyLove|Hans Sama|Caliste|Upset|Humanoid|Bin|Knight|Xiaohu|Bdd)\b/i,
  late_or_result_aware:
    /\b(?:post[- ]?game|in hindsight|after the game|during the game|knows? the result|already won|result[- ]aware)\b/i,
});

const json = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const readJSONFiles = (directory) =>
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) =>
      json(path.join(directory, file)).map((record) => ({
        ...record,
        _source: path
          .relative(path.dirname(directory), path.join(directory, file))
          .replaceAll("\\", "/"),
      })),
    );
const stated = (verdict) =>
  ["left", "right"].includes(verdict?.side) && Number(verdict?.confidence) > 0;

export function influenceTags(record) {
  const text = [
    record.label,
    record.verdict?.label,
    record.note,
    ...(record.reasons ?? []),
    ...(record.champion_reads ?? []).map(
      (read) => `${read.comp ?? ""} ${read.read ?? ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  const tags = Object.entries(INFLUENCE_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
  if (
    (record.late_opinion || record.verdict?.late_opinion) &&
    !tags.includes("late_or_result_aware")
  )
    tags.push("late_or_result_aware");
  return tags;
}

export function canonicalPicks(picks, knowledge) {
  if (!picks || typeof picks !== "object") return null;
  const result = {};
  for (const role of ROLES) {
    const supplied = picks[role];
    // A question mark represents uncertainty even if removing it yields a name.
    if (
      typeof supplied !== "string" ||
      supplied.includes("?") ||
      !supplied.trim()
    )
      return null;
    const champion = normalizeChampion(supplied, knowledge);
    if (!champion || !Object.hasOwn(knowledge.champions, champion)) return null;
    result[role] = champion;
  }
  return result;
}

export function fingerprint(blue, red) {
  const left = ROLES.map((role) => blue[role]).join("|");
  const right = ROLES.map((role) => red[role]).join("|");
  return left < right
    ? { value: `${left}//${right}`, swapped: false }
    : { value: `${right}//${left}`, swapped: true };
}

function parseHeaderDraft(file) {
  const text = fs.readFileSync(file, "utf8");
  const parse = (side) => {
    const line = text
      .split(/\r?\n/)
      .find((value) => value.startsWith(`${side}:`));
    const match = line?.match(
      /top (.+), jng (.+), mid (.+), bot (.+), sup (.+)$/,
    );
    return match
      ? Object.fromEntries(
          ROLES.map((role, index) => [role, match[index + 1].trim()]),
        )
      : null;
  };
  return { blue: parse("BLUE"), red: parse("RED") };
}

function mapBroadcastSides(clean, draft, knowledge) {
  const scores = { direct: 0, reverse: 0 };
  for (const role of ROLES) {
    for (const [broadcast, direct, reverse] of [
      ["left", "blue", "red"],
      ["right", "red", "blue"],
    ]) {
      const supplied = clean[`${broadcast}_picks`]?.[role];
      if (typeof supplied !== "string" || supplied.includes("?")) continue;
      const canonical = normalizeChampion(supplied, knowledge);
      if (canonical === draft[direct]?.[role]) scores.direct += 1;
      if (canonical === draft[reverse]?.[role]) scores.reverse += 1;
    }
  }
  // Do not infer a mapping from ambiguous or contradictory known selections.
  const best = Math.max(scores.direct, scores.reverse);
  const worst = Math.min(scores.direct, scores.reverse);
  const known = ["left", "right"]
    .flatMap((side) => ROLES.map((role) => clean[`${side}_picks`]?.[role]))
    .filter(
      (name) =>
        typeof name === "string" &&
        !name.includes("?") &&
        normalizeChampion(name, knowledge),
    ).length;
  if (best < 2 || best === worst || best !== known || worst !== 0) return null;
  return scores.direct > scores.reverse
    ? { left: "blue", right: "red" }
    : { left: "red", right: "blue" };
}

export function deduplicateCases(candidates) {
  // Union by source game and by a side-invariant, role-sensitive draft hash.
  // Multiple spellings/rosters for the same game are excluded, never resolved
  // by selecting the record that agrees with the algorithm.
  const parent = candidates.map((_, index) => index);
  const root = (index) =>
    parent[index] === index ? index : (parent[index] = root(parent[index]));
  const seen = new Map();
  candidates.forEach((record, index) => {
    const fp = fingerprint(record.blue, record.red);
    record._fingerprint = fp;
    for (const key of [
      `draft:${fp.value}`,
      `game:${record.sourceGame}`,
      ...(record.oe ? [`oe:${record.oe}`] : []),
    ]) {
      if (seen.has(key)) parent[root(index)] = root(seen.get(key));
      else seen.set(key, index);
    }
  });
  const groups = new Map();
  candidates.forEach((record, index) => {
    const group = root(index);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(record);
  });
  const cases = [],
    conflicts = [],
    outcomeConflicts = [];
  let duplicateRecordsRemoved = 0;
  for (const group of groups.values()) {
    const fingerprints = new Set(
      group.map((record) => record._fingerprint.value),
    );
    const labels = new Set(
      group.map((record) =>
        record._fingerprint.swapped
          ? record.expected === "blue"
            ? "red"
            : "blue"
          : record.expected,
      ),
    );
    if (fingerprints.size !== 1 || labels.size !== 1) {
      conflicts.push({
        sourceGames: [...new Set(group.map((record) => record.sourceGame))],
        reason:
          fingerprints.size !== 1
            ? "conflicting_compositions"
            : "conflicting_labels",
        sourceFiles: group.map((record) => record.sourceFile),
      });
      continue;
    }
    group.sort(
      (a, b) =>
        Number(a.reconstructed) - Number(b.reconstructed) ||
        a.id.localeCompare(b.id),
    );
    const selected = group[0];
    const { _fingerprint, ...record } = selected;
    const outcomes = group
      .filter((value) => ["blue", "red"].includes(value.actualWinner))
      .map((value) => {
        const flip = value._fingerprint.swapped !== _fingerprint.swapped;
        return {
          winner: flip
            ? value.actualWinner === "blue"
              ? "red"
              : "blue"
            : value.actualWinner,
          sourceFile:
            value.keySourceFile ??
            value.actualWinnerSourceFile ??
            value.sourceFile,
        };
      });
    if (outcomes.length) {
      const conflicting =
        new Set(outcomes.map((value) => value.winner)).size > 1;
      record.actualWinner = conflicting ? null : outcomes[0].winner;
      record.actualWinnerOrientation = "selected_case_blue_red";
      record.actualWinnerConflict = conflicting;
      record.actualWinnerSourceFile = conflicting
        ? null
        : outcomes[0].sourceFile;
      record.actualWinnerSources = [
        ...new Set(outcomes.map((value) => value.sourceFile)),
      ];
      if (conflicting)
        outcomeConflicts.push({
          sourceGames: [...new Set(group.map((value) => value.sourceGame))],
          reason: "conflicting_actual_outcomes",
          outcomes,
        });
    }
    cases.push({
      ...record,
      fingerprint: _fingerprint.value,
      duplicateSourceFiles: [
        ...new Set(group.slice(1).map((value) => value.sourceFile)),
      ],
      duplicateVideos: [...new Set(group.slice(1).map((value) => value.video))],
    });
    duplicateRecordsRemoved += group.length - 1;
  }
  return {
    cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
    conflicts,
    outcomeConflicts,
    duplicateRecordsRemoved,
  };
}

export function buildBenchmark(corpusRoot, knowledge) {
  const clean = readJSONFiles(path.join(corpusRoot, "kb", "clean_verdicts"));
  const cleanByFile = new Map(clean.map((record) => [record.file, record]));
  const candidates = [];
  const excluded = [];
  const makeCase = (record, blue, red, expected, extra = {}) => {
    const tags = influenceTags(record);
    const reconstructed = Boolean(extra.reconstructed);
    return {
      id: extra.id ?? record.file,
      video: record.file.replace(/_g\d+$/, ""),
      sourceGame: record.file,
      group: record.file.replace(/_g\d+$/, ""),
      sourceFile: `kb/${record._source}`,
      sourceKind: "draft_phase_transcript_extraction",
      blue,
      red,
      expected,
      confidence: record.verdict.confidence,
      label: record.verdict.label,
      reasons: record.reasons,
      quoteTimestamp: record.quote_ts,
      reconstructed,
      influenceTags: tags,
      primaryEligible: !reconstructed && tags.length === 0,
      // These are display/audit fields and are never sent to analyzeDraft.
      ...extra,
    };
  };

  let strictComplete = 0;
  for (const record of clean) {
    if (!stated(record.verdict)) {
      excluded.push({
        sourceGame: record.file,
        reason: "no_stated_preference",
      });
      continue;
    }
    const blue = canonicalPicks(record.left_picks, knowledge);
    const red = canonicalPicks(record.right_picks, knowledge);
    if (!blue || !red) {
      excluded.push({
        sourceGame: record.file,
        reason: "incomplete_uncertain_or_unknown_champions",
      });
      continue;
    }
    if (new Set([...Object.values(blue), ...Object.values(red)]).size !== 10) {
      excluded.push({ sourceGame: record.file, reason: "duplicate_champion" });
      continue;
    }
    const tags = influenceTags(record);
    if (tags.includes("late_or_result_aware")) {
      excluded.push({
        sourceGame: record.file,
        reason: "late_or_result_aware",
      });
      continue;
    }
    strictComplete += 1;
    // Here blue/red denote anonymized teams A/B; source left/right are retained
    // only through expected, without inventing map-side or first-pick effects.
    candidates.push(
      makeCase(
        record,
        blue,
        red,
        record.verdict.side === "left" ? "blue" : "red",
        { orientation: "broadcast_left_as_blue" },
      ),
    );
  }

  const keyPath = path.join(corpusRoot, "kb_key", "test_key2.json");
  let restoredCount = 0;
  if (fs.existsSync(keyPath)) {
    for (const key of json(keyPath)) {
      const record = cleanByFile.get(key.file);
      if (!record || !stated(record.verdict)) {
        excluded.push({
          sourceGame: key.file,
          reason: "key_without_clean_draft_preference",
        });
        continue;
      }
      const header = parseHeaderDraft(
        path.join(corpusRoot, "kb", "eval2", "dossiers", `${key.id}.md`),
      );
      const draft = {
        blue: canonicalPicks(header.blue, knowledge),
        red: canonicalPicks(header.red, knowledge),
      };
      if (
        !draft.blue ||
        !draft.red ||
        new Set([...Object.values(draft.blue), ...Object.values(draft.red)])
          .size !== 10
      ) {
        excluded.push({
          sourceGame: key.file,
          reason: "invalid_reconstructed_roster",
        });
        continue;
      }
      const mapping = mapBroadcastSides(record, draft, knowledge);
      if (!mapping) {
        excluded.push({
          sourceGame: key.file,
          reason: "ambiguous_or_conflicting_side_mapping",
        });
        continue;
      }
      if (mapping[record.verdict.side] !== key.kazewa) {
        excluded.push({
          sourceGame: key.file,
          reason: "key_clean_label_conflict",
        });
        continue;
      }
      if (influenceTags(record).includes("late_or_result_aware")) {
        excluded.push({ sourceGame: key.file, reason: "late_or_result_aware" });
        continue;
      }
      const originalComplete = Boolean(
        canonicalPicks(record.left_picks, knowledge) &&
          canonicalPicks(record.right_picks, knowledge),
      );
      if (!originalComplete) restoredCount += 1;
      candidates.push(
        makeCase(record, draft.blue, draft.red, key.kazewa, {
          id: `${key.file}__oe${key.oe}`,
          oe: key.oe,
          reconstructed: !originalComplete,
          primaryEligible:
            originalComplete && influenceTags(record).length === 0,
          rosterSourceFile: `kb/eval2/dossiers/${key.id}.md`,
          keySourceFile: "kb_key/test_key2.json",
          orientation: "verified_key_blue_red",
          actualWinner: ["blue", "red"].includes(key.win) ? key.win : null,
          actualWinnerOrientation: "verified_key_blue_red",
          date: key.date,
        }),
      );
    }
  }

  const deduped = deduplicateCases(candidates);
  const counts = Object.fromEntries(
    [...new Set(excluded.map((record) => record.reason))].map((reason) => [
      reason,
      excluded.filter((record) => record.reason === reason).length,
    ]),
  );
  const benchmark = {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    design:
      "Frozen retrospective benchmark. The scorer is a symmetric reading of families, lane counters and synergies, confronted with these labels; it is not a roster-to-label table and it is not the separate distillation fit.",
    primaryDefinition:
      "Complete ten exact known champions in draft-phase-only extracts; no detected draft-process, player/team-strength, meta or result-aware reason. Conservative keyword screening is imperfect.",
    broaderDefinition:
      "All nonconflicting draft-phase stated labels with complete rosters, including historical-context reasons and independently supplied dossier rosters for originally incomplete extracts.",
    sourceOverlap: true,
    limitations: [
      "The method, champion taxonomy and rules were distilled from overlapping Kazewa videos. This is not an independent holdout and does not establish future fidelity.",
      "The primary screening uses explicit keywords; unobserved context can remain and some composition-only reasoning can be excluded conservatively.",
      "Reconstructed rosters in the broader cohort come from existing project dossier headers and answer keys, not a newly verified external match feed.",
      "Broadcast left/right are anonymized as blue/red for exact-extract cases; the engine cannot use first-pick or map-side advantages.",
      "Predictions of Kazewa preference and predictions of actual match winners are distinct outcomes.",
      "The reading was confronted with these same retrospective labels. Agreement on this file is not an independent test. The published site uses 70% broader agreement as its bar and does not block publication on the older 85% study.",
    ],
    gate: DEFAULT_GATE,
    audit: {
      cleanRecords: clean.length,
      statedPreferences: clean.filter((record) => stated(record.verdict))
        .length,
      strictCompleteCandidates: strictComplete,
      reconstructedCandidates: restoredCount,
      deduplicatedCases: deduped.cases.length,
      duplicateRecordsRemoved: deduped.duplicateRecordsRemoved,
      conflicts: deduped.conflicts,
      outcomeConflicts: deduped.outcomeConflicts,
      exclusionCounts: counts,
      excluded,
      unusedSources: [
        {
          path: "kb_key/test_key3.json",
          reason:
            "Same 51 labeled matches as test_key2; not additional evidence.",
        },
        {
          path: "kb_key/test_key.json",
          reason:
            "May contain opinions revised after champion select; includes disagreements with draft-phase-only extracts. Kept out of this benchmark.",
        },
        {
          path: "verdicts/",
          reason:
            "Mixes pregame and late/revised opinions; excluded from the main draft-phase cohorts and used only in the separate exploratoryRaw report.",
        },
        {
          path: "kb/eval*/[A-Z]*.json",
          reason: "Earlier automated predictions are not Kazewa ground truth.",
        },
      ],
    },
    cases: deduped.cases,
  };
  benchmark.exploratoryRaw = buildExploratoryRaw(
    corpusRoot,
    knowledge,
    clean,
    benchmark.cases,
  );
  return benchmark;
}

export function buildExploratoryRaw(corpusRoot, knowledge, clean, cleanCases) {
  const directory = path.join(corpusRoot, "verdicts");
  const raw = [];
  for (const file of fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const review = json(path.join(directory, file));
    for (const [index, game] of (review.games ?? []).entries())
      raw.push({
        ...game,
        video: review.video ?? file.replace(/\.json$/, ""),
        _index: index,
        _file: `verdicts/${file}`,
      });
  }
  const excluded = [],
    candidates = [];
  const cleanFingerprints = new Set(
    cleanCases.map((record) => record.fingerprint),
  );
  const cleanSourceGames = new Set(
    cleanCases.map((record) => record.sourceGame),
  );
  let strictCompletePregame = 0;
  for (const record of raw) {
    const sourceId = `${record.video}__raw${record._index + 1}`;
    const skip = (reason) => excluded.push({ sourceGame: sourceId, reason });
    if (!stated(record.verdict)) {
      skip("no_stated_preference");
      continue;
    }
    if (
      record.late_opinion ||
      record.verdict?.late_opinion ||
      influenceTags(record).includes("late_or_result_aware")
    ) {
      skip("explicit_late_or_result_aware_opinion");
      continue;
    }
    if (record.sides_uncertain || !Number.isFinite(Number(record.game))) {
      skip("uncertain_sides_or_game");
      continue;
    }
    const blue = canonicalPicks(record.left_picks, knowledge),
      red = canonicalPicks(record.right_picks, knowledge);
    if (
      !blue ||
      !red ||
      new Set([...Object.values(blue), ...Object.values(red)]).size !== 10
    ) {
      skip("incomplete_uncertain_unknown_or_duplicate_champions");
      continue;
    }
    strictCompletePregame += 1;
    const expected = record.verdict.side === "left" ? "blue" : "red";
    const cleanVideo = clean.filter(
      (item) => item.file.replace(/_g\d+$/, "") === record.video,
    );
    const repeatedGameNumbers =
      raw.filter(
        (item) =>
          item.video === record.video &&
          String(item.game) === String(record.game),
      ).length > 1;
    let cleanRecord = !repeatedGameNumbers
      ? cleanVideo.find(
          (item) => item.file === `${record.video}_g${record.game}`,
        )
      : null;
    let mapping = null;
    if (cleanRecord) {
      if (!stated(cleanRecord.verdict)) {
        skip("clean_draft_phase_has_no_preference");
        continue;
      }
      mapping = mapBroadcastSides(cleanRecord, { blue, red }, knowledge);
      if (!mapping) {
        skip("clean_known_picks_conflict_or_mapping_unresolved");
        continue;
      }
    } else {
      const matches = cleanVideo
        .map((item) => ({
          item,
          mapping: mapBroadcastSides(item, { blue, red }, knowledge),
          known: ["left", "right"]
            .flatMap((side) =>
              ROLES.map((role) => item[`${side}_picks`]?.[role]),
            )
            .filter(
              (name) =>
                typeof name === "string" &&
                !name.includes("?") &&
                normalizeChampion(name, knowledge),
            ).length,
        }))
        .filter((item) => item.mapping && item.known >= 4)
        .sort((a, b) => b.known - a.known);
      if (matches.length > 1) {
        skip("ambiguous_multi_series_clean_match");
        continue;
      }
      if (matches.length) ({ item: cleanRecord, mapping } = matches[0]);
      if (cleanRecord && !stated(cleanRecord.verdict)) {
        skip("clean_draft_phase_has_no_preference");
        continue;
      }
    }
    if (cleanRecord && mapping[cleanRecord.verdict.side] !== expected) {
      skip("raw_label_conflicts_with_clean_draft_phase");
      continue;
    }
    const fp = fingerprint(blue, red).value;
    // A series discriminator is necessary: raw game numbering restarts within
    // videos that review several series. The source array index is stable and
    // anonymous; exact draft fingerprints still remove repeated records.
    const sourceGame =
      cleanRecord?.file ??
      `${record.video}__series${record.match ? raw.filter((item) => item.video === record.video).findIndex((item) => item.match === record.match) + 1 : 1}_g${record.game}`;
    candidates.push({
      id: sourceId,
      video: record.video,
      sourceGame,
      group: record.video,
      sourceFile: record._file,
      sourceKind: "full_review_extraction_timing_not_independently_verified",
      blue,
      red,
      expected,
      confidence: record.verdict.confidence,
      label: record.verdict.label,
      reasons: record.reasons,
      reconstructed: false,
      primaryEligible: false,
      influenceTags: influenceTags(record),
      orientation: "broadcast_left_as_blue",
      actualWinner: ["left", "right"].includes(record.result)
        ? record.result === "left"
          ? "blue"
          : "red"
        : null,
      actualWinnerOrientation: "selected_case_blue_red",
      actualWinnerSourceFile: record._file,
      cleanMatch: cleanRecord?.file ?? null,
      overlapsCleanBenchmark:
        cleanFingerprints.has(fp) || cleanSourceGames.has(sourceGame),
    });
  }
  const deduped = deduplicateCases(candidates);
  return {
    name: "Exploratory full-review corpus, kept separate from draft-phase benchmark",
    limitations: [
      "Explicit late opinions are excluded, but absence of a late flag is not proof of a pregame judgment. Full-review extraction can retain hindsight and omitted timing context.",
      "Cases conflicting with matched clean draft-phase labels, including an explicit absence of preference, are excluded.",
      "Game numbers restart in multi-series reviews. Clean matches use unambiguous known-pick correspondence; unresolved matches remain marked and cannot establish independence.",
      "Some cases overlap the clean benchmark or method source. This cohort never contributes to the fidelity gate.",
    ],
    audit: {
      fullReviewRecords: raw.length,
      strictCompleteUnflaggedPregameCandidates: strictCompletePregame,
      eligibleAfterQualityChecks: deduped.cases.length,
      distinctVideos: new Set(deduped.cases.map((record) => record.video)).size,
      overlapsCleanBenchmark: deduped.cases.filter(
        (record) => record.overlapsCleanBenchmark,
      ).length,
      outsideCleanBenchmark: deduped.cases.filter(
        (record) => !record.overlapsCleanBenchmark,
      ).length,
      cleanMatchUnresolved: deduped.cases.filter((record) => !record.cleanMatch)
        .length,
      duplicateRecordsRemoved: deduped.duplicateRecordsRemoved,
      conflicts: deduped.conflicts,
      outcomeConflicts: deduped.outcomeConflicts,
      exclusionCounts: Object.fromEntries(
        [...new Set(excluded.map((record) => record.reason))].map((reason) => [
          reason,
          excluded.filter((record) => record.reason === reason).length,
        ]),
      ),
      excluded,
    },
    cases: deduped.cases,
  };
}

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = successes / total,
    z2 = z * z,
    denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    denominator;
  return {
    low: Math.max(0, center - radius),
    high: Math.min(1, center + radius),
    method: "Wilson 95%; case-level, not cluster-adjusted",
  };
}

export function summarize(rows) {
  const decided = rows.filter((row) => ["blue", "red"].includes(row.predicted));
  const correct = decided.filter(
    (row) => row.predicted === row.expected,
  ).length;
  const confusion = {
    blue: { blue: 0, red: 0, abstain: 0 },
    red: { blue: 0, red: 0, abstain: 0 },
  };
  for (const row of rows)
    confusion[row.expected][
      ["blue", "red"].includes(row.predicted) ? row.predicted : "abstain"
    ] += 1;
  const groups = [...new Set(rows.map((row) => row.video))].map((video) => {
    const group = rows.filter((row) => row.video === video);
    const calls = group.filter((row) =>
      ["blue", "red"].includes(row.predicted),
    );
    return {
      video,
      eligible: group.length,
      decided: calls.length,
      correct: calls.filter((row) => row.predicted === row.expected).length,
      agreement: calls.length
        ? calls.filter((row) => row.predicted === row.expected).length /
          calls.length
        : null,
      coverage: calls.length / group.length,
    };
  });
  const measuredGroups = groups.filter((group) => group.agreement !== null);
  return {
    eligible: rows.length,
    videos: groups.length,
    decided: decided.length,
    abstentions: rows.length - decided.length,
    correct,
    incorrect: decided.length - correct,
    agreement: decided.length ? correct / decided.length : null,
    coverage: rows.length ? decided.length / rows.length : 0,
    agreementInterval95: wilsonInterval(correct, decided.length),
    coverageInterval95: wilsonInterval(decided.length, rows.length),
    macroVideoAgreement: measuredGroups.length
      ? measuredGroups.reduce((sum, group) => sum + group.agreement, 0) /
        measuredGroups.length
      : null,
    confusionMatrix: {
      rows: "expected Kazewa preference",
      columns: "algorithm decision",
      counts: confusion,
    },
    byVideo: groups,
  };
}

export function evaluateGate(summary, thresholds = DEFAULT_GATE) {
  const reasons = [];
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const validRatio = (value) =>
    Number.isFinite(value) && value >= 0 && value <= 1;
  if (
    !thresholds ||
    !validCount(thresholds.minimumCases) ||
    thresholds.minimumCases < 1 ||
    !validCount(thresholds.minimumVideos) ||
    thresholds.minimumVideos < 1 ||
    !validRatio(thresholds.minimumCoverage) ||
    !validRatio(thresholds.minimumAgreement)
  )
    reasons.push("invalid_thresholds");
  if (
    !validCount(summary?.eligible) ||
    summary.eligible < thresholds?.minimumCases
  )
    reasons.push("insufficient_cases");
  if (
    !validCount(summary?.videos) ||
    summary.videos < thresholds?.minimumVideos
  )
    reasons.push("insufficient_videos");
  if (
    !validRatio(summary?.coverage) ||
    summary.coverage < thresholds?.minimumCoverage
  )
    reasons.push("insufficient_coverage");
  if (
    !validRatio(summary?.agreement) ||
    summary.agreement < thresholds?.minimumAgreement
  )
    reasons.push("insufficient_agreement");
  return {
    passed: reasons.length === 0,
    reasons,
    thresholds,
    declaration:
      "Product acceptance thresholds selected for this prototype; these are not thresholds stated by Kazewa. Passing this retrospective gate would still require prospective validation.",
  };
}

export function evaluateBenchmark(
  benchmark,
  knowledge,
  analyzer = analyzeDraft,
  thresholds = benchmark.gate ?? DEFAULT_GATE,
) {
  const predictRows = (cases) =>
    cases.map((record) => {
      // Deliberately construct a new two-field input. Labels, reasons, teams,
      // dates and actual game winners never enter the predictor.
      const prediction = analyzer(
        { blue: { ...record.blue }, red: { ...record.red } },
        knowledge,
      );
      const predicted =
        prediction.status === "complete" &&
        ["blue", "red"].includes(prediction.winner)
          ? prediction.winner
          : null;
      return {
        id: record.id,
        video: record.video,
        expected: record.expected,
        predicted,
        status: prediction.status,
        score: prediction.score ?? null,
        confidence: prediction.confidence ?? null,
        primaryEligible: record.primaryEligible,
        reconstructed: record.reconstructed,
        influenceTags: record.influenceTags,
        actualWinner: record.actualWinner ?? null,
        actualWinnerConflict: record.actualWinnerConflict ?? false,
        overlapsCleanBenchmark: record.overlapsCleanBenchmark ?? false,
      };
    });
  const rows = predictRows(benchmark.cases);
  const primary = summarize(rows.filter((row) => row.primaryEligible));
  const broader = summarize(rows);
  const actualRows = rows.filter((row) =>
    ["blue", "red"].includes(row.actualWinner),
  );
  const actualDecided = actualRows.filter((row) =>
    ["blue", "red"].includes(row.predicted),
  );
  const report = {
    version: "1.0.0",
    evaluatedAt: new Date().toISOString(),
    modelVersion: knowledge.version,
    benchmarkVersion: benchmark.version,
    benchmarkDesign: benchmark.design,
    sourceOverlap: true,
    primary,
    broader,
    gate: evaluateGate(primary, thresholds),
    actualMatchOutcome: {
      separateFromFidelity: true,
      available: actualRows.length,
      excludedConflictingOutcomes: rows.filter(
        (row) => row.actualWinnerConflict,
      ).length,
      decided: actualDecided.length,
      correct: actualDecided.filter((row) => row.predicted === row.actualWinner)
        .length,
      accuracy: actualDecided.length
        ? actualDecided.filter((row) => row.predicted === row.actualWinner)
            .length / actualDecided.length
        : null,
      caveat:
        "Small retrospective subset; neither a calibrated win probability nor evidence that compositions determine match results.",
    },
    limitations: benchmark.limitations,
    cases: rows,
  };
  if (benchmark.exploratoryRaw) {
    const rawRows = predictRows(benchmark.exploratoryRaw.cases);
    report.exploratoryRaw = {
      name: benchmark.exploratoryRaw.name,
      contributesToFidelityGate: false,
      summary: summarize(rawRows),
      outsideCleanBenchmark: summarize(
        rawRows.filter((row) => !row.overlapsCleanBenchmark),
      ),
      audit: benchmark.exploratoryRaw.audit,
      limitations: benchmark.exploratoryRaw.limitations,
      cases: rawRows,
    };
  }
  return report;
}

function printSummary(report) {
  const percent = (value) =>
    value === null ? "non mesurable" : `${(value * 100).toFixed(1)} %`;
  console.log(
    `Primaire : ${report.primary.correct}/${report.primary.decided} accords décidés (${percent(report.primary.agreement)}), couverture ${percent(report.primary.coverage)}, ${report.primary.eligible} cas / ${report.primary.videos} vidéos.`,
  );
  console.log(
    `Élargi : ${report.broader.correct}/${report.broader.decided} accords décidés (${percent(report.broader.agreement)}), couverture ${percent(report.broader.coverage)}, ${report.broader.eligible} cas.`,
  );
  const siteBar =
    report.broader.agreement >= 0.7 &&
    report.broader.coverage >= 0.8 &&
    report.broader.decided >= 57;
  console.log(
    siteBar
      ? "Seuil du site : 70 % atteint sur la cohorte élargie. Publication non bloquée."
      : "Seuil du site : sous 70 % sur la cohorte élargie. Publication non bloquée.",
  );
  if (report.exploratoryRaw)
    console.log(
      `Exploratoire distinct : ${report.exploratoryRaw.summary.correct}/${report.exploratoryRaw.summary.decided} accords décidés (${percent(report.exploratoryRaw.summary.agreement)}), ${report.exploratoryRaw.summary.eligible} cas ; ce chiffre ne remplace pas la cohorte élargie.`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const knowledge = json(path.join(projectRoot, "data", "knowledge.json"));
  const benchmarkFile = path.join(projectRoot, "data", "benchmark.json");
  if (process.argv.includes("--rebuild-benchmark")) {
    const benchmark = buildBenchmark(
      path.resolve(projectRoot, ".."),
      knowledge,
    );
    fs.mkdirSync(path.dirname(benchmarkFile), { recursive: true });
    fs.writeFileSync(benchmarkFile, `${JSON.stringify(benchmark, null, 2)}\n`);
  }
  const benchmark = json(benchmarkFile);
  const report = evaluateBenchmark(benchmark, knowledge);
  report.sourceHashes = Object.fromEntries(
    [
      ["engine", path.join(projectRoot, "src", "engine.mjs")],
      ["knowledge", path.join(projectRoot, "data", "knowledge.json")],
      ["benchmark", benchmarkFile],
    ].map(([name, file]) => [
      name,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );
  fs.writeFileSync(
    path.join(projectRoot, "data", "evaluation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  printSummary(report);
}
