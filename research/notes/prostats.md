# prostats: a professional-game draft win model against Kazewa's verdict

Model: `research/models/prostats.mjs`. Composition only, pick order ignored.

## Result: no usable signal

Delivered variant (recency-weighted tables, no calibration), harness output:

```
node research/run.mjs research/models/prostats.mjs --split all --no-order --permute 200
247 cas, 94 groupes, ordre des picks cache
tous 54.7% (n=247, IC95 48-61) | avec ordre des picks 54.6% (n=194, IC95 48-61) | phase de draft 57.1% (n=182, IC95 50-64) | conf>=2 53.9% (n=178, IC95 47-61) | moitie la plus nette 54.0% (n=124, IC95 45-63) | tranches seulement 54.7% (n=247, IC95 48-61) (couverture 100%)
hasard mesure: moyenne 49.8%, ecart-type 3.1, max 58.3% | reel 54.7% | p=0.090
```

Without `--no-order` the line is identical (the model does not read the order): 54.7% on all, 54.6% on the 194
cases with pick order. Exact values: 135/247 = 0.5465587 and 106/194 = 0.5463918.

54.7% is under the 58% bar, p = 0.090 over 200 redraws, and it is the best of six variants, so the true figure is
lower still. Classification: weak, inside the chance band. It is not a finding.

## What the model is

`prepare` (label-free) fits one sparse ridge logistic regression "blue wins" on the 44,649 professional games:
- `c` champion in a role, `m` lane matchup (same role), `s` duo synergy (10 same-team role pairs),
  `x` cross-lane counter (champion against an enemy in another role);
- two nuisance terms dropped afterwards: one strength per team-split, and the blue side. Without the team term a
  champion is credited with the level of the teams that pick it.

Ridge per family (c 20, m 200, s 600, x 300, team 1) was chosen on a held-out fifth of the professional games, by
winner log-loss, never on a verdict. On those held-out games the draft part alone finds the winner about 55% of the
time, and adds a little to team strength (log-loss about 0.617 with the team and side terms only, 0.608 with the
draft terms; one hold-out fold, indicative). Pair families add very little over champion
strength. A champion-by-season term made the held-out log-loss worse, so tables are global.

Tables are global because a test draft has no date. `recency` reweights the games once (half-life 18 months from
the latest game); it is not a per-patch lookup.

## Variants evaluated on the full data: 6 (all composition only, n=247)

| # | tables | use of verdicts | tous | avec ordre (n=194) |
|---|---|---|---|---|
| 1 | time-agnostic, team-controlled | none | 52.2% | 51.5% |
| 2 | recency-weighted, team-controlled (delivered) | none | 54.7% | 54.6% |
| 3 | time-agnostic, team-controlled | 4 weights, one per family | 51.8% | 51.5% |
| 4 | recency-weighted, team-controlled | 4 weights | 51.0% | 50.0% |
| 5 | time-agnostic, raw (no team term) | none | 51.4% | 52.1% |
| 6 | time-agnostic, raw | 4 weights | 47.4% | 46.4% |

Variants were fixed before the first run on verdicts. The exploration on professional games alone (ridge choice,
season term) does not count: it never touched a verdict.

## Reading

- Calibrating on his verdicts never helps (51.8, 51.0, 47.4): there is no stable direction to learn, not even a sign.
- Removing team strength from the tables changes nothing measurable (52.2 against 51.4).
- This agrees with the 52 to 54% already on record for raw matchup and synergy tables. A better-built win model
  does not move it.
- Expected ceiling: the draft alone finds the real winner about 55% of the time and his preferred side wins 78% of
  the time. If the two were linked only through the result, agreement would be about 0.55*0.78 + 0.45*0.22 = 53%.
  The measured 52 to 55% is what that predicts. His verdict is not a win-probability estimate from compositions.

## Caveats

- The harness reports 247 decided cases, not 249.
- The permutation p is on "tous"; the harness does not compute one for the 194-case subset.
- Any champion is accepted: an unseen champion or pair contributes 0. This is coverage, not accuracy.
