"""M18 The Alpha Model Gold: the PDF's pieces (scenarios, FVGs, H1 confirmation, entry) and no look-ahead."""
import numpy as np
import pandas as pd
import pytest

from ictengine.context import Context
from ictengine.data import dxy
from ictengine.models import alpha_gold as ag
from ictengine.models.registry import MODELS


def test_registered_as_a_custom_model():
    assert MODELS["M18"].source == "WOLF" and MODELS["M18"].name == "The Alpha Model Gold"


@pytest.mark.parametrize("dollar,silver,gold,grade", [
    (-1, 1, 1, "A+"), (1, -1, -1, "A+"),          # p.12 A+ scenarios
    (-1, 0, 1, "A"), (1, 0, -1, "A"),             # A: silver neutral
    (-1, -1, 1, "B"), (1, 1, -1, "B"),            # B: silver with the dollar
    (0, 1, 1, None), (1, 1, 0, None), (1, -1, 1, None),   # no dollar / gold bias, or gold not opposite
])
def test_scenarios(dollar, silver, gold, grade):
    assert ag.scenario(dollar, silver, gold) == grade


def _frame(rows, start="2026-09-01 00:00", freq="1h"):
    idx = pd.date_range(pd.Timestamp(start, tz="UTC"), periods=len(rows), freq=freq)
    return pd.DataFrame(rows, index=idx, columns=["open", "high", "low", "close"]).assign(volume=1.0)


def test_fvgs():
    f = _frame([(10, 11, 9, 10.5), (10.5, 14, 10.4, 13.8), (13.8, 15, 12, 14.5),     # bullish gap 11 - 12
                (14.5, 14.6, 13, 13.2), (13.2, 13.3, 9, 9.5), (9.5, 10, 8, 8.5)])    # bearish gap 10 - 13
    assert ag.fvgs(f, len(f)) == [(1, 11.0, 12.0, 2), (-1, 10.0, 13.0, 5)]


def test_h1_gap_failed_with_a_body_only():
    base = [(10, 11, 9, 10.5), (10.5, 14, 10.4, 13.8), (13.8, 15, 12, 14.5)]          # bullish H1 gap 11 - 12
    held = ag.Frames(_frame(base + [(14.5, 14.6, 10.5, 12.2)] * 3))                 # wicks below 11, bodies above
    broke = ag.Frames(_frame(base + [(14.5, 14.6, 10.5, 10.8)] * 3))                # a bearish body closed below 11
    at = pd.Timestamp("2026-09-01 06:00", tz="UTC")
    assert ag.h1_confirmed(held, at, 1)[0] is True
    assert ag.h1_confirmed(broke, at, 1)[0] is False


def _gold(days=30, seed=1):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(pd.Timestamp("2026-08-01", tz="UTC"), periods=days * 1440, freq="1min")
    c = 4000 + np.cumsum(rng.normal(0, 0.4, len(idx)))
    o = np.r_[c[0], c[:-1]]
    return pd.DataFrame({"open": o, "high": np.maximum(o, c) + 0.2, "low": np.minimum(o, c) - 0.2, "close": c,
                         "volume": 1.0}, index=idx)


def test_bias_never_reads_the_future():
    df = _gold()
    at = pd.Timestamp("2026-08-20 11:00", tz="UTC")
    early = ag.asset_bias(ag.Frames(df[df.index < at]), at, ag.AlphaConfig())
    full = ag.asset_bias(ag.Frames(df), at, ag.AlphaConfig())
    assert early == full


def test_signals_only_in_the_sessions_and_with_dollar_data():
    df = _gold()
    assert ag.scan(Context("XAUUSD", df)) == []                                 # no DXY: no bias, no trade
    assert ag.scan(Context("NAS100", df, extras={"DXY": df, "XAGUSD": df})) == []   # gold only
    inv = (8000 - df[["open", "high", "low", "close"]]).rename(columns={"high": "low", "low": "high"})
    sigs = ag.scan(Context("XAUUSD", df, extras={"DXY": inv, "XAGUSD": df}))
    for s in sigs:
        t = s.created_time.tz_convert("America/New_York")
        assert (2 <= t.hour < 5) or (7 <= t.hour < 10), t
        assert s.grade in ("A+", "A", "B") and len(s.targets) == 1 and s.exit_by is None
        assert s.notes["bias"]["XAUUSD"] == -s.notes["bias"]["DXY"] == s.direction


def test_dxy_from_its_currencies():
    idx = pd.date_range(pd.Timestamp("2026-09-01", tz="UTC"), periods=180, freq="1min")
    pairs = {"EURUSD": 1.10, "USDJPY": 150.0, "GBPUSD": 1.30, "USDCAD": 1.35, "USDSEK": 10.5, "USDCHF": 0.88}

    def load(sym, a, b):
        if sym not in pairs:
            raise KeyError(sym)
        v = pairs[sym]
        return pd.DataFrame({"open": v, "high": v, "low": v, "close": v}, index=idx)
    out = dxy.load_dxy(load, idx[0], idx[-1])
    expect = 50.14348112 * np.prod([v ** dxy.WEIGHTS[p] for p, v in pairs.items()])
    assert len(out) == 3 and out["close"].iloc[0] == pytest.approx(expect)
