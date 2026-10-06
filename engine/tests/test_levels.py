from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from helpers import random_walk
from ictengine.core import clock
from ictengine.core.levels import daily_levels


@pytest.fixture(scope="module")
def data():
    # Sunday 2025-07-13 18:00 EDT (22:00 UTC) .. following Monday: one full week + 1 day
    df = random_walk(8 * 24 * 60 + 600, start="2025-07-13 22:00", seed=11)
    # drop the weekend like a CFD/futures feed (Fri 17:00 NY .. Sun 18:00 NY)
    ny = df.index.tz_convert(clock.NY)
    weekend = ((ny.dayofweek == 4) & (ny.hour >= 17)) | (ny.dayofweek == 5) | ((ny.dayofweek == 6) & (ny.hour < 18))
    return df[~weekend]


@pytest.fixture(scope="module")
def lv(data):
    return daily_levels(data)


def _reference(df):
    """Slow per-bar reference implementation used to cross-check the vectorised one."""
    rows = {}
    for ts, r in df.iterrows():
        d = clock.trading_day(ts)
        rec = rows.setdefault(d, {"h": -np.inf, "l": np.inf, "asian_h": -np.inf, "asian_l": np.inf,
                                  "cbdr_h": -np.inf, "cbdr_l": np.inf, "mo": np.nan})
        rec["h"] = max(rec["h"], r.high)
        rec["l"] = min(rec["l"], r.low)
        local = ts.tz_convert(clock.NY)
        if clock.get_window("asian_range").contains(ts):
            rec["asian_h"] = max(rec["asian_h"], r.high)
            rec["asian_l"] = min(rec["asian_l"], r.low)
        if local.hour == 0 and local.minute == 0:
            rec["mo"] = r.open
        if clock.get_window("cbdr").contains(ts):
            target = local.date() + timedelta(days=1)
            t = rows.setdefault(target, {"h": -np.inf, "l": np.inf, "asian_h": -np.inf, "asian_l": np.inf,
                                         "cbdr_h": -np.inf, "cbdr_l": np.inf, "mo": np.nan})
            t["cbdr_h"] = max(t["cbdr_h"], r.high)
            t["cbdr_l"] = min(t["cbdr_l"], r.low)
    return rows


def test_matches_slow_reference(data, lv):
    ref = _reference(data)
    for day, row in lv.iterrows():
        r = ref[day.date()]
        assert row.day_high == r["h"] and row.day_low == r["l"]
        if np.isfinite(r["asian_h"]):
            assert row.asian_range_high == r["asian_h"] and row.asian_range_low == r["asian_l"]
        if not np.isnan(r["mo"]):
            assert row.midnight_open == r["mo"]
        if np.isfinite(r["cbdr_h"]):
            assert row.cbdr_high == r["cbdr_h"] and row.cbdr_low == r["cbdr_l"]


def test_trading_days_are_weekdays_only(lv):
    assert list(lv.index.dayofweek) == [0, 1, 2, 3, 4, 0, 1]


def test_midnight_open_is_open_of_0000_ny_bar(data, lv):
    t = pd.Timestamp("2025-07-15 04:00", tz="UTC")  # 00:00 EDT
    assert lv.loc["2025-07-15", "midnight_open"] == data.loc[t, "open"]
    assert lv.loc["2025-07-15", "ny_true_open"] == data.loc[pd.Timestamp("2025-07-15 11:30", tz="UTC"), "open"]
    assert lv.loc["2025-07-15", "asia_true_open"] == data.loc[pd.Timestamp("2025-07-14 23:30", tz="UTC"), "open"]


def test_previous_day_and_week(lv):
    assert lv["pdh"].iloc[1] == lv["day_high"].iloc[0]
    assert lv["pdl"].iloc[3] == lv["day_low"].iloc[2]
    assert np.isnan(lv["pwh"].iloc[0])
    first_week = lv.iloc[:5]
    assert lv["pwh"].iloc[5] == first_week["day_high"].max()
    assert lv["pwl"].iloc[6] == first_week["day_low"].min()


def test_session_ranges_inside_day_range(lv):
    for s in ("asia", "london", "ny_am", "ny_pm", "asian_range"):
        valid = lv[f"{s}_high"].notna()
        assert (lv.loc[valid, f"{s}_high"] <= lv.loc[valid, "day_high"]).all()
        assert (lv.loc[valid, f"{s}_low"] >= lv.loc[valid, "day_low"]).all()


def test_gaps(data, lv):
    # NDOG on Tuesday: Monday's last close vs Tuesday's first open
    mon_close = data[data.index < pd.Timestamp("2025-07-14 22:00", tz="UTC")].close.iloc[-1]
    tue_open = data.loc[pd.Timestamp("2025-07-14 22:00", tz="UTC"), "open"]
    assert lv.loc["2025-07-15", "ndog_high"] == max(mon_close, tue_open)
    assert lv.loc["2025-07-15", "ndog_low"] == min(mon_close, tue_open)
    # NWOG only on the first day of the second week (Monday 2025-07-21)
    assert lv["nwog_high"].notna().tolist() == [False] * 5 + [True, False]
    fri_close = lv.loc["2025-07-18", "day_close"]
    assert lv.loc["2025-07-21", "nwog_low"] == min(fri_close, lv.loc["2025-07-21", "day_open"])


def test_opening_range_gap(data, lv):
    prev_rth = data[(data.index < pd.Timestamp("2025-07-14 20:15", tz="UTC"))].close.iloc[-1]  # 16:14 EDT bar
    open_930 = data.loc[pd.Timestamp("2025-07-15 13:30", tz="UTC"), "open"]
    row = lv.loc["2025-07-15"]
    assert row.org_high == max(prev_rth, open_930) and row.org_low == min(prev_rth, open_930)
    assert row.org_ce == pytest.approx((row.org_high + row.org_low) / 2)


def test_empty_frame():
    assert daily_levels(random_walk(5).iloc[:0]).empty
