# Angle "structure": composition structure. Result: no signal

Model: `research/models/structure.mjs` (dependency-free, composition only, never reads the pick order).

## Question
Do the shape of the two compositions and the structural rules of the site calculator predict the side Kazewa
prefers on a draft he has not judged?

## Features (all label-free)
- `flags`: the 18 profile flags of `knowledge.json`, summed per team, blue minus red.
- `inter`: 14 team-level interactions, antisymmetrised: catch vs immobile, engage vs disengage, frontline with
  sustained damage, scaling with protection, scaling with frontline, poke vs reach, poke with protection,
  dash vs anti-dash, early vs scaling, split with global, burst vs frontline, dps vs frontline, catch with
  follow-up, immobile with protection.
- `engine`: team aggregates published by `analyzeDraft` (frontline depth, effective frontline, sustained dps,
  exposure, immobile carries, win conditions, 7 identities).
- `signal`: ids of the structural rules `analyzeDraft` fires, signed by the side the rule fired on (`subject`).
  The calculator's weights, READING signs and score are ignored.
- `named` (diagnostic only): `named_synergy`, `named_lane_counter` and the reading laws. They were written from
  named statements in the very videos under test, so they are contaminated and excluded from the delivered model.

Weights, scales and neighbours are computed from `train` inside `fit`. Features seen in fewer than 8 training
cases are dropped, the others are divided by their RMS.

## Variants evaluated on the full data: 7 (all decided before the first run)
`node research/run.mjs research/models/structure.mjs --split all --no-order`, 249 cases, 94 groups.
Reproduce a variant with `STRUCTURE_VARIANT=<name>`.

| variant | what | "tous" | "avec ordre" subset |
|---|---|---|---|
| lin-inter | ridge logistic (lambda 100), 14 interactions | 49.4% | 49.0% |
| lin-struct | ridge logistic, flags + inter + engine (45 features) | 46.2% | 44.8% |
| lin-signals | ridge logistic, calculator rule ids (25) | 45.6% | 49.0% |
| lin-all | ridge logistic, everything (70) | 43.0% | 43.8% |
| knn-team | 15 nearest drafts as a pair of team shapes (18 flags each) | 47.8% | 49.5% |
| knn-diff | 15 nearest drafts by cosine in the antisymmetric space | 47.4% | 47.4% |
| lin-named | rule ids + contaminated named rules (diagnostic) | 52.0% | 56.2% |

Nothing reaches 58%. Even the contaminated diagnostic stays at 52%.

## Delivered model: lin-inter (the best clean variant, by the rule fixed beforehand)
`data/kazewa-memory.json` was rewritten by another process during this session (249 decided cases became 247).
The figures on the current file:
- Composition only (`--no-order --permute 100`): 49.4% (n=247, 122/247 = 0.4939271255060729), IC95 43-56.
  Chance: mean 49.7%, sd 4.4, max 58.7%, p = 0.574.
- With order visible: "avec ordre des picks" 50.0% (n=194, exactly 0.5). The model ignores the order.
- Same model on the earlier 249-case file: 49.4%, chance mean 49.9%, sd 4.3, max 57.8%, p = 0.644.
- lin-all on the 249-case file: 43.0%, chance mean 49.6%, sd 4.0, p = 0.931. It is 1.6 sd under chance, which is
  not a result either: it must not be flipped into a predictor after the fact.

## Reading
- Claim: **no_signal**. The delivered model sits on the chance mean, and no variant leaves the chance band.
- Hand-built interactions add nothing to the 18 flags, and the non-linear neighbours do no better than the
  linear model. With 247 cases, structure as described by these profiles does not carry his verdict.
- This agrees with the earlier findings (flags 41%, calculator 52%). The structural calculator of the site
  should not be presented as a predictor of his verdict on a draft he has not judged.
- Caveat: the thresholds of the calculator rules were tuned on about 67 of these drafts, which could only
  have helped `lin-signals`. It did not.
