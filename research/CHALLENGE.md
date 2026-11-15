# Challenge: can anything predict Kazewa's draft verdict on a draft he has not judged?

Run from the repository root (Node 24, ES modules, no dependencies).
`data/kazewa-memory.json` holds 259 professional drafts commented by the French coach Kazewa; 249 have a preferred
side. The site answers a judged draft by lookup. The open question is a draft he never judged.

## What is already established (do not redo, try to beat or refute)
All numbers are leave-one-group-out over the 249 decided cases (94 groups = videos and series).
- Chance level of this protocol, measured by redrawing labels: 50% with a standard deviation of about 4 to 6 points.
  Anything under about 58% is not distinguishable from chance.
- Champion profile flags (frontline, engage, scaling... 18 flags, summed per team): 41%. No signal.
- Champion identity (one weight per champion, ridge): 43 to 47%. No signal.
- The site's rule-based structural calculator: 52% on the 182 drafts it was not tuned on. No signal.
- Statistics from 44,654 professional games (lane matchup win rates, duo synergies, raw champion strength): 52 to 54%.
- LLM judges given his method, champion cards, pick order and his most similar earlier verdicts: 26 to 28 of 51.
- Pick order, one weight per lane for "this side locked its champion later": 59.8% on the 194 cases with pick order
  (permutation p about 0.02). This is the only signal found so far. See `research/models/process.mjs`.
- The team he prefers wins the real game in 78% of cases, but a pre-game Elo favourite matches his verdict only 52%.

## Harness (fixed, do not modify `research/harness.mjs` or `research/run.mjs`)
Read the header of `research/harness.mjs`. A model is a module in `research/models/<name>.mjs` exporting
`fit(train, resources, prepared)` returning `{ score(draft, context) }`, and optionally `prepare(resources)`.
- `train` cases: `{ id, group, blue, red, later, label, confidence, timing, reasons, reads, claims }`.
  `claims` are his arguments, structured: `{ tag, favours, champions, role, transferable, detailFr }`.
  `later` is null or `{top,jng,mid,bot,sup}` = side that picked later in that lane.
- `score(draft, context)`: `draft = { blue, red }`, `context = { later }`. Positive = blue preferred.
- `resources.knowledge.champions[name]` = profile flags; `resources.proGames()` = professional games with winners
  (every game Kazewa judged is already removed), each `{ blue, red, order, bans, firstPick, winner, patch, date, league }`.
- Run: `node research/run.mjs research/models/<name>.mjs --split all [--no-order] [--permute 100]`
  `--no-order` hides pick order (composition-only track). `--permute N` measures the chance level for your model.
  Always evaluate with `--split all`.

## Rules
1. Anything learned from verdicts, reasons, reads or claims must be computed from `train` inside `fit`. Never read
   `data/kazewa-memory.json`, `data/memory-site.json` or the corpus from a model. A test case is two compositions and
   a pick order, nothing else: no date, patch, team, result.
2. `prepare` may only use label-free resources (profiles, professional games).
3. Count every variant you evaluate on the full data and report that number. Keep it at 12 or fewer: each extra try
   on 249 cases inflates the best score. Decide your variants from reasoning, not from peeking at per-case results.
4. Final answer: ONE model file, its agreement on both tracks (with order, and `--no-order`), and a permutation run
   with at least 100 redraws for the track you claim. Report the numbers the harness prints, unrounded.
5. Python is allowed for exploration, but the delivered model must be a dependency-free `.mjs` the browser can run
   (plain arithmetic on tables you compute in `fit` / `prepare`).
6. Be honest. "No signal" is a valid and useful result. Do not present a score inside the chance band as a finding.
Write only inside `research/models/` (your model) and `research/notes/<name>.md` (short notes). Do not touch other files.
Do not launch sub-agents.
