"""Parameter research for the models, with a strict train / test split.

    python scripts/research.py XAUUSD M1 "entry=ce,near" "min_rr=2,3" --train 2024,2025 --test 2026

Contexts are built once per year (with a 30-day warm-up) and cached as pickles under
data/cache/, so many variants can be evaluated quickly. Every variant is scored on the train
years; only the best few are then run on the test years, which are never used for choosing.
"""
from __future__ import annotations

import itertools
import pickle
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ictengine.backtest.simulator import run, stats  # noqa: E402
from ictengine.context import Context  # noqa: E402
from ictengine.data import mt5 as m5  # noqa: E402
from ictengine.models.registry import MODELS  # noqa: E402
from ictengine.news import blackouts, filter_signals, us_high_impact_history  # noqa: E402

CACHE = Path(__file__).resolve().parents[2] / "data" / "cache"
WARMUP_DAYS = 30


def year_context(symbol: str, year: int, broker: str = "axi_demo") -> Context:
    path = CACHE / f"context_{broker}_{symbol}_{year}.pkl"
    if path.exists():
        with open(path, "rb") as f:
            return pickle.load(f)
    end = min(date(year, 12, 31), date.today() - timedelta(days=1))
    df = m5.load(broker, symbol, date(year, 1, 1) - timedelta(days=WARMUP_DAYS), end)
    t = time.time()
    ctx = Context(symbol, df)
    print(f"  built context {symbol} {year} ({len(df)} bars) in {time.time() - t:.0f}s", flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(ctx, f, protocol=pickle.HIGHEST_PROTOCOL)
    return ctx


def evaluate(symbol: str, model: str, years: list[int], spread: float, **params) -> dict:
    trades = []
    for y in years:
        ctx = year_context(symbol, y)
        live = pd.Timestamp(date(y, 1, 1), tz="UTC")
        sigs = [s for s in MODELS[model].scan(ctx, **params) if s.created_time >= live]
        sigs = filter_signals(sigs, blackouts(us_high_impact_history(date(y, 1, 1), date(y, 12, 31))))
        trades += run(sigs, ctx.base, spread=spread)
    return stats(trades)


def parse_grid(specs: list[str]) -> list[dict]:
    axes = []
    for spec in specs:
        key, vals = spec.split("=", 1)
        axes.append([(key, _cast(v)) for v in vals.split(",")])
    return [dict(combo) for combo in itertools.product(*axes)] if axes else [{}]


def _cast(v: str):
    for f in (int, float):
        try:
            return f(v)
        except ValueError:
            pass
    return {"True": True, "False": False}.get(v, v)


def main():
    args = [a for a in sys.argv[1:]]
    opt = {}
    for name in ("--train", "--test", "--spread", "--top"):
        if name in args:
            i = args.index(name)
            opt[name] = args[i + 1]
            del args[i:i + 2]
    symbol, model, specs = args[0], args[1], args[2:]
    train = [int(y) for y in opt.get("--train", "2024,2025").split(",")]
    test = [int(y) for y in opt.get("--test", "2026").split(",")]
    from ictengine.symbols import spec
    spread = float(opt["--spread"]) if "--spread" in opt else spec(symbol).spread
    top = int(opt.get("--top", 3))
    rows = []
    for params in parse_grid(specs):
        t = time.time()
        st = evaluate(symbol, model, train, spread, **params)
        rows.append({**params, **{k: st.get(k) for k in ("filled", "win_rate", "avg_r", "total_r", "profit_factor",
                                                         "max_drawdown_r")}})
        print(f"train {params}: {st.get('filled', 0)} trades avg {st.get('avg_r', 0):+.3f}R "
              f"total {st.get('total_r', 0):+.1f}R PF {st.get('profit_factor', 0):.2f} ({time.time() - t:.0f}s)", flush=True)
    res = pd.DataFrame(rows).sort_values("avg_r", ascending=False)
    print("\nTRAIN ranking:\n", res.to_string(index=False))
    print("\nTEST (out of sample) for the best", top)
    for _, r in res.head(top).iterrows():
        params = {k: r[k] for k in parse_grid(specs)[0].keys()}
        params = {k: (_cast(str(v)) if not isinstance(v, (int, float, bool)) else v) for k, v in params.items()}
        st = evaluate(symbol, model, test, spread, **params)
        print(f"test {params}: {st.get('filled', 0)} trades win {st.get('win_rate', 0):.0%} avg {st.get('avg_r', 0):+.3f}R "
              f"total {st.get('total_r', 0):+.1f}R PF {st.get('profit_factor', 0):.2f} DD {st.get('max_drawdown_r', 0):.1f}R",
              flush=True)


if __name__ == "__main__":
    main()
