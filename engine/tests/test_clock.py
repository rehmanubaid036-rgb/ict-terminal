from datetime import date, time

import pandas as pd
import pytest

from ictengine.core import clock
from ictengine.core.clock import (
    QUARTERS, SESSIONS, active_windows, get_window, session_of, trading_day, trading_days, window_labels,
)


def ts(s):  # UTC timestamp
    return pd.Timestamp(s, tz="UTC")


# --- DST: 14:00 UTC is 10:00 NY in summer (EDT) and 09:00 NY in winter (EST)

def test_silver_bullet_follows_new_york_dst():
    sb = get_window("ny_am_sb")
    assert sb.contains(ts("2025-07-15 14:00"))       # 10:00 EDT
    assert not sb.contains(ts("2025-01-15 14:00"))   # 09:00 EST
    assert sb.contains(ts("2025-01-15 15:00"))       # 10:00 EST
    assert not sb.contains(ts("2025-07-15 15:00"))   # 11:00 EDT, end is exclusive


def test_window_bounds_in_summer_and_winter():
    sb = get_window("ny_am_sb")
    assert sb.bounds(date(2025, 7, 15)) == (ts("2025-07-15 14:00"), ts("2025-07-15 15:00"))
    assert sb.bounds(date(2025, 1, 15)) == (ts("2025-01-15 15:00"), ts("2025-01-15 16:00"))


def test_dst_switch_days():
    # 2025-03-09 US clocks jump forward, 2025-11-02 they fall back
    sb = get_window("ny_am_sb")
    assert sb.bounds(date(2025, 3, 9))[0] == ts("2025-03-09 14:00")
    assert sb.bounds(date(2025, 3, 7))[0] == ts("2025-03-07 15:00")
    assert sb.bounds(date(2025, 11, 3))[0] == ts("2025-11-03 15:00")


# --- windows that cross midnight belong to the evening before the trading day

def test_asia_session_starts_the_evening_before():
    asia = get_window("asia")
    start, end = asia.bounds(date(2025, 7, 15))
    assert start == ts("2025-07-14 22:00")  # 18:00 EDT on the 14th
    assert end == ts("2025-07-15 04:00")    # 00:00 EDT on the 15th
    assert asia.crosses_midnight and asia.duration_min == 360


def test_cbdr_and_asian_range_bounds():
    cbdr = get_window("cbdr")
    assert cbdr.bounds(date(2025, 7, 15)) == (ts("2025-07-14 18:00"), ts("2025-07-15 00:00"))
    ar = get_window("asian_range")
    assert ar.bounds(date(2025, 7, 15)) == (ts("2025-07-15 00:00"), ts("2025-07-15 04:00"))


def test_trading_day_rolls_at_1800_new_york():
    assert trading_day(ts("2025-07-14 21:59")) == date(2025, 7, 14)  # 17:59 NY
    assert trading_day(ts("2025-07-14 22:00")) == date(2025, 7, 15)  # 18:00 NY
    idx = pd.DatetimeIndex([ts("2025-07-14 21:59"), ts("2025-07-14 22:00"), ts("2025-07-15 03:59")])
    assert [str(d) for d in trading_days(idx)] == ["2025-07-14", "2025-07-15", "2025-07-15"]


def test_naive_timestamps_are_rejected():
    with pytest.raises(ValueError):
        trading_day(pd.Timestamp("2025-07-14 22:00"))


# --- quarters (rulebook 1.2)

def test_sixteen_quarters_with_true_opens():
    assert len(QUARTERS) == 16
    q2_starts = {q.key: q.start for q in QUARTERS if q.key.endswith("_q2")}
    assert q2_starts == {"asia_q2": time(19, 30), "london_q2": time(1, 30),
                         "ny_am_q2": time(7, 30), "ny_pm_q2": time(13, 30)}


def test_quarters_tile_the_whole_day_without_overlap():
    minutes = [0] * 1440
    for q in QUARTERS:
        for m in range(1440):
            minutes[m] += q.contains_minute(m)
    assert set(minutes) == {1}


def test_sessions_tile_the_whole_day():
    for m in range(1440):
        assert sum(s.contains_minute(m) for s in SESSIONS) == 1


def test_asia_q4_crosses_midnight_and_starts_previous_evening():
    q4 = get_window("asia_q4")
    assert q4.crosses_midnight
    assert q4.bounds(date(2025, 7, 15)) == (ts("2025-07-15 02:30"), ts("2025-07-15 04:00"))
    lq1 = get_window("london_q1")
    assert lq1.bounds(date(2025, 7, 15))[0] == ts("2025-07-15 04:00")


# --- lookups

def test_active_windows_at_1000_new_york():
    keys = active_windows(ts("2025-07-15 14:00"))
    assert {"ny_am", "ny_am_sb", "ny_am_macro_2", "london_close_kz", "ny_am_q3"} <= set(keys)
    assert session_of(ts("2025-07-15 14:00")) == "ny_am"
    assert session_of(ts("2025-07-15 03:00")) == "asia"   # 23:00 NY


def test_window_labels_vectorised():
    idx = pd.date_range(ts("2025-07-15 13:58"), periods=4, freq="1min")  # 09:58..10:01 NY
    assert list(window_labels(idx, "silver_bullet")) == ["", "", "ny_am_sb", "ny_am_sb"]


def test_unknown_window_key():
    with pytest.raises(KeyError):
        get_window("tokyo")


def test_every_window_key_is_unique():
    keys = [w.key for w in clock.ALL_WINDOWS]
    assert len(keys) == len(set(keys))
