"""Draft-only winner model on professional games, walk-forward.

Ported from lol-draft-predictor (ml/draftmodel.py, ml/model_v2.py fit_draft,
ml/exp_draft_parts.py), with its constants: a 900-day training window, a 240-day
recency half-life, ridge C = 1/6, matchup and synergy scales 0.55, refit every
quarter. Inputs are the ten champions by role and nothing else: no team, no
player, no bans, no pick order, no patch.

    python research/draftmodel/draft_walkforward.py

Each quarter is predicted by a model fitted only on games before that quarter.
Variants: champion values only, then with lane matchups and synergies.
"""
import json
import sys
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss

ROOT = Path(__file__).resolve().parents[2]
GAMES = ROOT / ".cache" / "oe-games.json"
ROLES = ["top", "jng", "mid", "bot", "sup"]
SYN = [("top", "jng"), ("jng", "mid"), ("mid", "bot"), ("bot", "sup"),
       ("jng", "sup"), ("mid", "sup"), ("jng", "bot")]
WINDOW_DAYS = 900
HALF_LIFE_DAYS = 240
C = 1.0 / 6.0
SCALE_MATCH_SYN = 0.55
START, END = "2023-01-01", "2026-11-22"

VARIANTS = {
    "champions": (False, False),
    "+ lane matchups": (True, False),
    "+ synergies": (False, True),
    "complete": (True, True),
}


def game_keys(blue, red, matchups, synergies):
    """Antisymmetric keys of one draft: blue +1, red -1."""
    out = []
    for r, a, b in zip(ROLES, blue, red):
        out.append((("c", r, a), 1.0))
        out.append((("c", r, b), -1.0))
        if matchups:
            lo, hi = (a, b) if a <= b else (b, a)
            out.append((("m", r, lo, hi), 1.0 if a == lo else -1.0))
    if synergies:
        bi, ri = dict(zip(ROLES, blue)), dict(zip(ROLES, red))
        for r1, r2 in SYN:
            out.append((("s", r1, r2, bi[r1], bi[r2]), 1.0))
            out.append((("s", r1, r2, ri[r1], ri[r2]), -1.0))
    return out


def scale_of(key):
    return 1.0 if key[0] == "c" else SCALE_MATCH_SYN


def design(blue_rows, red_rows, matchups, synergies, vocab=None):
    grow = vocab is None
    vocab = {} if vocab is None else vocab
    ri, ci, vi = [], [], []
    for i, (b, r) in enumerate(zip(blue_rows, red_rows)):
        for key, sign in game_keys(b, r, matchups, synergies):
            j = vocab.get(key)
            if j is None:
                if not grow:
                    continue
                j = vocab[key] = len(vocab)
            ri.append(i)
            ci.append(j)
            vi.append(sign * scale_of(key))
    X = sp.csr_matrix((vi, (ri, ci)), shape=(len(blue_rows), max(len(vocab), 1)))
    return X, vocab


def load_games():
    raw = json.loads(GAMES.read_text(encoding="utf8"))
    games = [g for g in raw
             if g["winner"] in ("blue", "red")
             and all(g["blue"].get(r) for r in ROLES)
             and all(g["red"].get(r) for r in ROLES)]
    for g in games:
        g["date"] = g["date"][:10]
    games.sort(key=lambda g: g["date"])
    return games


def quarters(start, end):
    y, m = int(start[:4]), int(start[5:7])
    stop = np.datetime64(end)
    out = []
    while True:
        a = np.datetime64(f"{y:04d}-{m:02d}-01")
        if a >= stop:
            break
        out.append(str(a))
        m += 3
        if m > 12:
            m -= 12
            y += 1
    return out


def rows(games):
    return ([[g["blue"][r] for r in ROLES] for g in games],
            [[g["red"][r] for r in ROLES] for g in games],
            np.array([1 if g["winner"] == "blue" else 0 for g in games]))


def walk_forward(games, matchups, synergies, window=WINDOW_DAYS, half_life=HALF_LIFE_DAYS, c_value=C):
    dates = np.array([g["date"] for g in games])
    blue, red, y = rows(games)
    preds = np.full(len(games), np.nan)
    prior = np.full(len(games), np.nan)
    for asof in quarters(START, END):
        t_next = str(np.datetime64(asof) + np.timedelta64(92, "D"))
        test = np.where((dates >= asof) & (dates < t_next))[0]
        if not len(test):
            continue
        ages = (np.datetime64(asof) - dates.astype("datetime64[D]")).astype(float)
        train = np.where((ages > 0) & (ages <= window))[0]
        if not len(train):
            continue
        weights = 0.5 ** (ages[train] / half_life)
        X, vocab = design([blue[i] for i in train], [red[i] for i in train], matchups, synergies)
        model = LogisticRegression(C=c_value, max_iter=500, fit_intercept=True)
        model.fit(X, y[train], sample_weight=weights)
        Xt, _ = design([blue[i] for i in test], [red[i] for i in test], matchups, synergies, vocab)
        preds[test] = model.predict_proba(Xt)[:, 1]
        prior[test] = np.average(y[train], weights=weights)
    return preds, prior, dates, y


def metrics(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {
        "n": int(len(y)),
        "accuracy": float(np.mean((p > 0.5) == y)),
        "logloss": float(log_loss(y, p)),
        "brier": float(brier_score_loss(y, p)),
    }


def day_bootstrap(p, y, dates, reps=2000, seed=7):
    days = np.unique(dates)
    rng = np.random.default_rng(seed)
    by_day = {d: np.where(dates == d)[0] for d in days}
    accs = []
    for _ in range(reps):
        pick = rng.choice(days, size=len(days), replace=True)
        ii = np.concatenate([by_day[d] for d in pick])
        accs.append(np.mean((p[ii] > 0.5) == y[ii]))
    lo, hi = np.percentile(accs, [2.5, 97.5])
    return float(lo), float(hi)


def main():
    games = load_games()
    print(f"complete drafts: {len(games)}", file=sys.stderr)
    results = {}
    for name, (matchups, synergies) in VARIANTS.items():
        p, prior, dates, y = walk_forward(games, matchups, synergies)
        ok = ~np.isnan(p)
        pm = p[ok]
        ym = y[ok]
        dm = dates[ok]
        pooled = metrics(pm, ym)
        pooled["ci95_by_day"] = day_bootstrap(pm, ym, dm)
        pooled["always_blue_accuracy"] = float(np.mean(ym == 1))
        by_year = {}
        for year in sorted(set(d[:4] for d in dm)):
            mask = np.array([d[:4] == year for d in dm])
            by_year[year] = {
                "n": int(mask.sum()),
                "accuracy": float(np.mean((pm[mask] > 0.5) == ym[mask])),
                "always_blue": float(np.mean(ym[mask] == 1)),
            }
        results[name] = {"pooled": pooled, "by_year": by_year}
        print(f"{name:18s} acc {pooled['accuracy']:.4f} "
              f"ci {pooled['ci95_by_day'][0]:.4f}-{pooled['ci95_by_day'][1]:.4f} "
              f"logloss {pooled['logloss']:.4f} n {pooled['n']} "
              f"(always blue {pooled['always_blue_accuracy']:.4f})", file=sys.stderr)
    print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
