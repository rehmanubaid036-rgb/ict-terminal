"""Live engine runner: rescans every symbol with every model on a schedule and stores the signals.

    python -m ictengine.runner --once              # one pass (used by tests / cron)
    python -m ictengine.runner --every 300         # loop forever, every 5 minutes

Each pass loads the last ``lookback_days`` of 1m data (enough for daily structure, IPDA and
the 20-day ranges), builds a Context, runs the models with and without the bias filter, drops
signals in news blackouts and upserts the result into the Store.
"""
from __future__ import annotations

import argparse
import time
import traceback
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable

import pandas as pd

from .context import Context
from .models.registry import MODELS
from .news import blackouts, filter_signals, us_high_impact_history
from .store import Store

Loader = Callable[[str, pd.Timestamp, pd.Timestamp], pd.DataFrame]


@dataclass
class RunnerConfig:
    symbols: tuple[str, ...] = ("XAUUSD", "NAS100", "US500", "XAGUSD", "BTCUSD")
    models: tuple[str, ...] = tuple(MODELS)
    lookback_days: int = 40
    keep_days: int = 10          # only signals newer than this are written each pass
    partners: dict[str, str] = field(default_factory=lambda: {"XAUUSD": "XAGUSD", "NAS100": "US500"})


def primary_broker() -> tuple[str, set[str]]:
    """The main ICT MT5 terminal (<ICT folder>/mt5 first), discovered and registered:
    (broker key, engine symbols it offers). Any broker works; its suffixes are handled."""
    from .data import mt5 as m5
    terminals = m5.ict_terminals()
    if not terminals:
        raise RuntimeError("no MT5 terminal for ICT: install one into <ICT folder>/mt5")
    d = m5.discover(terminals[0])
    key = d["feed"].lower()
    m5.register_broker(key, terminals[0], d["offset"], {n: s["broker"] for n, s in d["symbols"].items()})
    return key, set(d["symbols"])


def mt5_loader(broker: str = "axi_demo") -> Loader:
    from .data import mt5 as m5

    def load(symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        df = m5.load(broker, symbol, start.date(), end.date())
        return df[(df.index >= start) & (df.index < end)]
    return load


def run_once(store: Store, load: Loader, cfg: RunnerConfig = RunnerConfig(), now: pd.Timestamp | None = None) -> dict:
    now = now or pd.Timestamp.now(tz="UTC")
    start = now - pd.Timedelta(days=cfg.lookback_days)
    keep_from = now - pd.Timedelta(days=cfg.keep_days)
    periods = blackouts(us_high_impact_history((start - timedelta(days=1)).date(), (now + timedelta(days=1)).date()))
    summary = {}
    for symbol in cfg.symbols:
        t0 = time.time()
        try:
            df = load(symbol, start, now)
            if len(df) < 2000:
                store.set_status(symbol, None, 0, time.time() - t0, "not enough data")
                summary[symbol] = 0
                continue
            partner = None
            if symbol in cfg.partners:
                p = load(cfg.partners[symbol], start, now)
                partner = p if len(p) else None
            ctx = Context(symbol, df, partner=partner)
            count = 0
            for mid in cfg.models:
                for rb in (True, False):
                    sigs = [s for s in MODELS[mid].scan(ctx, require_bias=rb) if s.created_time >= keep_from]
                    sigs = filter_signals(sigs, periods)
                    count += store.upsert_signals(symbol, mid, sigs, rb)
            store.set_status(symbol, str(df.index[-1]), count, time.time() - t0)
            summary[symbol] = count
        except Exception as e:  # one broken symbol must not stop the others
            store.set_status(symbol, None, 0, time.time() - t0, f"{type(e).__name__}: {e}")
            traceback.print_exc()
            summary[symbol] = -1
    return summary


def main():
    from pathlib import Path

    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / "api" / ".env")  # shared settings (MT5 terminal path)
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--every", type=int, default=300)
    ap.add_argument("--symbols", default="")
    a = ap.parse_args()
    cfg = RunnerConfig()
    if a.symbols:
        cfg.symbols = tuple(a.symbols.split(","))
    while True:   # MT5 may still be starting (VPS logon): keep trying, never exit
        try:
            key, offered = primary_broker()
            break
        except Exception as e:
            print(pd.Timestamp.now(tz="UTC").strftime("%H:%M:%S"), f"MT5 not ready ({type(e).__name__}: {e}); retry in 60 s",
                  flush=True)
            time.sleep(60)
    cfg.symbols = tuple(s for s in cfg.symbols if s in offered)
    cfg.partners = {a: b for a, b in cfg.partners.items() if a in offered and b in offered}
    print(f"engine runner: feed {key.upper()}, symbols {', '.join(cfg.symbols)}", flush=True)
    store, load = Store(), mt5_loader(key)
    while True:
        t = time.time()
        try:
            print(pd.Timestamp.now(tz="UTC").strftime("%H:%M:%S"), run_once(store, load, cfg), f"{time.time() - t:.0f}s", flush=True)
        except Exception as e:   # one bad pass must not stop the runner
            print(pd.Timestamp.now(tz="UTC").strftime("%H:%M:%S"), f"pass failed: {type(e).__name__}: {e}", flush=True)
        if a.once:
            break
        time.sleep(max(5, a.every - (time.time() - t)))


if __name__ == "__main__":
    main()
