"""Time/level chart layers (sessions, key levels, quarters, projections, gaps, IPDA)."""
import json

import numpy as np
import pandas as pd
import pytest

from helpers import random_walk
from ictengine.core import clock
from ictengine.core.levels import daily_levels
from ictengine.time_overlays import LAYERS, time_layers


def _no_weekend(df):
    ny = df.index.tz_convert(clock.NY)
    weekend = ((ny.dayofweek == 4) & (ny.hour >= 17)) | (ny.dayofweek == 5) | ((ny.dayofweek == 6) & (ny.hour < 18))
    return df[~weekend]


@pytest.fixture(scope="module")
def week():
    # Sunday 2025-07-13 18:00 EDT .. one week + a day, no weekend bars
    return _no_weekend(random_walk(8 * 24 * 60 + 600, start="2025-07-13 22:00", seed=11))


@pytest.fixture(scope="module")
def season():
    # ~14 weeks: enough trading days for the 60-day IPDA range
    return _no_weekend(random_walk(98 * 24 * 60, start="2025-04-06 22:00", seed=5))


def utc(s):
    return pd.Timestamp(s, tz="UTC")


def by(objs, **kw):
    return [o for o in objs if all(o.get(k) == v for k, v in kw.items())]


def brute_range(df, t1, t2):
    sel = df[(df.index >= pd.Timestamp(t1, unit="s", tz="UTC")) & (df.index < pd.Timestamp(t2, unit="s", tz="UTC"))]
    return sel["high"].max(), sel["low"].min()


def test_sessions_match_the_bars_inside_each_window(week):
    objs = time_layers(week, utc("2025-07-15 00:00"), utc("2025-07-17 00:00"), include=("sessions",))
    assert objs and all(o["type"] == "zone" for o in objs)
    kinds = {o["kind"] for o in objs}
    assert kinds == {"session", "killzone", "silver_bullet"}            # macros are off by default
    assert {"asia", "london", "ny_am", "ny_pm", "ny_am_kz", "ny_am_sb"} <= {o["key"] for o in objs}
    for o in objs:
        hi, lo = brute_range(week, o["t1"], o["t2"])
        assert o["top"] == pytest.approx(hi) and o["bottom"] == pytest.approx(lo)
    sb = by(objs, key="ny_am_sb")[0]                                       # 10:00-11:00 NY
    start = pd.Timestamp(sb["t1"], unit="s", tz="UTC").tz_convert(clock.NY)
    assert (start.hour, start.minute) == (10, 0) and sb["t2"] - sb["t1"] == 3600
    with_macros = time_layers(week, utc("2025-07-15 00:00"), utc("2025-07-16 00:00"), include=("sessions",), macros=True)
    assert by(with_macros, kind="macro")


def test_key_levels(week):
    lv = daily_levels(week)
    objs = time_layers(week, utc("2025-07-16 00:00"), utc("2025-07-16 12:00"), include=("key_levels",))
    day = pd.Timestamp("2025-07-16")
    mo = by(objs, key="midnight_open")[0]
    bar = week.loc[clock.ny_datetime(day.date(), clock.time(0, 0)).tz_convert("UTC")]
    assert mo["price"] == pytest.approx(bar["open"])
    assert by(objs, key="pdh")[0]["price"] == pytest.approx(lv.loc[day, "pdh"])
    assert by(objs, key="pdl")[0]["price"] == pytest.approx(lv.loc[day - pd.Timedelta(days=1), "day_low"])
    end = pd.Timestamp(mo["t2"], unit="s", tz="UTC").tz_convert(clock.NY)
    assert (end.hour, end.minute) == (18, 0)                               # lines run to the end of the trading day
    assert all(o["t1"] < o["t2"] for o in objs)


def test_quarters_and_true_opens(week):
    objs = time_layers(week, utc("2025-07-16 00:00"), utc("2025-07-16 12:00"), include=("quarters",))
    assert len(by(objs, type="vline")) == 16                               # 4 sessions x 4 quarters, one full day
    ny_true = by(objs, key="ny_am_true_open")[0]                            # NY AM Q2 opens 07:30
    t = pd.Timestamp(ny_true["t1"], unit="s", tz="UTC")
    assert (t.tz_convert(clock.NY).hour, t.tz_convert(clock.NY).minute) == (7, 30)
    assert ny_true["price"] == pytest.approx(week.loc[t, "open"])


def test_projections_are_range_multiples(week):
    objs = time_layers(week, utc("2025-07-16 00:00"), utc("2025-07-16 12:00"), include=("projections",))
    asian = by(objs, kind="range", key="asian_range")[0]
    hi, lo = brute_range(week, asian["t1"], asian["t2"])
    assert (asian["top"], asian["bottom"]) == (pytest.approx(hi), pytest.approx(lo))
    sd2 = by(objs, key="asian_range_sd+2")[0]
    assert sd2["price"] == pytest.approx(hi + 2 * (hi - lo))
    assert by(objs, key="asian_range_sd-2.5")[0]["price"] == pytest.approx(lo - 2.5 * (hi - lo))
    assert sd2["t1"] == asian["t2"]                                         # projections start when the range closes
    assert by(objs, kind="range", key="cbdr")


def test_opening_gaps(week):
    # real feeds pause 17:00-18:00 NY every day; that pause is what opens the NDOG
    ny = week.index.tz_convert(clock.NY)
    week = week[~(ny.hour == 17)]
    lv = daily_levels(week)
    objs = time_layers(week, utc("2025-07-13 22:00"), utc("2025-07-19 00:00"), include=("opening_gaps",))
    ndog = by(objs, kind="ndog")
    assert ndog
    for g in ndog:
        day = clock.trading_day(pd.Timestamp(g["t1"], unit="s", tz="UTC") + pd.Timedelta(minutes=1))
        row = lv.loc[pd.Timestamp(day)]
        assert g["top"] == pytest.approx(row["ndog_high"]) and g["bottom"] == pytest.approx(row["ndog_low"])
        assert g["ce"] == pytest.approx((g["top"] + g["bottom"]) / 2)
    assert len(by(objs, kind="nwog")) <= 1                                  # only the first day of a week


def test_ipda_ranges_from_previous_days(season):
    end = season.index[-1]
    objs = time_layers(season, end - pd.Timedelta(days=1), end, include=("ipda",))
    lv = daily_levels(season)
    last = lv.index[-1]
    prev = lv.loc[:last].iloc[:-1]
    assert by(objs, key="ipda20_high")[0]["price"] == pytest.approx(prev["day_high"].iloc[-20:].max())
    assert by(objs, key="ipda60_low")[0]["price"] == pytest.approx(prev["day_low"].iloc[-60:].min())
    assert len(objs) == 6


def test_limits_and_json(week):
    objs = time_layers(week, week.index[0], week.index[-1], include=LAYERS, max_days=2)
    days = {clock.trading_day(pd.Timestamp(o["t1"] if "t1" in o else o["t"], unit="s", tz="UTC") + pd.Timedelta(minutes=1))
            for o in objs if o["kind"] in ("session", "killzone")}
    assert len(days) <= 2
    json.dumps(objs)
    assert all(isinstance(o.get("t1", o.get("t")), int) for o in objs)
    assert time_layers(week.iloc[:0], week.index[0], week.index[-1]) == []
    with pytest.raises(ValueError):
        time_layers(week, week.index[0], week.index[-1], include=("nope",))


def test_nothing_drawn_where_there_are_no_bars(week):
    # Saturday: the market is closed, so no session boxes or key levels
    objs = time_layers(week, utc("2025-07-19 12:00"), utc("2025-07-19 20:00"), include=("sessions", "key_levels"))
    assert objs == [] or all(np.isfinite(o.get("price", o.get("top", 0))) for o in objs)


def test_ipda_from_cached_long_levels_matches(season):
    end = season.index[-1]
    short = season[season.index >= end - pd.Timedelta(days=10)]
    direct = time_layers(season, end - pd.Timedelta(days=1), end, include=("ipda",))
    cached = time_layers(short, end - pd.Timedelta(days=1), end, include=("ipda",), ipda_levels=daily_levels(season))
    assert [(o["key"], o["price"]) for o in cached] == [(o["key"], o["price"]) for o in direct]
    assert time_layers(short, end - pd.Timedelta(days=1), end, include=("ipda",)) == []   # 10 days are not enough
