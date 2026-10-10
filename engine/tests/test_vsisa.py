"""VSA Models M20-M25 (VSISA course): each setup on a hand-made chart, its mirror (sell), the course's "no trade"
cases, and no look-ahead on real gold data. Rules: docs/research/vsisa/VSISA_LOGIC.md."""
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ictengine.context import Context
from ictengine.indicators.vsa_volume import VolParams
from ictengine.models import vsisa
from ictengine.models.registry import MODELS

CFG = vsisa.VsaConfig(timeframes=("1m",), vol=VolParams(n=20, days=0), buffer=0.1)


def chart(rows, start="2026-07-07 13:00"):
    """rows: (open, high, low, close, volume) per 1m bar."""
    idx = pd.date_range(start, periods=len(rows), freq="1min", tz="UTC")
    return pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"], index=idx)


def mirror(df, axis=200.0):
    """The same chart upside down: a buy setup becomes the sell setup."""
    return pd.DataFrame({"open": axis - df["open"], "high": axis - df["low"], "low": axis - df["high"],
                         "close": axis - df["close"], "volume": df["volume"]}, index=df.index)


def drift(n=30, start=101.0, step=-0.03, vol=100.0):
    """Quiet bars drifting down, alternating small up / down bars, average volume."""
    rows, p = [], start
    for i in range(n):
        o = p
        c = p + (0.02 if i % 2 else -0.04)
        rows.append((o, max(o, c) + 0.03, min(o, c) - 0.03, c, vol))
        p = c + step / 2
    return rows


def run(mid, df, **kw):
    return vsisa.scan(Context("XAUUSD", df), mid, replace(CFG, **kw))


def last(df):
    return df["close"].iloc[-1]


# ---- V1 / M20 -------------------------------------------------------------------------------------------------
def v1_rows(reaction_vol=60.0):
    rows = drift()
    p = rows[-1][3]
    rows.append((p, p + 0.02, p - 0.60, p - 0.32, 300.0))           # effort: down bar, 3x volume, new low, closes off low
    e_c = p - 0.32
    rows.append((e_c, e_c + 0.30, e_c - 0.05, e_c + 0.25, reaction_vol))   # reaction: up bar on low volume
    rows += [(e_c + 0.25, e_c + 0.3, e_c + 0.2, e_c + 0.27, 100.0)] * 3
    return rows


def test_v1_imbalance_shift_buy_and_its_mirror_sell():
    df = chart(v1_rows())
    sigs = run("M20", df)
    assert len(sigs) == 1
    s = sigs[0]
    reaction = df.index[31]
    assert s.model == "M20_imbalance_shift" and s.direction == 1
    assert s.created_time == reaction                              # 1m chart: the reaction bar itself
    assert s.entry == pytest.approx(df["close"].iloc[31])
    assert s.stop == pytest.approx(min(df["low"].iloc[30], df["low"].iloc[31]) - 0.1)
    risk = s.entry - s.stop
    assert [p for p, _ in s.targets] == pytest.approx([s.entry + 2 * risk, s.entry + 5 * risk])
    assert s.checklist["effort_closed_off_low"] and s.checklist["reaction_pink"]

    m = run("M20", mirror(df))
    assert len(m) == 1 and m[0].direction == -1
    assert m[0].entry == pytest.approx(200 - s.entry) and m[0].stop == pytest.approx(200 - s.stop)


def test_v1_no_trade_when_the_reaction_comes_on_big_volume():
    # course [P4 09:47] [P5 05:29]: the reaction on volume >= the effort bar = supply hit again, wait
    assert run("M20", chart(v1_rows(reaction_vol=320.0))) == []


# ---- V2 / M21 -------------------------------------------------------------------------------------------------
def test_v2_low_volume_engulf():
    rows = drift()
    p = rows[-1][3]
    rows.append((p, p + 0.02, p - 0.60, p - 0.50, 300.0))           # big-volume down bar
    rows.append((p - 0.52, p + 0.10, p - 0.55, p + 0.05, 50.0))     # opens below its close, closes above its open+high
    rows += [(p, p + 0.05, p - 0.05, p, 100.0)] * 3
    df = chart(rows)
    sigs = run("M21", df)
    assert [s.model for s in sigs] == ["M21_low_volume_engulf"]
    assert sigs[0].checklist["full_engulf"]
    # the same chart without the engulf (reaction closes below the effort bar's open) is no M21
    rows[31] = (p - 0.48, p - 0.20, p - 0.55, p - 0.25, 50.0)
    assert run("M21", chart(rows)) == []
    assert len(run("M21", mirror(df))) == 1


# ---- V3 / M22 -------------------------------------------------------------------------------------------------
def test_v3_end_of_falling_market_bag_holding():
    rows = drift()
    p = rows[-1][3]
    rows.append((p, p + 0.01, p - 0.20, p - 0.03, 400.0))           # hammer (lower wick 80 %) at the low, 4x volume
    rows.append((p - 0.03, p + 0.30, p - 0.05, p + 0.25, 120.0))    # next bar up
    rows += [(p + 0.25, p + 0.3, p + 0.2, p + 0.27, 100.0)] * 3
    df = chart(rows)
    sigs = run("M22", df)
    assert [s.model for s in sigs] == ["M22_end_of_market"] and sigs[0].direction == 1
    assert sigs[0].stop == pytest.approx(p - 0.20 - 0.1)
    sell = run("M22", mirror(df))
    assert len(sell) == 1 and sell[0].direction == -1


# ---- V4 / M23 -------------------------------------------------------------------------------------------------
def test_v4_false_break_of_a_swing_low():
    rows = [(100.0, 100.05, 99.95, 100.0, 100.0)] * 25
    rows[12] = (100.0, 100.02, 99.70, 99.98, 100.0)                  # swing low 99.70
    rows.append((100.0, 100.02, 99.55, 99.80, 300.0))               # breaks below 99.70 on 3x volume, closes back above
    rows.append((99.80, 100.05, 99.78, 100.00, 60.0))               # up bar, low volume
    rows += [(100.0, 100.05, 99.95, 100.0, 100.0)] * 3
    df = chart(rows)
    sigs = run("M23", df)
    assert [s.model for s in sigs] == ["M23_false_break"]
    s = sigs[0]
    assert s.notes["levels"]["swing_level"] == pytest.approx(99.70)
    assert s.checklist["closed_back_inside"]
    assert s.stop == pytest.approx(99.55 - 0.1)
    assert len(run("M23", mirror(df))) == 1


# ---- V5 / M24 -------------------------------------------------------------------------------------------------
def v5_rows(test_vol=40.0):
    rows = drift()
    p = rows[-1][3]
    rows.append((p, p + 0.02, p - 0.60, p - 0.45, 300.0))           # buying event: big-volume down bar
    lo, hi = p - 0.60, p + 0.02
    rows.append((p - 0.45, p - 0.10, p - 0.48, p - 0.12, 150.0))    # reaction up
    rows.append((p - 0.12, p + 0.20, p - 0.14, p + 0.18, 120.0))    # rally above the event's high
    rows.append((p + 0.18, p + 0.25, p + 0.05, p + 0.10, 90.0))
    rows.append((p + 0.06, p + 0.12, hi - 0.20, p + 0.10, test_vol))  # test into the area, closes up, lower wick
    rows += [(p + 0.08, p + 0.15, p + 0.05, p + 0.10, 100.0)] * 3
    return rows, lo


def test_v5_no_supply_test_after_buying():
    rows, lo = v5_rows()
    df = chart(rows)
    sigs = run("M24", df)
    assert [s.model for s in sigs] == ["M24_no_supply_test"]
    s = sigs[0]
    assert s.created_time == df.index[34] and s.notes["form"] == "a"
    assert len(run("M24", mirror(df))) == 1


def test_v5_test_on_volume_is_no_trade():
    rows, _ = v5_rows(test_vol=200.0)
    assert run("M24", chart(rows)) == []


# ---- V6 / M25 -------------------------------------------------------------------------------------------------
def v6_rows(break_vol=60.0):
    rows = drift()
    p = rows[-1][3]
    rows.append((p, p + 0.02, p - 0.60, p - 0.45, 300.0))           # buying event
    rows.append((p - 0.45, p - 0.20, p - 0.48, p - 0.22, 150.0))    # reaction up
    rows.append((p - 0.22, p - 0.05, p - 0.25, p - 0.08, 110.0))    # rally up: AR = p - 0.05
    rows.append((p - 0.08, p - 0.07, p - 0.30, p - 0.28, 90.0))     # first down bar: the rally is over
    rows.append((p - 0.28, p - 0.20, p - 0.35, p - 0.22, 80.0))
    rows.append((p - 0.22, p + 0.05, p - 0.24, p + 0.03, break_vol))  # closes above AR
    rows += [(p + 0.03, p + 0.08, p, p + 0.05, 100.0)] * 3
    return rows, p - 0.05


def test_v6_ar_line_break_on_low_volume():
    rows, ar = v6_rows()
    df = chart(rows)
    sigs = run("M25", df, trend="none")
    assert [s.model for s in sigs] == ["M25_ar_line_break"]
    s = sigs[0]
    assert s.notes["levels"]["ar_level"] == pytest.approx(ar)
    assert s.created_time == df.index[35]
    assert len(run("M25", mirror(df), trend="none")) == 1


def test_v6_ar_broken_on_big_volume_is_no_trade():
    rows, _ = v6_rows(break_vol=250.0)
    assert run("M25", chart(rows), trend="none") == []


# ---- registry, defaults, real data ----------------------------------------------------------------------------
def test_registered_as_vsa_models():
    for mid, name in (("M20", "VSA Imbalance Shift"), ("M25", "VSA AR / AS Line Break")):
        assert MODELS[mid].source == "VSA" and MODELS[mid].name == name
    assert vsisa.MODEL_DEFAULTS["M25"]["trend"] == "ema1h"         # §3.1: trend filter on for V6 only


def test_no_volume_no_signals():
    df = chart(v1_rows()).drop(columns="volume")
    assert vsisa.scan(Context("XAUUSD", df), "M20", CFG) == []


AXI = Path(__file__).resolve().parents[2] / "data" / "mt5" / "axi_demo" / "XAUUSD"


@pytest.mark.skipif(not (AXI / "2026-08.pkl").exists(), reason="local MT5 cache not present")
@pytest.mark.parametrize("mid", list(vsisa.SETUPS))
def test_no_look_ahead_on_a_month_of_gold(mid):
    df = pd.read_pickle(AXI / "2026-08.pkl")
    cut = pd.Timestamp("2026-08-20 14:37", tz="UTC")
    full = MODELS[mid].scan(Context("XAUUSD", df))
    pre = MODELS[mid].scan(Context("XAUUSD", df[df.index < cut]))
    key = lambda s: (s.window, s.created_time, s.direction, round(s.entry, 6), round(s.stop, 6), s.grade)
    limit = cut - pd.Timedelta(minutes=15)       # a 15m setup is complete at its candle's close
    a = [key(s) for s in pre if s.created_time < limit]
    assert a == [key(s) for s in full if s.created_time < limit]
    assert len(a) > 0
