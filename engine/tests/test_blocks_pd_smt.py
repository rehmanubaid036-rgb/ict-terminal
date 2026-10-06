import numpy as np
import pandas as pd
import pytest

from helpers import bars, path, random_walk
from ictengine.indicators.blocks import BEAR, BULL, blocks_at, find_order_blocks, find_rejection_blocks
from ictengine.indicators.common import NONE
from ictengine.indicators.fvg import find_fvgs
from ictengine.indicators.imbalance import find_bprs, find_volume_imbalances
from ictengine.indicators.pd_array import (
    DealingRange, dealing_range_at, fib_levels, institutional_levels, ipda_ranges, nearest_institutional,
    ote_zone, sd_projections,
)
from ictengine.indicators.smt import find_smt
from ictengine.indicators.structure import find_structure
from ictengine.indicators.swings import find_swings

# --- order blocks ------------------------------------------------------------

OB_ROWS = [
    (106.0, 106.5, 105.0, 105.2),  # 0
    (105.2, 107.0, 105.0, 106.8),  # 1 swing high 107 (structure to break)
    (106.8, 106.9, 104.0, 104.3),  # 2
    (104.3, 104.5, 102.5, 102.8),  # 3 last down candle at the low -> bullish OB [102.5, 104.5], MT 103.55
    (102.8, 105.5, 102.7, 105.3),  # 4 up
    (105.3, 107.6, 105.2, 107.4),  # 5 closes above 107 -> structure break (BOS)
    (107.4, 107.8, 106.0, 106.2),  # 6
    (106.2, 106.4, 104.2, 104.4),  # 7 trades into OB high 104.5 -> mitigated
    (104.4, 104.6, 103.0, 103.2),  # 8 closes below MT 103.55
    (103.2, 103.3, 101.8, 102.0),  # 9 closes below OB low 102.5 -> failed
]


def obs_for(rows):
    df = bars(rows)
    sw = find_swings(df, n=1)
    return df, find_order_blocks(df, sw, find_structure(df, sw))


def test_bullish_order_block_lifecycle():
    _, obs = obs_for(OB_ROWS)
    ob = obs[obs.direction == BULL].iloc[0]
    assert (ob.pos, ob.created_pos, ob.high, ob.low) == (3, 5, 104.5, 102.5)
    assert ob.mt == pytest.approx(103.55)
    assert (ob.mitigated_pos, ob.mt_broken_pos, ob.failed_pos) == (7, 8, 9)
    assert ob.block_type == "mitigation"  # its low (102.5) did not sweep an earlier swing low


def test_failed_ob_after_sweep_is_a_breaker():
    prefix = [(103.5, 103.8, 103.2, 103.4), (103.4, 103.5, 102.6, 103.0), (103.0, 103.4, 102.9, 103.2)]
    _, obs = obs_for(prefix + OB_ROWS)  # swing low 102.6 forms first; the OB leg low 102.5 sweeps it
    ob = obs[(obs.direction == BULL) & (obs.low == 102.5)].iloc[0]
    assert bool(ob.swept_prior) and ob.block_type == "breaker"


def test_blocks_at_role_changes_over_time():
    _, obs = obs_for(OB_ROWS)
    bull = obs[obs.direction == BULL]
    assert blocks_at(bull, 4).empty
    assert blocks_at(bull, 8).role.item() == "ob"
    assert blocks_at(bull, 9).role.item() == "mitigation"


def test_bearish_order_block_mirror():
    mirrored = [(200 - o, 200 - lo, 200 - h, 200 - c) for o, h, lo, c in OB_ROWS]
    _, obs = obs_for(mirrored)
    ob = obs[obs.direction == BEAR].iloc[0]
    assert (ob.pos, ob.high, ob.low) == (3, 97.5, 95.5)
    assert (ob.mitigated_pos, ob.mt_broken_pos, ob.failed_pos) == (7, 8, 9)


def test_order_blocks_on_random_data_are_consistent():
    df = random_walk(4000, seed=31)
    sw = find_swings(df, n=1)
    obs = find_order_blocks(df, sw, find_structure(df, sw))
    o, c = df.open.to_numpy(), df.close.to_numpy()
    assert len(obs) > 50
    assert (obs.pos < obs.created_pos).all()
    for r in obs.itertuples():
        seq = [p for p in (r.mitigated_pos, r.failed_pos) if p != NONE]
        assert all(p > r.created_pos for p in seq)
        if r.failed_pos != NONE and r.mitigated_pos != NONE:
            assert r.mitigated_pos <= r.failed_pos


def test_rejection_blocks():
    rows = [(100, 100.5, 99.5, 100.2), (100.2, 104.0, 100.1, 100.6), (100.6, 100.8, 99.0, 99.2)]
    df = bars(rows)
    rb = find_rejection_blocks(df, find_swings(df, n=1))
    r = rb[rb.direction == BEAR].iloc[0]
    assert (r.pos, r.top, r.bottom) == (1, 104.0, 100.6)
    assert r.wick_ratio == pytest.approx(3.4 / 3.9)


# --- premium / discount, fib, projections -------------------------------------

def test_dealing_range_and_checklist_example():
    dr = DealingRange(high=100.0, low=0.0)
    assert dr.equilibrium == 50
    assert dr.zone(32.3) == "discount" and dr.zone(67.16) == "premium" and dr.zone(50) == "equilibrium"
    assert dr.position(32.3) == pytest.approx(0.323)
    with pytest.raises(ValueError):
        DealingRange(1, 2)


def test_fib_levels_bullish_and_bearish():
    up = fib_levels(100, 110)
    assert up[0.0] == 110 and up[1.0] == 100 and up[0.5] == 105
    assert up[0.705] == pytest.approx(102.95) and up[-1.0] == 120 and up[-2.0] == 130
    dn = fib_levels(110, 100)
    assert dn[0.705] == pytest.approx(107.05) and dn[-1.0] == 90
    lo, sweet, hi = ote_zone(100, 110)
    assert (lo, sweet, hi) == pytest.approx((102.1, 102.95, 103.8))
    with pytest.raises(ValueError):
        fib_levels(5, 5)


def test_journal_ote_example():
    # BTC journal: OTE 62-70.5% of a leg; check the zone is ordered and inside the leg
    lo, sweet, hi = ote_zone(64522.7, 64780.0)
    assert 64522.7 < lo < sweet < hi < 64780.0


def test_dealing_range_at_uses_known_swings_only():
    df = path([110, 107, 105, 106.5, 108, 105.5, 103, 104.5, 106, 103.5])
    sw = find_swings(df, n=1)
    assert dealing_range_at(sw, 0) is None
    dr = dealing_range_at(sw, len(df) - 1)
    last_hi = sw[(sw.kind == "high") & (sw.confirmed_pos <= len(df) - 1)].price.iloc[-1]
    last_lo = sw[(sw.kind == "low") & (sw.confirmed_pos <= len(df) - 1)].price.iloc[-1]
    assert (dr.high, dr.low) == (last_hi, last_lo) == (106.0, 103.0)


def test_sd_projections():
    p = sd_projections(110, 100)
    assert p["+1"] == 120 and p["-2"] == 80 and p["+2.5"] == 135 and p["-4"] == 60


def test_institutional_levels_checklist_example():
    lv = institutional_levels(30583, 1000, count=1)
    assert {30000, 30200, 30500, 30800, 31000} <= set(lv)
    assert nearest_institutional(30583, 1000, "above") == 30800
    assert nearest_institutional(30583, 1000, "below") == 30500
    gold = institutional_levels(4466.5, 10, count=0)
    assert gold == [4460.0, 4462.0, 4465.0, 4468.0]


def test_ipda_ranges():
    days = pd.date_range("2025-01-01", periods=70, freq="D")
    lv = pd.DataFrame({"day_high": np.arange(70) + 10.0, "day_low": np.arange(70) * 1.0}, index=days)
    r = ipda_ranges(lv)
    assert np.isnan(r["ipda20_high"].iloc[19])
    assert r["ipda20_high"].iloc[20] == 29.0 and r["ipda20_low"].iloc[20] == 0.0
    assert r["ipda60_high"].iloc[65] == 74.0 and r["ipda60_low"].iloc[65] == 5.0


# --- imbalances --------------------------------------------------------------

def test_volume_imbalance():
    rows = [(100, 101.5, 99.5, 101.0), (101.3, 102.5, 100.9, 102.2)]  # bodies 100-101 and 101.3-102.2
    vi = find_volume_imbalances(bars(rows))
    assert len(vi) == 1 and vi.iloc[0].direction == 1
    assert (vi.iloc[0].bottom, vi.iloc[0].top) == (101.0, 101.3)
    gap_rows = [(100, 101, 99.5, 101.0), (101.6, 102.5, 101.5, 102.2)]  # wicks do not overlap -> not VI
    assert find_volume_imbalances(bars(gap_rows)).empty


def test_bpr_from_opposing_fvgs():
    rows = [
        (100, 101, 99.5, 100.8), (100.8, 104, 100.7, 103.8), (103.8, 105, 103, 104.5),   # bull FVG [101,103]
        (104.5, 104.6, 104.0, 104.2), (104.2, 104.3, 100.5, 100.8), (100.8, 102.0, 100.0, 100.2),  # bear FVG [102,104]
    ]
    f = find_fvgs(bars(rows))
    bpr = find_bprs(f)
    assert len(bpr) >= 1
    b = bpr.iloc[0]
    assert (b.bottom, b.top, b.direction) == (102.0, 103.0, -1)


# --- SMT ---------------------------------------------------------------------

def test_bearish_smt():
    a = path([100, 102, 101, 104, 102, 106, 103, 102])   # higher highs
    b = path([50, 52, 51, 54, 52, 53.5, 52, 51])         # lower high on the second push
    s = find_smt(a, b, find_swings(a, n=1), window=1)
    bear = s[s.direction == -1]
    assert len(bear) == 1
    assert bear.iloc[0].a_new > bear.iloc[0].a_prev and bear.iloc[0].b_new <= bear.iloc[0].b_prev


def test_no_smt_when_both_confirm():
    a = path([100, 102, 101, 104, 102, 106, 103, 102])
    s = find_smt(a, a.copy(), find_swings(a, n=1), window=1)
    assert s.empty


def test_smt_requires_aligned_frames():
    a = path([100, 102, 101, 104])
    b = path([100, 102, 101, 104], start="2025-07-15 15:00")
    with pytest.raises(ValueError):
        find_smt(a, b, find_swings(a, n=1))


def test_order_blocks_no_look_ahead():
    df = random_walk(3000, seed=41)

    def obs(d):
        sw = find_swings(d, n=1)
        return find_order_blocks(d, sw, find_structure(d, sw))

    full = obs(df)
    for k in (700, 1900, 2950):
        a = blocks_at(full, k)
        b = blocks_at(obs(df.iloc[:k + 1]), k)
        cols = ["direction", "pos", "high", "low", "role"]
        pd.testing.assert_frame_equal(a[cols].reset_index(drop=True), b[cols].reset_index(drop=True))


def test_smt_no_look_ahead():
    a = random_walk(2500, seed=51)
    b = random_walk(2500, seed=52)
    full = find_smt(a, b, find_swings(a, n=1))
    for k in (800, 2400):
        pre = find_smt(a.iloc[:k + 1], b.iloc[:k + 1], find_swings(a.iloc[:k + 1], n=1))
        x = full[full.created_pos <= k].drop(columns="time").reset_index(drop=True)
        pd.testing.assert_frame_equal(x, pre.drop(columns="time").reset_index(drop=True))
