"""VSA Models volume features: relative volume classes, time-of-day comparison, candle anatomy, no look-ahead."""
import numpy as np
import pandas as pd

from ictengine.indicators.vsa_volume import HIGH, LOW, ULTRA, VolParams, features


def frame(n=60, vol=100.0, start="2026-07-06 13:00", freq="5min"):
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    c = 100 + np.arange(n) * 0.01
    return pd.DataFrame({"open": c - 0.05, "high": c + 0.1, "low": c - 0.1, "close": c, "volume": np.full(n, vol)}, index=idx)


def test_classes_from_the_bars_before():
    df = frame()
    df.iloc[40, df.columns.get_loc("volume")] = 300.0     # 3x the average -> ultra
    df.iloc[41, df.columns.get_loc("volume")] = 150.0     # 150 / 110 (the 300 bar is in its average) = 1.36x -> high
    df.iloc[42, df.columns.get_loc("volume")] = 50.0      # 0.5x -> low (pink)
    x = features(df, VolParams(days=0))
    assert x["vclass"].iloc[40] == ULTRA
    assert x["vclass"].iloc[41] == HIGH
    assert x["vclass"].iloc[42] == LOW
    assert x["vclass"].iloc[0] == -1                       # no history yet


def test_time_of_day_keeps_a_session_open_from_looking_big():
    # four days of 1h bars; 08:00 NY is always 3x the other hours -> on day 4 it is normal for its time
    idx = pd.date_range("2026-07-06 04:00", periods=24 * 4, freq="1h", tz="UTC")
    v = np.where(idx.tz_convert("America/New_York").hour == 8, 300.0, 100.0)
    c = np.full(len(idx), 100.0)
    df = pd.DataFrame({"open": c, "high": c + 1, "low": c - 1, "close": c + 0.5, "volume": v}, index=idx)
    x = features(df, VolParams(n=10, days=3))
    last8 = np.flatnonzero(idx.tz_convert("America/New_York").hour == 8)[-1]
    assert x["rel_n"].iloc[last8] > 2.5                    # big against the hours before it ...
    assert x["rel"].iloc[last8] < 1.3                      # ... but not against the same hour on earlier days


def test_candle_anatomy():
    df = frame(30)
    # down pin bar: open 100.30, close 100.25, low 99.60, high 100.32 -> lower wick 0.65 of a 0.72 range
    df.iloc[25] = [100.30, 100.32, 99.60, 100.25, 100.0]
    x = features(df)
    assert bool(x["down"].iloc[25]) and bool(x["pin_low"].iloc[25]) and not bool(x["pin_high"].iloc[25])
    assert 0.8 < x["close_loc"].iloc[25] < 1.0


def test_no_look_ahead():
    df = frame(80)
    rng = np.random.default_rng(1)
    df["volume"] = rng.uniform(50, 200, len(df))
    full = features(df)
    cut = features(df.iloc[:50])
    pd.testing.assert_frame_equal(full.iloc[:50], cut)
