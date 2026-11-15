# Angle "precedent": case-based reasoning on his judged drafts

Model: `research/models/precedent.mjs` (no import, no resource, tables built in `fit` from `train` only).
Delivered configuration: `{ composition: ["claims"], order: "stack", vote: "sign" }`.

## Result in one paragraph
Precedents built from his **verdicts** carry nothing: nearest judged drafts, champion-pair records and exact lane
matchups all land at 48 to 51%. Precedents built from his **arguments** do: re-firing his transferable claims
(the champions an argument cites, on the same relative sides) agrees with his verdict on 63.1% of unseen drafts,
composition only. Pick order as a second vote adds nothing measurable on top of it.

## Final harness numbers (memory file of 18:23:08, 244 decided cases, 94 groups)
- `--split all --no-order`: tous **63.1% (0.6311475409836066, n=244, IC95 57-69)**.
- `--split all`: avec ordre des picks **61.0% (119/195 = 0.6102564102564103, n=195, IC95 54-68)**, tous 59.4%.
  Pick order alone (same per-lane logistic as `process.mjs`) gives 0.6153846153846154 on these 195 and the claims
  vote alone 0.6564102564102564. The stacking is not better than either part.
- Harness permutation, 100 redraws: no-order `moyenne 50.0%, ecart-type 0.0, max 50.0%, reel 63.1%, p=0.010`;
  with order `moyenne 50.2%, ecart-type 4.4, max 60.0%, reel 59.4%, p=0.020`.

## The harness permutation is not a test for this model
`permutationTest` empties `claims` in the redrawn cases, so a claims model scores 0 everywhere: 50.0% with zero
spread, p = 1/101 whatever the model does. I therefore ran a stricter null outside the harness (own script, harness
`evaluate` untouched): each case draws a random sign, and its verdict **and** the side favoured by each of its
arguments are flipped together. Arguments still agree with the verdict inside a case; only the consistency across
cases is destroyed.
- Composition only, final file: null mean 50.1%, sd 3.3, max 59.0% over 300 redraws, real 63.1%, **p = 0.0033**
  (identical when whole groups are flipped together). Bonferroni over the 9 variants: about 0.03.
- Earlier file state (247 cases): real 65.6%, 500 redraws, max 58.7%, p = 0.002.
- With order (stacked model, statistic "avec ordre", earlier file state): null mean 49.2%, sd 5.1, max 60.8% over
  100 redraws, real 66.5%, p = 0.0099. Not redone on the final file, where the real figure is 61.0%, level with
  pick order alone.

## Variants evaluated on the full data: 9 (limit 12)
Leave-one-group-out, agreement on "tous" unless stated. `data/kazewa-memory.json` was rebuilt several times by the
main workflow while I was working (claims enrichment, a few cases added or removed), so the same variants are
shown on the file states I met. All 9 were chosen and run on the first two; only the delivered one was rerun later.

| # | variant | 17:49 (n=247) | 17:54 (n=247) | 18:23 (n=244) |
|---|---|---|---|---|
| 1 | case: nearest judged drafts, idf similarity squared | 47.8% | 47.8% | |
| 2 | pairs: record of every ally pair and enemy pair | 47.8% | 47.8% | |
| 3 | lanes: record of the exact lane matchup (96% coverage) | 51.4% | 51.4% | |
| 4 | **claims**: his transferable arguments re-fired | 63.6% | 65.6% | **63.1%** |
| 5 | claims citing one champion only | 54.7% | 51.8% | |
| 6 | claims citing two champions or more (93% coverage) | 59.9% | 60.5% | |
| 7 | pick order only (avec ordre) | 61.9% | 61.9% | 61.5% |
| 8 | claims + order, stacked on the raw score (avec ordre) | 60.3% | 59.8% | |
| 9 | **claims + order, stacked as a sign vote** (avec ordre) | 61.3% | 66.5% | **61.0%** |

Variant 9 was written after seeing variant 8. Its figure moves by 5 points between file states: that is the real
size of the noise on 195 cases, and the reason not to read 66.5% as a gain.

## How the claims vote works
For each training case and each claim with `transferable: true` whose champions are in the draft, the key is the set
of cited champions split by side (favoured side | other side). A case counts once per key. On a new draft a key
fires when its champions sit on the same relative sides, and votes `size * log((pro+1)/(con+1))`, size = number of
champions tied together. It never reads `label`. Single-champion claims alone are near chance; the signal is in the
arguments that tie two or more champions (synergy, lane answer, matchup), and all sizes together do best.

## Caveats
- 63% is about a quarter of the way from chance to certainty, with a confidence interval of 57 to 69. It cannot
  make the site agree with him on every future draft.
- The signal sits in the cases matched to professional data: 65.6% on the 195 with pick order, 53% on the 49 others.
- The size of the claims score is not a confidence: the clearest half is not more accurate than the rest.
- Trained only on earlier groups (dates used by a diagnostic script, never by the model; 17:54 file): 57.7% on 201
  cases, 59.2% when at least 50 earlier cases exist; trained only on later groups: 57.7%. No hindsight asymmetry,
  but with half the data the figure is lower, so it depends on how many of his arguments are in memory.
- The result depends on the quality of the claim extraction (`favours`, `transferable`, cited champions): the figure
  moved between 63.1% and 65.6% across rebuilds of the memory file.
- Checked on the first file state: no duplicate or near-duplicate draft (8+ shared champions) across groups, and no
  game sits in two groups.
