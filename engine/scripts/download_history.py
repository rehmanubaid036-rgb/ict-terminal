"""Downloads Dukascopy 1m history into the cache, slowly and resumably.

    python scripts/download_history.py XAUUSD 2025-01-01 2026-09-30

Days already cached are skipped, so the script can be stopped and started again at any time.
Weekends are skipped (no trading). Progress goes to stdout.
"""
from __future__ import annotations

import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ictengine.data import dukascopy as dk  # noqa: E402


def main(symbol: str, start: str, end: str, pause: float = 3.0) -> None:
    d, last = date.fromisoformat(start), date.fromisoformat(end)
    total = (last - d).days + 1
    done = failed = 0
    while d <= last:
        if d.weekday() != 5:  # Saturday has no session (Friday close .. Sunday open)
            try:
                dk.fetch_day(symbol, d, pause=pause, retries=10)
                done += 1
            except dk.DownloadError as e:
                failed += 1
                print(f"{d} FAILED {e}; waiting 5 min", flush=True)
                time.sleep(300)
                continue  # retry the same day
        if d.day == 1 or d == last:
            print(f"{d} ok ({done} days, {failed} retries) of {total}", flush=True)
        d += timedelta(days=1)
    print("finished", flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
