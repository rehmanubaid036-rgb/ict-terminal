"""New York time engine: trading day, sessions, quarters, killzones, Silver Bullet windows,
macros, session ranges and reference opens (rulebook section 1).

Every window is defined in NY wall-clock time, so DST is handled by ``zoneinfo``.
The trading day starts at 18:00 NY: a bar at 19:00 on Monday belongs to Tuesday's
trading day, which is when the Asia session of Tuesday runs.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

NY = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

TRADING_DAY_START = time(18, 0)
_DAY_START_MIN = TRADING_DAY_START.hour * 60 + TRADING_DAY_START.minute


def _minutes(t: time) -> int:
    return t.hour * 60 + t.minute


@dataclass(frozen=True)
class TimeWindow:
    """A daily NY-time window [start, end). ``end`` before ``start`` means it crosses midnight.

    ``start_offset_days`` says on which calendar day, relative to the trading day's date,
    the window starts. It defaults to -1 for windows that start at/after 18:00 (they run
    on the evening before) and 0 otherwise.
    """

    key: str
    label: str
    kind: str
    start: time
    end: time
    start_offset_days: int | None = None

    @property
    def start_min(self) -> int:
        return _minutes(self.start)

    @property
    def end_min(self) -> int:
        return _minutes(self.end)

    @property
    def crosses_midnight(self) -> bool:
        return self.end_min <= self.start_min

    @property
    def duration_min(self) -> int:
        return (self.end_min - self.start_min) % 1440 or 1440

    @property
    def offset_days(self) -> int:
        if self.start_offset_days is not None:
            return self.start_offset_days
        return -1 if self.start_min >= _DAY_START_MIN else 0

    def contains_minute(self, minute_of_day: int) -> bool:
        if self.crosses_midnight:
            return minute_of_day >= self.start_min or minute_of_day < self.end_min
        return self.start_min <= minute_of_day < self.end_min

    def contains(self, ts: datetime | pd.Timestamp) -> bool:
        local = to_ny(ts)
        return self.contains_minute(local.hour * 60 + local.minute)

    def bounds(self, trading_day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
        """Concrete [start, end) of this window for ``trading_day``, as UTC timestamps."""
        start_day = trading_day + timedelta(days=self.offset_days)
        start = ny_datetime(start_day, self.start)
        end_day = start_day + timedelta(days=1 if self.crosses_midnight else 0)
        end = ny_datetime(end_day, self.end)
        return start.tz_convert(UTC), end.tz_convert(UTC)

    def mask(self, index: pd.DatetimeIndex) -> np.ndarray:
        """Boolean array: which bar open times fall inside the window."""
        mod = minute_of_day(index)
        if self.crosses_midnight:
            return (mod >= self.start_min) | (mod < self.end_min)
        return (mod >= self.start_min) & (mod < self.end_min)


def _w(key, label, kind, start, end, offset=None) -> TimeWindow:
    h1, m1 = map(int, start.split(":"))
    h2, m2 = map(int, end.split(":"))
    return TimeWindow(key, label, kind, time(h1, m1), time(h2, m2), offset)


# Rulebook 1.1 - the four sessions of the trading day (Quarterly Theory)
SESSIONS: tuple[TimeWindow, ...] = (
    _w("asia", "Asia", "session", "18:00", "00:00"),
    _w("london", "London", "session", "00:00", "06:00"),
    _w("ny_am", "New York AM", "session", "06:00", "12:00"),
    _w("ny_pm", "New York PM", "session", "12:00", "18:00"),
)


def _quarters() -> tuple[TimeWindow, ...]:
    out = []
    for s in SESSIONS:
        for q in range(4):
            start = (s.start_min + 90 * q) % 1440
            end = (start + 90) % 1440
            out.append(TimeWindow(
                f"{s.key}_q{q + 1}", f"{s.label} Q{q + 1}", "quarter",
                time(start // 60, start % 60), time(end // 60, end % 60),
                s.offset_days if start >= s.start_min else s.offset_days + 1))
    return tuple(out)


# Rulebook 1.2 - 90 minute quarters; Q2 open is the session True Open
QUARTERS: tuple[TimeWindow, ...] = _quarters()

# Rulebook 1.3
KILLZONES: tuple[TimeWindow, ...] = (
    _w("asian_kz", "Asian Killzone", "killzone", "20:00", "00:00"),
    _w("london_kz", "London Killzone", "killzone", "02:00", "05:00"),
    _w("ny_am_kz", "New York AM Killzone", "killzone", "07:00", "10:00"),
    _w("london_close_kz", "London Close Killzone", "killzone", "10:00", "12:00"),
    _w("ny_pm_kz", "New York PM Killzone", "killzone", "13:30", "16:00"),
)

# Rulebook 1.4
SILVER_BULLETS: tuple[TimeWindow, ...] = (
    _w("london_sb", "London Silver Bullet", "silver_bullet", "03:00", "04:00"),
    _w("ny_am_sb", "NY AM Silver Bullet", "silver_bullet", "10:00", "11:00"),
    _w("ny_pm_sb", "NY PM Silver Bullet", "silver_bullet", "14:00", "15:00"),
)

# Rulebook 1.5
MACROS: tuple[TimeWindow, ...] = (
    _w("london_macro_1", "London Macro 1", "macro", "02:33", "03:00"),
    _w("london_macro_2", "London Macro 2", "macro", "04:03", "04:30"),
    _w("ny_am_macro_1", "NY AM Macro 1", "macro", "08:50", "09:10"),
    _w("ny_open_macro", "NY Open Macro", "macro", "09:30", "09:50"),
    _w("ny_am_macro_2", "NY AM Macro 2", "macro", "09:50", "10:10"),
    _w("ny_am_macro_3", "NY AM Macro 3", "macro", "10:50", "11:10"),
    _w("ny_lunch_macro", "NY Lunch Macro", "macro", "11:50", "12:10"),
    _w("ny_pm_macro", "NY PM Macro", "macro", "13:10", "13:40"),
    _w("ny_last_hour_macro", "NY Last Hour Macro", "macro", "15:15", "15:45"),
)

# Rulebook 1.6 - ranges that later sessions use as liquidity / projections
RANGES: tuple[TimeWindow, ...] = (
    _w("asian_range", "Asian Range", "range", "20:00", "00:00"),
    # CBDR runs 14:00-20:00 on the evening before the trading day it is used for
    _w("cbdr", "Central Bank Dealers Range", "range", "14:00", "20:00", offset=-1),
)

ALL_WINDOWS: tuple[TimeWindow, ...] = SESSIONS + QUARTERS + KILLZONES + SILVER_BULLETS + MACROS + RANGES
WINDOWS: dict[str, TimeWindow] = {w.key: w for w in ALL_WINDOWS}


@dataclass(frozen=True)
class ReferenceOpen:
    key: str
    label: str
    at: time
    start_offset_days: int = 0


# Rulebook 1.6 - opening prices the engine marks every trading day
REFERENCE_OPENS: tuple[ReferenceOpen, ...] = (
    ReferenceOpen("day_open", "Trading Day Open (18:00)", time(18, 0), -1),
    ReferenceOpen("asia_true_open", "Asia True Open (19:30)", time(19, 30), -1),
    ReferenceOpen("midnight_open", "Midnight Open", time(0, 0)),
    ReferenceOpen("london_true_open", "London True Open (01:30)", time(1, 30)),
    ReferenceOpen("ny_true_open", "NY True Open (07:30)", time(7, 30)),
    ReferenceOpen("open_0830", "08:30 Open", time(8, 30)),
    ReferenceOpen("open_0930", "09:30 Equities Open", time(9, 30)),
    ReferenceOpen("pm_true_open", "PM True Open (13:30)", time(13, 30)),
)


def get_window(key: str) -> TimeWindow:
    try:
        return WINDOWS[key]
    except KeyError:
        raise KeyError(f"unknown time window {key!r}; known: {sorted(WINDOWS)}") from None


def to_ny(ts: datetime | pd.Timestamp) -> pd.Timestamp:
    ts = pd.Timestamp(ts)
    if ts.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware (UTC or broker time converted to UTC)")
    return ts.tz_convert(NY)


def ny_datetime(day: date, at: time) -> pd.Timestamp:
    """NY wall-clock time on ``day``. A time skipped by the spring DST jump moves forward."""
    naive = pd.Timestamp(datetime.combine(day, at))
    return naive.tz_localize(NY, nonexistent="shift_forward", ambiguous=False)


def minute_of_day(index: pd.DatetimeIndex) -> np.ndarray:
    local = _ny_index(index)
    return (local.hour * 60 + local.minute).to_numpy()


def trading_day(ts: datetime | pd.Timestamp) -> date:
    local = to_ny(ts)
    day = local.date()
    return day + timedelta(days=1) if local.hour * 60 + local.minute >= _DAY_START_MIN else day


def trading_days(index: pd.DatetimeIndex) -> np.ndarray:
    """Trading day (datetime64[D]) for every bar of ``index``."""
    local = _ny_index(index)
    days = local.normalize().tz_localize(None).to_numpy().astype("datetime64[D]")
    after_start = (local.hour * 60 + local.minute).to_numpy() >= _DAY_START_MIN
    return days + after_start.astype("timedelta64[D]")


def active_windows(ts: datetime | pd.Timestamp, kinds: tuple[str, ...] | None = None) -> list[str]:
    """Keys of every window that contains ``ts`` (optionally only of the given kinds)."""
    local = to_ny(ts)
    mod = local.hour * 60 + local.minute
    return [w.key for w in ALL_WINDOWS if (kinds is None or w.kind in kinds) and w.contains_minute(mod)]


def session_of(ts: datetime | pd.Timestamp) -> str:
    return active_windows(ts, ("session",))[0]


def window_labels(index: pd.DatetimeIndex, kind: str) -> np.ndarray:
    """For each bar, the key of the window of ``kind`` it falls in, or '' if none."""
    out = np.full(len(index), "", dtype=object)
    for w in ALL_WINDOWS:
        if w.kind == kind:
            m = w.mask(index)
            out[m & (out == "")] = w.key
    return out


def _ny_index(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if not isinstance(index, pd.DatetimeIndex):
        raise TypeError("expected a DatetimeIndex")
    if index.tz is None:
        raise ValueError("index must be timezone-aware")
    return index.tz_convert(NY)
