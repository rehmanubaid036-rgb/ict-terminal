import numpy as np
import pandas as pd
import pytest

from helpers import bars, random_walk
from ictengine.indicators.common import NONE
from ictengine.indicators.fvg import BEAR, BULL, active_at, find_fvgs, state_at

# bullish displacement: c1 high 101, c3 low 103 -> BISI [101, 103], CE 102
BULL_ROWS = [
    (100.0, 101.0, 99.5, 100.5),   # 0 c1
    (100.5, 104.0, 100.4, 103.8),  # 1 c2 displacement
    (103.8, 105.0, 103.0, 104.5),  # 2 c3
    (104.5, 104.8, 102.6, 103.0),  # 3 touches (low 102.6 <= top 103)
    (103.0, 103.2, 101.9, 102.4),  # 4 trades to CE 102
    (102.4, 102.5, 100.8, 101.2),  # 5 fills (low 100.8 <= bottom 101), closes inside? 101.2 > 101 -> not inverted
    (101.2, 101.3, 100.0, 100.2),  # 6 closes below 101 -> inverted (IFVG)
]


def test_bullish_fvg_detection_and_lifecycle():
    f = find_fvgs(bars(BULL_ROWS))
    bull = f[f.direction == BULL]
    assert len(bull) == 1
    g = bull.iloc[0]
    assert (g.c1_pos, g.created_pos, g.bottom, g.top, g.ce, g.height) == (0, 2, 101.0, 103.0, 102.0, 2.0)
    assert (g.touched_pos, g.ce_pos, g.filled_pos, g.inverted_pos) == (3, 4, 5, 6)
    assert g.time == bars(BULL_ROWS).index[1]


def test_bearish_fvg_mirror():
    rows = [(200 - o, 200 - lo, 200 - h, 200 - c) for o, h, lo, c in BULL_ROWS]  # mirror prices
    f = find_fvgs(bars(rows))
    bear = f[f.direction == BEAR]
    assert len(bear) == 1
    g = bear.iloc[0]
    assert (g.bottom, g.top, g.ce) == (97.0, 99.0, 98.0)
    assert (g.touched_pos, g.ce_pos, g.filled_pos, g.inverted_pos) == (3, 4, 5, 6)


def test_untouched_gap_has_no_events():
    rows = BULL_ROWS[:3] + [(104.5, 106, 104.2, 105.5), (105.5, 107, 105, 106.5)]
    g = find_fvgs(bars(rows)).iloc[0]
    assert (g.touched_pos, g.ce_pos, g.filled_pos, g.inverted_pos) == (NONE, NONE, NONE, NONE)


def test_overlapping_wicks_are_not_a_gap():
    rows = [(100, 101, 99.5, 100.5), (100.5, 104, 100.4, 103.8), (103.8, 105, 101.0, 104.5)]  # c3 low == c1 high
    assert find_fvgs(bars(rows)).empty


def test_min_size_filters():
    df = bars(BULL_ROWS)
    assert len(find_fvgs(df, min_size=1.9)) >= 1
    assert find_fvgs(df, min_size=2.1)[lambda d: d.direction == BULL].empty
    # ATR is NaN for the first 13 bars, so an ATR filter rejects these early gaps
    assert find_fvgs(df, min_size_atr=0.5).empty


def test_state_and_active_queries_hide_future():
    f = find_fvgs(bars(BULL_ROWS))
    bull = f[f.direction == BULL]
    assert state_at(bull, 1).empty                      # c3 not closed yet
    assert state_at(bull, 2).status.item() == "fresh"
    assert state_at(bull, 3).status.item() == "touched"
    assert state_at(bull, 4).status.item() == "ce"
    assert state_at(bull, 5).status.item() == "filled"
    assert state_at(bull, 6).status.item() == "inverted"
    assert len(active_at(bull, 4, BULL)) == 1 and active_at(bull, 5).empty
    assert active_at(bull, 4, BEAR).empty


def test_random_data_invariants_and_no_look_ahead():
    df = random_walk(4000, seed=21)
    f = find_fvgs(df)
    assert len(f) > 50
    h, lo = df.high.to_numpy(), df.low.to_numpy()
    for r in f.itertuples():
        assert r.top > r.bottom and r.height == pytest.approx(r.top - r.bottom)
        if r.direction == BULL:
            assert r.bottom == h[r.c1_pos] and r.top == lo[r.c1_pos + 2]
        else:
            assert r.top == lo[r.c1_pos] and r.bottom == h[r.c1_pos + 2]
        seq = [p for p in (r.touched_pos, r.ce_pos, r.filled_pos, r.inverted_pos) if p != NONE]
        assert seq == sorted(seq) and all(p > r.created_pos for p in seq)
    # what is visible at bar k does not depend on later bars
    for k in (500, 1999, 3500):
        a = state_at(f, k)[["direction", "c1_pos", "status"]].reset_index(drop=True)
        b = state_at(find_fvgs(df.iloc[:k + 1]), k)[["direction", "c1_pos", "status"]].reset_index(drop=True)
        pd.testing.assert_frame_equal(a, b)


def test_brute_force_detection_matches():
    df = random_walk(1500, seed=4)
    f = find_fvgs(df)
    h, lo = df.high.to_numpy(), df.low.to_numpy()
    expect = sorted([(i, BULL) for i in range(len(df) - 2) if h[i] < lo[i + 2]] +
                    [(i, BEAR) for i in range(len(df) - 2) if lo[i] > h[i + 2]])
    assert sorted(zip(f.c1_pos, f.direction)) == expect


def test_too_short_frame():
    assert find_fvgs(bars(BULL_ROWS[:2])).empty
