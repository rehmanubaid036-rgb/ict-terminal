import numpy as np
import pandas as pd
import pytest

from helpers import bars, random_walk
from ictengine.indicators.common import NONE, atr, first_true
from ictengine.indicators.swings import INTERMEDIATE, LONG, find_swings, known_at


def hl_bars(highs, lows):
    rows = [(min(h, max(lo, (h + lo) / 2)), h, lo, (h + lo) / 2) for h, lo in zip(highs, lows)]
    return bars(rows)


def test_basic_swing_highs_and_lows():
    highs = [1, 3, 2, 5, 4, 6, 2]
    lows = [0, 2, 1, 3, 0.5, 4, 1]
    sw = find_swings(hl_bars(highs, lows), n=1)
    assert sw[sw.kind == "high"].pos.tolist() == [1, 3, 5]
    assert sw[sw.kind == "low"].pos.tolist() == [2, 4]
    assert sw[sw.kind == "high"].confirmed_pos.tolist() == [2, 4, 6]
    assert sw.loc[(sw.kind == "low") & (sw.pos == 4), "price"].item() == 0.5


def test_equal_high_plateau_marks_first_bar_only():
    sw = find_swings(hl_bars([1, 3, 3, 1, 0.5], [0, 2, 2, 0, 0]), n=1)
    assert sw[sw.kind == "high"].pos.tolist() == [1]


def test_wider_fractal():
    highs = [1, 2, 5, 3, 4, 2, 1]
    lows = [0] * 7
    assert find_swings(hl_bars(highs, lows), n=1)[lambda d: d.kind == "high"].pos.tolist() == [2, 4]
    assert find_swings(hl_bars(highs, lows), n=2)[lambda d: d.kind == "high"].pos.tolist() == [2]


def test_intermediate_and_long_term_highs():
    # ST highs 3, 5, 4, 7, 6, 4.5, 5.5, 5, 2 -> IT at 5, 7, 5.5 -> LT at 7
    st = [3, 5, 4, 7, 6, 4.5, 5.5, 5, 2]
    highs, lows = [], []
    for p in st:
        highs += [0.5, p]  # a valley bar between every swing
        lows += [0, 0.4]
    highs.append(0.5)
    lows.append(0)
    sw = find_swings(hl_bars(highs, lows), n=1)
    h = sw[sw.kind == "high"].reset_index(drop=True)
    assert h.price.tolist() == st
    assert h.level.tolist() == [1, INTERMEDIATE, 1, LONG, 1, 1, INTERMEDIATE, 1, 1]
    assert h.loc[1, "it_confirmed_pos"] == h.loc[2, "confirmed_pos"]
    # LT is known when the IT on its right (5.5) is known, i.e. when the ST after 5.5 confirms
    assert h.loc[3, "lt_confirmed_pos"] == h.loc[6, "it_confirmed_pos"] == h.loc[7, "confirmed_pos"]
    assert h.loc[0, "it_confirmed_pos"] == NONE


def test_known_at_hides_unconfirmed_swings():
    sw = find_swings(hl_bars([1, 3, 2, 5, 4, 6, 2], [0] * 7), n=1)
    assert known_at(sw, 2)[lambda d: d.kind == "high"].pos.tolist() == [1]
    assert known_at(sw, 1).empty


@pytest.mark.parametrize("n", [1, 2, 3])
def test_no_look_ahead(n):
    """Swings visible at bar k must be identical whether or not later bars exist."""
    df = random_walk(1500, seed=3)
    full = find_swings(df, n=n)
    for k in (50, 333, 777, 1200):
        prefix = find_swings(df.iloc[:k + 1], n=n)
        for level in (1, INTERMEDIATE, LONG):
            a = known_at(full, k, level)[["kind", "pos", "price"]].reset_index(drop=True)
            b = known_at(prefix, k, level)[["kind", "pos", "price"]].reset_index(drop=True)
            pd.testing.assert_frame_equal(a, b)


def test_swing_levels_are_consistent_on_random_data():
    sw = find_swings(random_walk(4000, seed=5), n=1)
    assert (sw.confirmed_pos == sw.pos + 1).all()
    it = sw[sw.level >= INTERMEDIATE]
    assert (it.it_confirmed_pos > it.confirmed_pos).all()
    lt = sw[sw.level == LONG]
    assert len(lt) > 0 and (lt.lt_confirmed_pos >= lt.it_confirmed_pos).all()
    # highs and lows alternate often but a price is always the bar's extreme
    df = random_walk(4000, seed=5)
    hi = sw[sw.kind == "high"]
    assert np.allclose(hi.price.to_numpy(), df.high.to_numpy()[hi.pos.to_numpy()])


def test_atr_matches_manual_wilder():
    df = random_walk(60, seed=9)
    a = atr(df, 14)
    h, lo, c = df.high.to_numpy(), df.low.to_numpy(), df.close.to_numpy()
    tr = [h[0] - lo[0]] + [max(h[i] - lo[i], abs(h[i] - c[i - 1]), abs(lo[i] - c[i - 1])) for i in range(1, 60)]
    manual = np.mean(tr[:14])
    assert np.isnan(a[12]) and a[13] == pytest.approx(manual)
    for i in range(14, 60):
        manual = (manual * 13 + tr[i]) / 14
    assert a[-1] == pytest.approx(manual)


def test_first_true():
    m = np.zeros(5000, bool)
    m[4321] = True
    assert first_true(m, 0) == 4321
    assert first_true(m, 4322) == NONE
    assert first_true(m, 4321) == 4321
