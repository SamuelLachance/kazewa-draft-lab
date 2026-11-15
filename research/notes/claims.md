# Angle "claims" (transfer of his own arguments) - notes

Model: `research/models/claims.mjs` (no import, tables built in `fit` from `train` only).
Verdict: **weak**. 59.0% on composition alone, on the edge of the chance band once the choice among
variants is counted. With pick order it does not beat the 5-weight baseline.

## Data warning
`data/kazewa-memory.json` was rewritten by something else at least three times while this work was
running (17:54:46, 18:14:53, 18:23:08; last size 1,864,297 bytes). Between the last two versions the
harness chance statistics are identical (same labels and drafts), so what moved is the claims.
The delivered model, unchanged, scored on composition only:
61.9% (247 cases, 17:54 version), 59.8% (244 cases, 18:14), 59.0% (244 cases, 18:23).
Every number below is from the 18:23 version (244 decided cases, 94 groups, 195 with pick order).
On it the baseline `process.mjs` gives 61.5% with order (n=195).

## What the model does
Each claim `{tag, favours, champions, transferable}` of a training case is placed on the draft it was
made on, and becomes evidence about the champions it names:
- `ally`: two named champions on the same side. + if the claim favours that side (synergy), - otherwise.
- `cross`: one named champion on each side. "A beats B" (lane matchups, answers, counters).
- `verdict`: the side holding the champion is the side he preferred (no claim needed).
- not in the delivered model: `single` (champion sentiment from claims), `lanes` (his pick_order
  arguments per lane), `singleOrder` (champion sentiment split by "locked later / earlier in its lane").
A test draft is scored by the entries that apply: same pair on one side, same pair facing each other.
`role` is not used (a pair counts whatever the lanes). `reads` are not used: each read is the free-text
twin of a claim, and scoring free text would have needed a hand-made word list.

Shrinkage:
- evidence is counted per group, not per claim: the sum inside a video / series is clamped to [-1, 1], so
  a combo repeated over five games of one series is one piece of evidence;
- entry = net / (groups + k), k = 1. One isolated mention is worth 0.5, contradictions cancel, an unseen
  pair is 0;
- only `transferable` claims, and no `players_team` claims;
- the weight of each component is fitted inside `fit` (ridge logistic, no intercept) on out-of-group
  values: each training case is scored with the tables minus its own group. No hand-set weight.
Two heads: composition only (pick order hidden) and components + 5 "locked later" lane features (pick
order given).

## Label-free checks (claims against claims, no verdict)
- Coverage out of group: a test draft has on average 5.2 ally pairs and 4.4 facing pairs already argued
  in another group (at least one for 240 and 239 of 244 drafts). Sparsity is not the blocker.
- Does he repeat himself from one group to another (sign of the evidence vs the other groups)?
  facing pairs 146/213 = 69%, ally pairs 186/272 = 68% (most synergy claims are positive, so about 61%
  is expected from that alone), single champions 858/1437 = 60%, pick_order per lane 77/138 = 56%.
  His matchups repeat; his opinion of a champion taken alone barely does.

## Harness numbers, delivered model (`--split all`, 244 cases, 94 groups)
| Track | Line printed by the harness |
|---|---|
| Composition only (`--no-order`) | tous 59.0% (n=244, IC95 53-65), avec ordre des picks 60.0% (n=195, IC95 53-67), phase de draft 61.1% (n=180, IC95 54-68), conf>=2 58.2% (n=177, IC95 51-65), moitie la plus nette 59.8% (n=122, IC95 51-68) |
| Composition only, `--permute 100` | hasard mesure: moyenne 50.3%, ecart-type 7.8, max 60.2%, reel 59.0%, p=0.040 |
| Order visible | tous 59.0% (n=244, IC95 53-65), avec ordre des picks 60.0% (n=195, IC95 53-67), phase de draft 59.4% (n=180, IC95 52-66), conf>=2 59.3% (n=177, IC95 52-66), moitie la plus nette 63.1% (n=122, IC95 54-71) |
| Order visible, `--permute 100` | hasard mesure: moyenne 50.5%, ecart-type 4.8, max 58.6%, reel 59.0%, p=0.010 |

Unrounded: composition only 144/244 = 0.5902; with order 117/195 = 0.6000.
Fitted weights on all cases (standardised components): ally +0.16, cross +0.38, verdict -0.17.
The verdict weight is negative: a champion that sat on the side he preferred in other series counts
slightly against the side holding it now.

## The harness permutation is not a fair test for this angle
`permutationTest` redraws the labels and empties `claims`. For this model that removes `ally` and `cross`
entirely: the redraws only measure the `verdict` component. So I also ran a mirror null that keeps the
claims: for a random half of the groups, the verdict and the direction of every claim are flipped together
(arguments stay coherent with the verdict inside a case, only the link across groups is broken).

| Null, composition only | mean | sd | 95th pct | max | real | p |
|---|---|---|---|---|---|---|
| Harness `--permute 100` (claims emptied) | 50.3% | 7.8 | - | 60.2% | 59.0% | 0.040 |
| Mirror by group, delivered model, 100 redraws | 49.6% | 5.1 | 56.6% | 59.4% | 59.0% | 0.0198 |
| Mirror by group, best of the 10 composition variants, 100 redraws | 55.0% | 2.5 | 59.0% | 61.9% | 59.4% (best variant) | 0.0495 |
| same null, against the delivered model | 55.0% | 2.5 | 59.0% | 61.9% | 59.0% | 0.079 |

The last two lines are the ones that matter: the delivered model was picked among the variants I tried, so
its score must be compared with the best-of-10 obtained by chance. Picking the best of 10 lifts the chance
level from 50% to 55.0%, with a 95th percentile at 59.0%. The delivered model sits exactly on that
percentile. That is the edge of the chance band, not outside it.
(Variants 5 and 6 share the same composition head, hence 10 composition variants for 11 variants. On the
17:54 data version the same test gave 61.9% against a best-of-10 null of 55.0%, p=0.0198: the result moved
by three points when the claims were re-extracted.)
With order, mirror by group, 100 redraws, on the 195 drafts: mean 49.2%, sd 5.3, max 61.5%, real 60.0%,
p=0.0198. That only says the order head beats chance, which the baseline already does at 61.5%.

## Variants evaluated on the full data: 11
Variants 1 to 5 were fixed before any score. 6 and 7 came after seeing 1 to 5, 8 to 10 are ablations of 7,
11 is a shrinkage check. No per-case result was looked at.
| # | Variant | Composition only, tous (n=244) | With order (n=195) |
|---|---|---|---|
| 1 | single + ally + cross, stacked | 59.0% | 62.1% |
| 2 | same, fixed weights 0.5 / 1 / 1 | 57.0% | 59.0% |
| 3 | ally + cross | 58.4% | 59.5% |
| 4 | as 1, all claims (transferable or not) | 57.0% | 59.5% |
| 5 | single + ally + cross + verdict | 57.4% | 58.5% |
| 6 | as 5, order head + lanes + singleOrder | 57.4% | 62.6% |
| 7 | ally + cross + verdict (delivered) | 59.0% | 60.0% |
| 8 | cross alone | 57.6% | 63.1% |
| 9 | ally alone | 53.7% | 59.5% |
| 10 | verdict alone | 53.3% | 61.0% |
| 11 | as 7, k = 3 | 59.4% | 57.9% |
Baseline `process.mjs` with order: 61.5% (n=195).
Variant 7 was chosen on the 17:54 data version, where it was 61.9% and the others 53 to 59%.

## Reading
- Composition only: every variant is above 50% (53 to 59%), on every data version. The direction is
  steady, the size is not: 57 to 59% for anything that contains `cross`, which is where the chance band
  ends. `cross` (his "A beats B" arguments) is the component that carries it: 57.6% alone, the highest
  fitted weight. `ally` alone and `verdict` alone are at chance.
- With pick order the claims add nothing: the variants land between 57.9% and 63.1%, around the 61.5% of
  the baseline. If matchup claims and pick order were two independent signals the sum would beat each;
  it does not. The likely reading: "A beats B" is mostly the trace of the counter-pick, the same
  information as pick order, recovered without knowing the order.
- Caveats: best of 11 variants; the score depends on how the claims were extracted (three points between
  two extractions); `cross` and `ally` can also carry "this team keeps drafting this pair and he keeps
  liking this team", which would not hold on other teams; the sealed 30% of groups was not kept aside
  (the rules ask for `--split all`).
- Whatever the label, 59% means about 4 unseen drafts in 10 judged against him. This model does not make
  the site agree with him on drafts he has not judged.
