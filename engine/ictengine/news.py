"""M10 news filter (rulebook M10): no new entries around high-impact news.

Live: events come from the ForexFactory weekly feed (ported from ICC Terminal in Phase 3).
Backtests: ``us_high_impact_history`` rebuilds the main USD events:
  * FOMC statements at 14:00 New York on the Federal Reserve's published meeting dates
  * Non-Farm Payrolls at 08:30 New York on the first Friday of each month (approximation:
    BLS occasionally shifts the release, e.g. around holidays)
CPI is not included in the history (release dates vary); live trading uses the real feed.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time, timedelta

import pandas as pd

from .core.clock import ny_datetime
from .signals import Signal

# second day of each scheduled FOMC meeting (statement day), from the Fed's calendars
FOMC_DATES = [date.fromisoformat(d) for d in (
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
)]


@dataclass(frozen=True)
class NewsEvent:
    time: pd.Timestamp   # UTC
    currency: str
    impact: str          # 'High' | 'Medium' | 'Low'
    title: str


def us_high_impact_history(start: date, end: date) -> list[NewsEvent]:
    out = [NewsEvent(ny_datetime(d, time(14, 0)).tz_convert("UTC"), "USD", "High", "FOMC Statement")
           for d in FOMC_DATES if start <= d <= end]
    m = date(start.year, start.month, 1)
    while m <= end:
        d = m + timedelta(days=(4 - m.weekday()) % 7)  # first Friday
        if start <= d <= end:
            out.append(NewsEvent(ny_datetime(d, time(8, 30)).tz_convert("UTC"), "USD", "High", "Non-Farm Payrolls"))
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return sorted(out, key=lambda e: e.time)


def blackouts(events: list[NewsEvent], before_min: int = 15, after_min: int = 15,
              impacts=("High",), fomc_day_from: time | None = time(14, 0)) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """No-entry periods around events. On FOMC days the rulebook also bans the shock window,
    so the blackout runs from ``before_min`` before 14:00 to the NY session close (16:00)."""
    out = []
    for e in events:
        if e.impact not in impacts:
            continue
        start, end = e.time - pd.Timedelta(minutes=before_min), e.time + pd.Timedelta(minutes=after_min)
        if fomc_day_from is not None and "FOMC" in e.title:
            end = max(end, e.time + pd.Timedelta(hours=2))
        out.append((start, end))
    return out


def filter_signals(signals: list[Signal], periods: list[tuple[pd.Timestamp, pd.Timestamp]]) -> list[Signal]:
    """Drops signals whose live order period [created, expiry] touches a blackout."""
    keep = []
    for s in signals:
        if not any(a <= s.expiry and s.created_time <= b for a, b in periods):
            keep.append(s)
    return keep


def fomc_flat(signals: list[Signal], events: list[NewsEvent], minutes_before: int = 5) -> list[Signal]:
    """Rulebook M10: on an FOMC day every position is closed before the 14:00 statement. A signal
    created before it gets its exit time (and time stop) moved to ``minutes_before`` before 14:00."""
    fomc = [e.time for e in events if "FOMC" in e.title]
    for s in signals:
        for t in fomc:
            flat = t - pd.Timedelta(minutes=minutes_before)
            if s.created_time < flat and (s.exit_by is None or s.exit_by > flat) and t - s.created_time < pd.Timedelta(hours=24):
                s.exit_by = flat
                if s.expiry > flat:              # no fill after the flat time either
                    s.expiry = flat
                if s.time_stop is not None and s.time_stop > flat:
                    s.time_stop = flat
                s.notes["fomc_flat"] = str(flat)
    return signals

