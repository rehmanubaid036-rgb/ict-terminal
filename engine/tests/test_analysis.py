import json

import pytest

from helpers import random_walk
from ictengine.analysis import Params, analyze, overlays


@pytest.fixture(scope="module")
def result():
    return analyze(random_walk(3000, seed=61))


def test_analyze_runs_every_indicator(result):
    # volume imbalances need body gaps; a random walk opens at the previous close, so it has none
    for name in ("swings", "structure", "fvgs", "pools", "order_blocks", "rejection_blocks", "bprs"):
        assert len(getattr(result, name)) > 0, name
    assert list(result.volume_imbalances.columns) == ["direction", "pos", "time", "bottom", "top"]
    assert len(result.displacement) == len(result.df)


def test_params_per_timeframe():
    assert Params.for_timeframe("1m").swing_n == 1
    assert Params.for_timeframe("15m").swing_n == 2
    assert Params.for_timeframe("4h", eq_tol_atr=0.2).eq_tol_atr == 0.2


def test_overlays_are_json_ready_and_time_ordered(result):
    objs = overlays(result)
    json.dumps(objs)  # must serialise
    kinds = {o["kind"] for o in objs}
    assert {"fvg", "liquidity", "structure", "order_block"} <= kinds
    for o in objs:
        assert o["t1"] <= o["t2"]
        if o["type"] == "box":
            assert o["top"] > o["bottom"]


def test_overlays_hide_the_future(result):
    pos = 1500
    last_t = int(result.df.index[pos].timestamp())
    for o in overlays(result, pos=pos):
        assert o["t2"] <= last_t


def test_overlay_status_values(result):
    objs = overlays(result, pos=2000)
    assert {o["status"] for o in objs if o["kind"] == "fvg"} <= {"fresh", "touched", "ce", "filled", "inverted"}
    assert {o["status"] for o in objs if o["kind"] == "liquidity"} <= {"resting", "sweep", "run", "taken"}


def test_overlays_bad_position(result):
    with pytest.raises(IndexError):
        overlays(result, pos=len(result.df))


def test_overlay_times_are_epoch_seconds_for_any_index_unit():
    df = random_walk(400, seed=62)
    for unit in ("s", "ms", "us", "ns"):
        d = df.copy()
        d.index = d.index.as_unit(unit)
        objs = overlays(analyze(d))
        first_bar = int(df.index[0].timestamp())
        assert objs and all(o["t1"] >= first_bar for o in objs)
        assert all(o["t2"] <= int(df.index[-1].timestamp()) for o in objs)
