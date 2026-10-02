"""Backtests registered models on cached broker data.

    python scripts/backtest.py XAUUSD 2024-01-01 2026-09-30 [M1,M2,...] [--spread 0.3]

Builds one Context per calendar year (with a 30-day warm-up so daily structure and IPDA ranges
exist), runs each model with and without the bias filter, simulates every signal and writes:
  data/backtests/<symbol>_<start>_<end>/trades.csv   one row per signal
  data/backtests/<symbol>_<start>_<end>/summary.csv  stats per model / bias / window / year
"""
from __future__ import annotations

import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ictengine.backtest.simulator import run, stats, trades_frame  # noqa: E402
from ictengine.context import Context  # noqa: E402
from ictengine.data import mt5 as m5  # noqa: E402
from ictengine.models.registry import MODELS  # noqa: E402
from ictengine.news import blackouts, filter_signals, us_high_impact_history  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "data" / "backtests"
WARMUP_DAYS = 30


def backtest(symbol: str, start: date, end: date, model_ids: list[str], spread: float, broker: str = "axi_demo",
             news: bool = True):
    frames = []
    y = start.year
    while y <= end.year:
        y0, y1 = max(start, date(y, 1, 1)), min(end, date(y, 12, 31))
        t = time.time()
        df = m5.load(broker, symbol, y0 - timedelta(days=WARMUP_DAYS), y1)
        ctx = Context(symbol, df)
        print(f"{y}: {len(df)} bars, context {time.time() - t:.0f}s", flush=True)
        live_from = pd.Timestamp(y0, tz="UTC")
        periods = blackouts(us_high_impact_history(y0, y1)) if news else []
        for mid in model_ids:
            for rb in (True, False):
                t = time.time()
                sigs = [s for s in MODELS[mid].scan(ctx, require_bias=rb) if s.created_time >= live_from]
                sigs = filter_signals(sigs, periods)
                trades = run(sigs, df, spread=spread)
                tf = trades_frame(trades)
                if len(tf):
                    tf["bias_filter"] = rb
                    tf["year"] = y
                    frames.append(tf)
                st = stats(trades)
                print(f"  {mid} bias={rb}: {st.get('filled', 0)} trades, win {st.get('win_rate', 0):.0%}, "
                      f"avg {st.get('avg_r', 0):+.2f}R, total {st.get('total_r', 0):+.1f}R, "
                      f"PF {st.get('profit_factor', 0):.2f}, DD {st.get('max_drawdown_r', 0):.1f}R  ({time.time() - t:.0f}s)",
                      flush=True)
        y += 1
    trades = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    folder = OUT / f"{symbol}_{start}_{end}"
    folder.mkdir(parents=True, exist_ok=True)
    trades.to_csv(folder / "trades.csv", index=False)
    summary = summarize(trades)
    summary.to_csv(folder / "summary.csv", index=False)
    print(summary.to_string(index=False))
    print("written to", folder)
    return trades, summary


def summarize(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame()
    rows = []
    groups = [["model", "bias_filter"], ["model", "bias_filter", "window"], ["model", "bias_filter", "year"]]
    for keys in groups:
        for k, g in trades.groupby(keys):
            filled = g[g.status != "expired"]
            r = filled.r
            wins, losses = r[r > 1e-9], r[r < -1e-9]
            eq = r.cumsum()
            rows.append({**dict(zip(keys, k if isinstance(k, tuple) else (k,))),
                         "signals": len(g), "trades": len(filled),
                         "win_rate": round(len(wins) / len(r), 3) if len(r) else None,
                         "avg_r": round(r.mean(), 3) if len(r) else None, "total_r": round(r.sum(), 2),
                         "profit_factor": round(wins.sum() / -losses.sum(), 2) if len(losses) else None,
                         "max_dd_r": round(float((eq.cummax().clip(lower=0) - eq).max()), 2) if len(r) else None})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    from ictengine.symbols import spec
    # default: the symbol's typical retail spread, so results are never flattered by zero costs
    spread = float(sys.argv[sys.argv.index("--spread") + 1]) if "--spread" in sys.argv else None
    if "--spread" in sys.argv:
        args.remove(sys.argv[sys.argv.index("--spread") + 1])
    sym, s, e = args[0], date.fromisoformat(args[1]), date.fromisoformat(args[2])
    spread = spec(sym).spread if spread is None else spread
    print(f"{sym}: spread {spread}", flush=True)
    ids = args[3].split(",") if len(args) > 3 else list(MODELS)
    backtest(sym, s, e, ids, spread, news="--no-news" not in sys.argv)
