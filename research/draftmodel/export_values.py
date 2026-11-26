"""Export the composition-only draft values used by the coach (data/draft-values.json).

Final model: champions by role, trained on the games of the 2400 days before
2026-11-22, half-life 240 days, C 0.05 (the setting chosen on 2023-2024 by
sweep_champions.py). No team, no player, no bans, no pick order.

The held-out figures are walk-forward on 2025-2026 with the same setting, and a
paired day-clustered bootstrap compares the model with always predicting blue.

    python research/draftmodel/export_values.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
import draft_walkforward as dw  # noqa: E402

ROOT = dw.ROOT
OUT = ROOT / "data" / "draft-values.json"
WINDOW, HALF_LIFE, C_VALUE = 2400, 240, 0.05
TRAIN_UNTIL = "2026-11-22"


def paired_bootstrap(model_correct, blue_correct, dates, reps=4000, seed=11):
    """CI of (model accuracy - always-blue accuracy), resampling whole days."""
    days = np.unique(dates)
    by_day = {d: np.where(dates == d)[0] for d in days}
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(reps):
        pick = rng.choice(days, size=len(days), replace=True)
        ii = np.concatenate([by_day[d] for d in pick])
        diffs.append(np.mean(model_correct[ii]) - np.mean(blue_correct[ii]))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return float(lo), float(hi)


def held_out(games):
    p, _, dates, y = dw.walk_forward(games, False, False, window=WINDOW, half_life=HALF_LIFE, c_value=C_VALUE)
    years = np.array([d[:4] for d in dates])
    mask = (~np.isnan(p)) & np.isin(years, ["2025", "2026"])
    pm, ym, dm = p[mask], y[mask], dates[mask]
    model_correct = ((pm > 0.5) == ym).astype(float)
    blue_correct = (ym == 1).astype(float)
    lo, hi = paired_bootstrap(model_correct, blue_correct, dm)
    metrics = dw.metrics(pm, ym)
    return {
        "period": "2025-01-01 to 2026-11-13, walk-forward, quarterly refit",
        "n": metrics["n"],
        "accuracy": metrics["accuracy"],
        "logloss": metrics["logloss"],
        "always_blue_accuracy": float(np.mean(ym == 1)),
        "gain_over_always_blue": float(model_correct.mean() - blue_correct.mean()),
        "gain_ci95_by_day": [lo, hi],
    }


def final_fit(games):
    dates = np.array([g["date"] for g in games])
    blue, red, y = dw.rows(games)
    ages = (np.datetime64(TRAIN_UNTIL) - dates.astype("datetime64[D]")).astype(float)
    train = np.where((ages > 0) & (ages <= WINDOW))[0]
    weights = 0.5 ** (ages[train] / HALF_LIFE)
    X, vocab = dw.design([blue[i] for i in train], [red[i] for i in train], False, False)
    model = LogisticRegression(C=C_VALUE, max_iter=1000, fit_intercept=True)
    model.fit(X, y[train], sample_weight=weights)
    values = {}
    for key, j in vocab.items():
        _, role, champion = key
        values.setdefault(role, {})[champion] = round(float(model.coef_[0][j]), 5)
    return values, float(model.intercept_[0]), int(len(train))


def main():
    games = dw.load_games()
    values, intercept, n_train = final_fit(games)
    hold = held_out(games)
    payload = {
        "meaning": "Blue-side logit of each champion in a role, from professional drafts. Only the ten champions and their roles enter; no team, no player, no bans, no pick order.",
        "model": "ridge logistic, antisymmetric champion-by-role features, recency weighted",
        "source": ".cache/oe-games.json (Oracle's Elixir professional games)",
        "trainedUntil": TRAIN_UNTIL,
        "config": {"windowDays": WINDOW, "halfLifeDays": HALF_LIFE, "C": C_VALUE, "trainingGames": n_train},
        "intercept": round(intercept, 5),
        "heldOut": hold,
        "values": values,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in payload.items() if k != "values"}, ensure_ascii=False, indent=1))
    print(f"champions per role: {({r: len(v) for r, v in values.items()})}")


if __name__ == "__main__":
    main()
