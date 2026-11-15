# Angle "process" (pick order) - notes

Model: `research/models/process2.mjs` (baseline `process.mjs` left untouched).

## Data warning
`data/kazewa-memory.json` was rewritten by something else while this work was running (17:48-17:49).
Decided cases went from 249 to 247 and a few verdicts changed. Every number below is from the 247-case
version. The baseline `process.mjs`, re-run on that same version, gives 61.9% with order (CHALLENGE.md
says 59.8% on the earlier version). Compare to 61.9%, not 59.8%.

## Delivered model (3 fitted weights)
For each lane, +1 if blue locked later, -1 if red. Lanes are pooled in three blocks:
solo lanes (top + mid), jungle, bot lane (bot + sup). One logistic weight per block, fitted on the
training fold, real pick orders only. Weights on all cases: solo 0.431, jungle 0.291, bot lane 0.004.
Reading: answering the opponent's top, mid or jungle goes with his preference; answering in the bot
lane tells nothing.

When the pick order is unknown, the "later" side of each lane is replaced by a probability taken from
professional games (how often champion A is locked after champion B in that role, falling back on each
champion's mean pick slot). This table is label-free (`prepare`). Checked without any verdict: it finds
the real later side in 67 to 80% of lanes depending on the role.

## Harness numbers (247 cases, 94 groups, `--split all`)
| Track | Line printed by the harness |
|---|---|
| Order visible | tous 61.5% (n=247, IC95 55-67), avec ordre des picks 63.9% (n=194, IC95 57-70) |
| Order visible, 200 redraws | hasard mesure: moyenne 50.2%, ecart-type 5.1, max 59.5%, reel 61.5%, p=0.005 |
| Order hidden (`--no-order`) | tous 54.3% (n=247, IC95 48-60) |
| Order hidden, 200 redraws | hasard mesure: moyenne 49.9%, ecart-type 3.4, max 59.1%, reel 54.3%, p=0.119 |
| Baseline `process.mjs`, order visible | tous 59.3%, avec ordre des picks 61.9% (n=194), 200 redraws p=0.010 |

The permutation p is computed by the harness on "tous" (247), not on the 194 cases alone.

Verdict: with order = signal (63.9% on 194, p=0.005). Composition only = weak (54.3%, above the chance
mean, inside the chance band, p=0.119). The gain over the baseline is 4 cases out of 194 (124 vs 120):
not a demonstrated improvement, just the same signal with fewer parameters.

## Variants evaluated on the full data: 7
All with order visible, figure = "avec ordre des picks" (n=194). Decided before any run.
| # | Variant | Agreement |
|---|---|---|
| 1 | one weight for the number of lanes answered | 57.7% |
| 2 | three blocks (delivered) | 63.9% |
| 3 | three blocks + counter-pick confirmed by pro matchup win rate | 63.9% |
| 4 | three blocks + blind pick is an immobile carry + blind pick is a tank | 60.8% |
| 5 | three blocks + blind pick is a flex champion | 61.3% |
| 6 | three blocks + which side answered three lanes or more | 63.9% |
| 7 | three blocks + confirmed + immobile + tank + flex (7 weights) | 55.2% |

None of the interactions asked for in the brief helps. Champion profile of the blind pick, flex,
confirmation by matchup statistics and the lane count add nothing or cost points; all together they
lose 17 cases. The delivered variant is the base that all the others extend, not a pick among peers,
but 7 tries were made: p=0.005 times 7 is 0.035.

## Caveats
- Map side. Red is preferred in 110 of the 194 cases with order (56.7%), and red usually answers more
  lanes. Part of the signal is that. The model still does better than "always red" (124 vs 110), and
  when it says blue it is right 41 times out of 68 where blue is preferred in 43% of cases.
- The score size means nothing: "moitie la plus nette" is 52.4% with order. The cases where one side
  answers both solo lanes (largest scores) are the least reliable. Use the sign only, never a confidence.
  This was seen in the harness output after the fact and was not chased with more variants.
- On the 53 cases without pick order, imputed order gives 28/53 (52.8%): nothing.
- A 64% agreement on 194 cases is far from "agrees with Kazewa on every future draft". Pick order is a
  small lean, not a predictor of his verdict.
