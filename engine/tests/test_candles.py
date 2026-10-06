import numpy as np
import pandas as pd
import pytest

from helpers import bars, random_walk
from ictengine.core.candles import CandleError, resample, to_utc, validate


def utc(s):
    return pd.Timestamp(s, tz="UTC")


def test_validate_accepts_good_frame():
    validate(random_walk(100))


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d.drop(columns="low"), "missing columns"),
    (lambda d: d.tz_localize(None), "timezone-aware"),
    (lambda d: d.iloc[::-1], "sorted"),
    (lambda d: pd.concat([d, d.iloc[[0]]]).sort_index(), "duplicate"),
])
def test_validate_rejects_bad_index_or_columns(mutate, message):
    with pytest.raises(CandleError, match=message):
        validate(mutate(random_walk(20)))


def test_validate_rejects_inconsistent_high_low():
    df = bars([(10, 11, 9, 10.5), (10.5, 10.4, 10, 10.2)])  # high below open
    with pytest.raises(CandleError, match="inconsistent"):
        validate(df)


def test_validate_rejects_nan():
    df = bars([(10, 11, 9, 10.5)])
    df.loc[df.index[0], "close"] = np.nan
    with pytest.raises(CandleError, match="NaN"):
        validate(df)


def test_to_utc_requires_explicit_source_zone():
    df = bars([(10, 11, 9, 10.5)]).tz_localize(None)
    with pytest.raises(CandleError):
        to_utc(df)
    out = to_utc(df, "Etc/GMT-3")  # broker server time GMT+3
    assert out.index[0] == utc("2025-07-15 11:00")


def test_resample_5m_values():
    df = bars([(1, 2, 0.5, 1.5), (1.5, 3, 1, 2), (2, 2.5, 1.8, 2.2), (2.2, 2.4, 0.2, 0.3), (0.3, 1, 0.1, 0.9),
               (0.9, 1.1, 0.8, 1.0)], start="2025-07-15 14:00")
    out = resample(df, "5m")
    assert list(out.index) == [utc("2025-07-15 14:00"), utc("2025-07-15 14:05")]
    first = out.iloc[0]
    assert (first.open, first.high, first.low, first.close, first.n_bars) == (1, 3, 0.1, 0.9, 5)
    assert out.iloc[1].n_bars == 1  # still forming


def test_resample_preserves_extremes_on_random_data():
    df = random_walk(3000)
    for tf in ("5m", "15m", "1h", "4h", "1d"):
        out = resample(df, tf)
        assert out.high.max() == df.high.max()
        assert out.low.min() == df.low.min()
        assert out.n_bars.sum() == len(df)
        assert out.open.iloc[0] == df.open.iloc[0] and out.close.iloc[-1] == df.close.iloc[-1]
        validate(out)


@pytest.mark.parametrize("day, expected_utc_hours", [
    ("2025-07-15", [22, 2, 6, 10, 14, 18]),   # EDT: 18:00 NY = 22:00 UTC
    ("2025-01-15", [23, 3, 7, 11, 15, 19]),   # EST: 18:00 NY = 23:00 UTC
])
def test_4h_bars_anchor_at_1800_new_york(day, expected_utc_hours):
    df = random_walk(24 * 60, start=f"{day} 00:00")
    out = resample(df, "4h")
    hours = sorted({t.hour for t in out.index})
    assert hours == sorted(expected_utc_hours)


def test_daily_bar_runs_1800_to_1800_new_york():
    df = random_walk(3 * 24 * 60, start="2025-07-14 00:00")
    out = resample(df, "1d")
    assert utc("2025-07-14 22:00") in out.index    # opens 18:00 EDT
    full = out[out.n_bars == 1440]
    assert len(full) >= 2


def test_weekly_bar_opens_sunday_1800():
    df = random_walk(10 * 24 * 60, start="2025-07-10 00:00")  # Thu .. Sun after next
    out = resample(df, "1w")
    assert utc("2025-07-13 22:00") in out.index  # Sunday 18:00 EDT


def test_resample_across_fall_back_keeps_every_bar():
    df = random_walk(2 * 24 * 60, start="2025-11-01 12:00")  # spans 2025-11-02 DST end
    for tf in ("1h", "4h", "1d"):
        assert resample(df, tf).n_bars.sum() == len(df)
    hourly = resample(df, "1h")
    assert hourly.n_bars.max() == 60  # no hour merged by the repeated 01:00 NY


def test_unknown_timeframe():
    with pytest.raises(CandleError):
        resample(random_walk(10), "7x")
