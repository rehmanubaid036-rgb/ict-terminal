import numpy as np
import pandas as pd
import pytest

from helpers import bars, path, random_walk
from ictengine.indicators.common import NONE
from ictengine.indicators.liquidity import BSL, SSL, find_pools, raids_at, resting_at
from ictengine.indicators.structure import displacement, find_structure, trend_at
from ictengine.indicators.swings import find_swings

PREAMBLE = [(100.0, 100.5, 99.5, 100.0)] * 20  # flat range: ATR ~1, no swings
SETUP = [
    (100.0, 101.0, 99.8, 100.8),    # 20
    (100.8, 105.0, 100.6, 104.0),   # 21 swing high 105.00
    (104.0, 104.2, 102.0, 102.5),   # 22
    (102.5, 103.0, 101.5, 102.0),   # 23
    (102.0, 105.05, 101.8, 103.0),  # 24 swing high 105.05 -> relative equal highs
    (103.0, 103.5, 102.2, 102.8),   # 25
]


def pools_for(rows):
    df = bars(rows)
    return df, find_pools(df, find_swings(df, n=1), eq_tol_atr=0.1, sweep_close_bars=3)


def test_equal_highs_then_sweep():
    df, pools = pools_for(PREAMBLE + SETUP + [
        (102.8, 106.0, 102.5, 104.5),   # 26 wicks above both highs, closes back below
        (104.5, 104.8, 103.0, 103.2),   # 27
    ])
    eqh = pools[pools.source == "eqh"]
    assert len(eqh) == 1
    e = eqh.iloc[0]
    assert e.price == 105.05 and e.members == (21, 24) and e.created_pos == 25
    assert (e.taken_pos, e.outcome, e.reclaim_pos) == (26, "sweep", 26)
    singles = pools[(pools.side == BSL) & (pools.source == "swing")].set_index("price")
    # the second high (105.05) already poked 0.05 above the first one and closed back below
    assert (singles.loc[105.0, "taken_pos"], singles.loc[105.0, "outcome"]) == (24, "sweep")
    assert (singles.loc[105.05, "taken_pos"], singles.loc[105.05, "outcome"]) == (26, "sweep")
    assert sorted(raids_at(pools, 26).source) == ["eqh", "swing"]


def test_run_when_price_accepts_beyond():
    _, pools = pools_for(PREAMBLE + SETUP + [
        (102.8, 106.0, 102.5, 105.8),
        (105.8, 107.0, 105.5, 106.5),
        (106.5, 107.5, 106.0, 107.0),
    ])
    e = pools[pools.source == "eqh"].iloc[0]
    assert (e.taken_pos, e.outcome, e.reclaim_pos) == (26, "run", NONE)


def test_late_reclaim_within_window_is_still_a_sweep():
    _, pools = pools_for(PREAMBLE + SETUP + [
        (102.8, 106.0, 102.5, 105.6),   # 26 closes above
        (105.6, 105.9, 104.0, 104.2),   # 27 closes back below -> sweep on bar 27
        (104.2, 104.5, 103.0, 103.5),
    ])
    e = pools[pools.source == "eqh"].iloc[0]
    assert (e.outcome, e.reclaim_pos) == ("sweep", 27)


def test_outcome_undecided_at_end_of_data():
    _, pools = pools_for(PREAMBLE + SETUP + [(102.8, 106.0, 102.5, 105.8)])
    e = pools[pools.source == "eqh"].iloc[0]
    assert e.taken_pos == 26 and e.outcome == ""


def test_raided_highs_do_not_cluster():
    rows = PREAMBLE + SETUP[:3] + [(102.5, 105.02, 101.5, 102.0)] + SETUP[4:]  # 23 pokes above 105
    _, pools = pools_for(rows)
    eqh = pools[pools.source == "eqh"]
    assert all(21 not in m or 24 not in m for m in eqh.members)


def test_resting_at_respects_time():
    df, pools = pools_for(PREAMBLE + SETUP + [(102.8, 106.0, 102.5, 104.5), (104.5, 104.8, 103.0, 103.2)])
    assert resting_at(pools, 21, BSL).empty                     # swing at 21 not confirmed yet
    assert 105.0 in resting_at(pools, 22, BSL).price.tolist()
    assert 105.05 not in resting_at(pools, 26, BSL).price.tolist()  # taken on 26


def test_pool_no_look_ahead():
    df = random_walk(3000, seed=8)
    full = find_pools(df, find_swings(df, n=1))
    for k in (400, 1500, 2800):
        pre_df = df.iloc[:k + 1]
        pre = find_pools(pre_df, find_swings(pre_df, n=1))
        a = resting_at(full, k)[["side", "source", "price", "pos"]].reset_index(drop=True)
        b = resting_at(pre, k)[["side", "source", "price", "pos"]].reset_index(drop=True)
        pd.testing.assert_frame_equal(a, b)


def test_ssl_mirror():
    mirrored = [(200 - o, 200 - lo, 200 - h, 200 - c) for o, h, lo, c in
                PREAMBLE + SETUP + [(102.8, 106.0, 102.5, 104.5), (104.5, 104.8, 103.0, 103.2)]]
    _, pools = pools_for(mirrored)
    eql = pools[pools.source == "eql"].iloc[0]
    assert eql.side == SSL and eql.price == pytest.approx(94.95) and eql.outcome == "sweep"


# --- structure

LEGS = [110, 107, 105, 106.5, 108, 105.5, 103, 104.5, 106, 103.5, 101, 104, 107.5, 109]


def test_bos_then_mss_sequence():
    df = path(LEGS)
    st = find_structure(df, find_swings(df, n=1))
    got = list(zip(st.direction, st.kind, st.broken_price))
    assert got == [(-1, "BOS", 105.0), (-1, "BOS", 103.0), (1, "MSS", 106.0)]
    mss = st.iloc[-1]
    assert mss.extreme_price == 101.0
    assert trend_at(st, mss.pos) == 1 and trend_at(st, mss.pos - 1) == -1 and trend_at(st, 0) == 0


def test_displacement_candle_detected_and_flagged():
    rows = PREAMBLE + [(100.0, 100.6, 99.6, 100.3), (100.3, 103.2, 100.2, 103.0)]  # body 2.7 vs ATR ~1
    d = displacement(bars(rows))
    assert d[-1] == 1 and (d[:-1] == 0).all()
    # bearish mirror
    mirrored = [(200 - o, 200 - lo, 200 - h, 200 - c) for o, h, lo, c in rows]
    assert displacement(bars(mirrored))[-1] == -1


def test_wicky_candle_is_not_displacement():
    rows = PREAMBLE + [(100.0, 104.0, 96.0, 102.0)]  # big range, body only 25% of it
    assert displacement(bars(rows))[-1] == 0


def test_mss_with_displacement_flag():
    pre = [(110.0, 110.4, 109.6, 110.0)] * 20
    df = path(LEGS, start="2025-07-15 14:20")
    rows = pre + list(df[["open", "high", "low", "close"]].itertuples(index=False, name=None))
    full = bars(rows)
    st = find_structure(full, find_swings(full, n=1))
    assert st.iloc[-1].kind == "MSS" and bool(st.iloc[-1].displacement)


def test_structure_no_look_ahead():
    df = random_walk(3000, seed=12)
    full = find_structure(df, find_swings(df, n=1))
    for k in (600, 1700, 2900):
        pre_df = df.iloc[:k + 1]
        pre = find_structure(pre_df, find_swings(pre_df, n=1))
        a = full[full.pos <= k].drop(columns="time").reset_index(drop=True)
        pd.testing.assert_frame_equal(a, pre.drop(columns="time").reset_index(drop=True))


def test_mss_alternates_direction():
    df = random_walk(5000, seed=2)
    st = find_structure(df, find_swings(df, n=1))
    d = st.direction.to_numpy()
    kinds = st.kind.to_numpy()
    assert (kinds[1:][d[1:] != d[:-1]] == "MSS").all()
    assert (kinds[1:][d[1:] == d[:-1]] == "BOS").all()
    assert np.all(np.where(d == 1, st.extreme_price <= st.broken_price, st.extreme_price >= st.broken_price))
