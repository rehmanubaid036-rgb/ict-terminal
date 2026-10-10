"""M19 VSA Engulf Hybrid EA: the EA's rules on engine frames, gold only, no future data."""
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from helpers import bars
from ictengine.context import Context
from ictengine.data.dukascopy import parse_bi5
from ictengine.models import vsa_engulf_ea as ea
from ictengine.models.registry import MODELS

DATA = Path(__file__).parent / "data"


def gold_1m(days=(date(2026, 9, 2), date(2026, 9, 3))):
    return pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])


def synthetic(n=1500, seed=3):
    """1m gold-like candles with volume: a slow uptrend with pullbacks so engulfs happen."""
    rng = np.random.default_rng(seed)
    close = 3300 + np.cumsum(rng.normal(0.02, 0.6, n))
    open_ = np.r_[close[0], close[:-1]]
    rows = [(o, max(o, c) + abs(rng.normal(0, 0.3)), min(o, c) - abs(rng.normal(0, 0.3)), c) for o, c in zip(open_, close)]
    df = bars(rows, start="2025-07-14 00:00")
    df["volume"] = rng.integers(50, 400, n).astype(float)
    return df


def test_registered_as_custom_model():
    assert MODELS["M19"].source == "VSA"
    assert MODELS["M19"].scan is ea.scan_m19


def test_gold_only_and_needs_volume():
    df = synthetic()
    assert ea.scan(Context("NAS100", df), require_bias=False) == []
    assert ea.scan(Context("XAUUSD", df.drop(columns="volume")), require_bias=False) == []


def test_pip_is_the_mt5_pip():
    assert ea.pip(Context("XAUUSD", synthetic(300))) == pytest.approx(0.01)   # 2-digit gold: 240 pips = 2.40


def test_signals_follow_the_ea_rules():
    ctx = Context("XAUUSD", synthetic(4000))
    sigs = ea.scan(ctx, require_bias=False, EnableTrendAlignmentMultiTF=False, EnableSwingCheck=False)
    assert sigs, "the synthetic walk should produce engulf / imbalance entries"
    buf = 240 * 0.01
    for s in sigs:
        tf = s.window
        frame = ctx.frames[tf]
        p = frame.index.get_indexer([ctx.bucket(tf, ctx.pos_of(s.created_time))])[0]
        bar1, bar2 = frame.iloc[p], frame.iloc[p - 1]
        assert s.model in (f"M19_{c}" for cs in ea.COMMENTS.values() for c in cs)
        assert s.entry == pytest.approx(bar1.close)
        if s.direction == 1:
            assert bar1.close > bar1.open and bar2.close < bar2.open
            assert s.stop == pytest.approx(bar1.low - buf)
            if s.checklist["engulf"]:
                assert bar1.close > bar2.high
        else:
            assert bar1.close < bar1.open and bar2.close > bar2.open
            assert s.stop == pytest.approx(bar1.high + buf)
            if s.checklist["engulf"]:
                assert bar1.close < bar2.low
        assert s.targets[0][0] == pytest.approx(s.entry + s.direction * s.risk)       # 1R, then breakeven
        assert s.rr() == pytest.approx(5.0)
        assert s.grade in ("A+", "A", "B")
        assert s.notes["ea"]["TrailingStopPips"] == 240


def test_default_timeframes_are_5m_and_15m_only():
    sigs = ea.scan(Context("XAUUSD", synthetic(4000)), require_bias=False,
                   EnableTrendAlignmentMultiTF=False, EnableSwingCheck=False)
    assert {s.window for s in sigs} <= {"5m", "15m"}


def test_no_future_data_on_real_gold():
    df = gold_1m()
    full = ea.scan(Context("XAUUSD", df), require_bias=False)
    cut = pd.Timestamp("2026-09-03 14:00", tz="UTC")
    pre = ea.scan(Context("XAUUSD", df[df.index < cut]), require_bias=False)
    key = lambda s: (s.window, s.created_time, s.direction, round(s.entry, 4), round(s.stop, 4))
    limit = cut - pd.Timedelta(minutes=15)
    assert [key(s) for s in pre if s.created_time < limit] == [key(s) for s in full if s.created_time < limit]
