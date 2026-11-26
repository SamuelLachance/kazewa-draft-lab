"""Choose the composition-only draft model on 2023-2024, then report 2025-2026 once.

Pre-declared grid (champions only, the variant that does best in the first run):
window 900 / 1500 / 2400 days, half-life 240 / 600 days, C 1/20 / 1/6 / 1/2.
Selection uses the log-loss on the walk-forward predictions of 2023-2024 only.
The 2025-2026 years are reported for the selected setting and for the default,
and were not used to choose.

    python research/draftmodel/sweep_champions.py
"""
import itertools
import json
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0] if "/" in __file__ else ".")
import draft_walkforward as dw  # noqa: E402

GRID = list(itertools.product([900, 1500, 2400], [240, 600], [1 / 20, 1 / 6, 1 / 2]))
DEFAULT = (900, 240, 1 / 6)


def split_metrics(p, y, dates, years):
    in_years = np.isin(np.array([d[:4] for d in dates]), sorted(years))
    ok = ~np.isnan(p) & in_years
    return dw.metrics(p[ok], y[ok])


def main():
    games = dw.load_games()
    dates = [g["date"] for g in games]
    _, _, y = dw.rows(games)
    table = []
    for window, half_life, c_value in GRID:
        p, _, _, _ = dw.walk_forward(games, False, False, window=window, half_life=half_life, c_value=c_value)
        select = split_metrics(p, y, dates, {"2023", "2024"})
        table.append({
            "window": window, "half_life": half_life, "C": round(c_value, 4),
            "select_2023_2024": select,
        })
        print(f"window {window:5d} half-life {half_life:4d} C {c_value:.3f}: "
              f"2023-24 logloss {select['logloss']:.4f} acc {select['accuracy']:.4f}",
              file=sys.stderr)
    best = min(table, key=lambda r: r["select_2023_2024"]["logloss"])
    chosen = (best["window"], best["half_life"], best["C"])
    report = {}
    for label, cfg in [("default", DEFAULT), ("selected", chosen)]:
        p, _, _, _ = dw.walk_forward(games, False, False, window=cfg[0], half_life=cfg[1], c_value=cfg[2])
        report[label] = {
            "window": cfg[0], "half_life": cfg[1], "C": round(cfg[2], 4),
            "held_out_2025_2026": split_metrics(p, y, dates, {"2025", "2026"}),
            "held_out_always_blue": float(np.mean(y[np.isin(np.array([d[:4] for d in dates]), ["2025", "2026"])] == 1)),
        }
    print(json.dumps({"grid": table, "chosen_on_2023_2024": best, "report": report}, indent=1))


if __name__ == "__main__":
    main()
