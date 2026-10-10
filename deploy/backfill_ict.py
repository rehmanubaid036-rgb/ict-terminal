"""Downloads as much MT5 history as the brokers give into ICT's cache (data/mt5/<broker>/<symbol>/...), for
backtests and model testing. Read only: it asks MT5 for candles (copy_rates_range) and never trades.

    backfillict.bat                       every symbol of every ICT MT5, M1 M5 M15 H1, back to 2005
    python deploy/backfill_ict.py --tf H1 --symbols XAUUSD,NAS100 --from 2015

A month already in the cache is skipped, so it can be stopped and started again at any time. For each
symbol / timeframe it walks back month by month and stops after 6 empty months in a row (the start of the
broker's history). Runs beside the ICT services (it opens its own MT5 connection); ICC is never touched.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "api"), str(ROOT / "engine")]

from ictapi.market import MT5Provider  # noqa: E402
from ictengine.data import mt5 as m5  # noqa: E402

TFS = ("H1", "M15", "M5", "M1")
EMPTY_STOP = 6


def months_back(start_year: int):
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    while y >= start_year:
        yield y, m
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)


def cached(key: str, symbol: str, tf: str, y: int, m: int) -> bool:
    folder = m5.DEFAULT_CACHE / key / symbol if tf == "M1" else m5.DEFAULT_CACHE / key / symbol / tf
    return (folder / f"{y:04d}-{m:02d}.pkl").exists()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tf", default=",".join(TFS), help="timeframes, e.g. H1,M15,M5,M1")
    ap.add_argument("--symbols", default="", help="only these symbols, e.g. XAUUSD,NAS100 (empty = all)")
    ap.add_argument("--from", dest="start", type=int, default=2005, help="oldest year to try")
    a = ap.parse_args()
    tfs = [t.strip().upper() for t in a.tf.split(",") if t.strip()]
    only = {s.strip().upper() for s in a.symbols.split(",") if s.strip()}

    print("ICT history backfill: finding the ICT MT5 terminals ...", flush=True)
    prov = MT5Provider()
    syms = prov.symbols()
    if not syms:
        print("No ICT MT5 terminal answered. Start MT5 (oneclickict.bat starts it) and run this again.")
        for t, e in prov.errors.items():
            print("  ", t, e)
        return 1
    pairs = sorted({(prov._broker_key[i.feed], i.symbol) for i in syms.values() if not only or i.symbol in only})
    print(f"{len(pairs)} symbols on {len({k for k, _ in pairs})} terminal(s): {', '.join(s for _, s in pairs)}", flush=True)
    try:
        info = m5._connect(m5.BROKERS[pairs[0][0]]).terminal_info()
        if info is not None and getattr(info, "maxbars", 0) < 1_000_000:
            print(f"NOTE: MT5 'Max bars in chart' is {info.maxbars}. Set it to Unlimited (Tools > Options > Charts) "
                  "and restart MT5 to get the full history.", flush=True)
    except Exception:  # noqa: BLE001 - only a hint
        pass

    t0 = time.time()
    grand = 0
    for key, sym in pairs:
        for tf in tfs:
            got = empty = new = 0
            oldest = ""
            for y, m in months_back(a.start):
                if cached(key, sym, tf, y, m):
                    got += 1
                    empty = 0
                    oldest = f"{y}-{m:02d}"
                    continue
                df = None
                for attempt in range(3):           # MT5 downloads old history from its server on the first ask
                    try:
                        df = m5.fetch_month(key, sym, y, m, timeframe=tf)
                        if len(df) or attempt == 2:
                            break
                    except m5.MT5Error:
                        df = None
                    time.sleep(1.5)
                if df is not None and len(df):
                    got += 1
                    new += 1
                    empty = 0
                    oldest = f"{y}-{m:02d}"
                else:
                    empty += 1
                    if empty >= EMPTY_STOP:
                        break
            grand += new
            print(f"  {sym:<10} {tf:<4} {got:4d} months (from {oldest or '-'}), {new} new", flush=True)
    print(f"Done in {round((time.time() - t0) / 60, 1)} min: {grand} new month files in {m5.DEFAULT_CACHE}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
