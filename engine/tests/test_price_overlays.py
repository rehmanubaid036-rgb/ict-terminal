"""Price-based chart layers: premium/discount + OTE, displacement + volume imbalance, SMT."""
import numpy as np
import pandas as pd
import pytest

from helpers import path, random_walk
from ictengine.analysis import Params, analyze, overlays, smt_overlays
from ictengine.indicators.swings import known_at


@pytest.fixture(scope="module")
def a():
    return analyze(random_walk(3000, seed=3))


def test_dealing_range_is_the_latest_known_swing_range(a):
    pos = len(a.df) - 1
    dr = [o for o in overlays(a, include=("pd_ote",)) if o["kind"] == "dealing_range"][0]
    k = known_at(a.swings, pos)
    assert dr["high"] == pytest.approx(k[k["kind"] == "high"]["price"].iloc[-1])
    assert dr["low"] == pytest.approx(k[k["kind"] == "low"]["price"].iloc[-1])
    assert dr["eq"] == pytest.approx((dr["high"] + dr["low"]) / 2)
    span = dr["high"] - dr["low"]
    if dr["direction"] > 0:      # leg up: OTE is 62-79% back down, in discount
        assert dr["ote_top"] == pytest.approx(dr["high"] - 0.62 * span)
        assert dr["ote_bottom"] == pytest.approx(dr["high"] - 0.79 * span)
        assert dr["ote_top"] < dr["eq"]
    else:                        # leg down: OTE is 62-79% back up, in premium
        assert dr["ote_bottom"] == pytest.approx(dr["low"] + 0.62 * span)
        assert dr["ote_top"] == pytest.approx(dr["low"] + 0.79 * span)
        assert dr["ote_bottom"] > dr["eq"]
    assert dr["ote_bottom"] <= dr["ote_sweet"] <= dr["ote_top"]


def test_dealing_range_direction_follows_the_newer_swing():
    # down to a low, then up to a high: a leg up
    up = analyze(path([110, 105, 100, 95, 100, 105, 110, 115, 120, 118, 117, 116]), Params(swing_n=1))
    dr = [o for o in overlays(up, include=("pd_ote",))][0]
    assert dr["direction"] == 1 and dr["high"] > dr["low"]
    down = analyze(path([100, 105, 110, 115, 110, 105, 100, 95, 90, 92, 93, 94]), Params(swing_n=1))
    assert overlays(down, include=("pd_ote",))[0]["direction"] == -1


def test_dealing_range_never_uses_future_swings(a):
    pos = 1200
    dr = overlays(a, pos=pos, include=("pd_ote",))[0]
    k = known_at(a.swings, pos)
    assert dr["high"] == pytest.approx(k[k["kind"] == "high"]["price"].iloc[-1])
    assert dr["t2"] == int(a.df.index[pos].timestamp())


def test_displacement_and_volume_imbalance(a):
    objs = overlays(a, include=("displacement",), lookback_bars=len(a.df))
    marks = [o for o in objs if o["kind"] == "displacement"]
    assert len(marks) == int(np.count_nonzero(a.displacement))
    assert all(m["direction"] in (1, -1) for m in marks)
    vis = [o for o in objs if o["kind"] == "volume_imbalance"]
    assert len(vis) == int((a.volume_imbalances["pos"] >= 1).sum())
    for o in vis:
        assert o["top"] > o["bottom"] and o["t1"] < o["t2"]


def test_smt_bearish_when_partner_fails_to_make_a_higher_high():
    # A: high at 110, pullback, higher high at 112.  B: high at 210, pullback, lower high at 208.
    a_df = path([100, 105, 110, 106, 104, 108, 112, 109, 107, 106, 105, 104])
    b_df = path([200, 205, 210, 206, 204, 206, 208, 205, 203, 202, 201, 200])
    a = analyze(a_df, Params(swing_n=1))
    marks = smt_overlays(a, b_df)
    assert len(marks) == 1 and marks[0]["direction"] == -1 and marks[0]["price"] == pytest.approx(112)
    assert smt_overlays(a, a_df) == []                       # same instrument never diverges
    # the higher high (bar 5) is confirmed by bar 6: hidden at bar 5, shown from bar 6
    assert smt_overlays(a, b_df, pos=5) == []
    assert len(smt_overlays(a, b_df, pos=6)) == 1


def test_smt_needs_shared_bars():
    a = analyze(path(np.linspace(100, 110, 30)))
    other = path(np.linspace(200, 210, 30), start="2030-01-01 00:00")
    assert smt_overlays(a, other) == []
