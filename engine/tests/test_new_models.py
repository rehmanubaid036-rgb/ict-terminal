"""Longer higher-timeframe history in the Context, M8 Power of 3, M10 News aftermath, default-off models."""
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from helpers import random_walk
from ictengine.context import Context
from ictengine.data.dukascopy import parse_bi5
from ictengine.models import news_model
from ictengine.models.registry import MODELS
from ictengine.news import NewsEvent

DATA = Path(__file__).parent / "data"


# --- Context(history=...) ----------------------------------------------------------------------

def test_history_reaches_back_on_15m_and_up_only():
    df = random_walk(n=12 * 1440, start="2025-06-01 22:00", step=0.4)
    cut = df.index[len(df) // 2]
    base, old = df[df.index >= cut], df[df.index < cut]
    ctx = Context("XAUUSD", base, history=old)
    full = Context("XAUUSD", df)
    assert ctx.frames["5m"].index[0] >= cut                         # the costly small frames stay short
    for tf in ("15m", "1h", "4h", "1d"):
        assert ctx.frames[tf].index[0] < cut
        assert ctx.frames[tf].equals(full.frames[tf])               # the same bars as one long context
    assert ctx.levels.index[0] == full.levels.index[0]               # daily levels (IPDA, bias) go back too
    # as-of stays strict: at base bar t the 1h bar used has closed
    for t in (0, 1, 59, 60, 61, 500):
        p = ctx.htf_pos("1h", t)
        assert p == full.htf_pos("1h", t + len(old))
        assert ctx.frames["1h"].index[p] + pd.Timedelta(hours=1) <= base.index[t] + pd.Timedelta(minutes=1)


def test_history_after_base_start_is_ignored():
    df = random_walk(n=3 * 1440, start="2025-06-01 22:00")
    cut = df.index[1440]
    ctx = Context("XAUUSD", df[df.index >= cut], history=df)        # overlapping history: only the part before
    assert ctx.frames["1h"].equals(Context("XAUUSD", df).frames["1h"])


# --- registry --------------------------------------------------------------------------------

def test_registry_has_m8_m10_and_m11_is_off_by_default():
    assert {"M8", "M10"} <= set(MODELS)
    assert MODELS["M11"].default_on is False
    assert all(m.default_on for k, m in MODELS.items() if k != "M11")


# --- M10 news aftermath ------------------------------------------------------------------------

def _news_day(leg_step: float, fomc: bool = False):
    """20 quiet days, then at the release a 15-minute leg of ``leg_step`` per minute, then a flat drift."""
    quiet = random_walk(n=20 * 1440, start="2025-06-02 00:00", step=0.05, base=100.0)
    t_event = pd.Timestamp("2025-06-22 12:30", tz="UTC") if not fomc else pd.Timestamp("2025-06-22 18:00", tz="UTC")
    pre = random_walk(n=int((t_event - quiet.index[-1]) / pd.Timedelta(minutes=1)) - 1,
                      start=str(quiet.index[-1] + pd.Timedelta(minutes=1)), step=0.05, base=float(quiet["close"].iloc[-1]), seed=3)
    p = float(pre["close"].iloc[-1])
    rows, idx = [], []
    t = t_event
    for _ in range(15):                                   # the shock leg
        o, c = p, p + leg_step
        rows.append((o, max(o, c) + 0.02, min(o, c) - 0.02, c)); idx.append(t)
        p, t = c, t + pd.Timedelta(minutes=1)
    for _ in range(12 * 60):                              # after the release: a slow drift on top
        o, c = p, p + 0.001
        rows.append((o, c + 0.03, o - 0.03, c)); idx.append(t)
        p, t = c, t + pd.Timedelta(minutes=1)
    after = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=pd.DatetimeIndex(idx)).assign(volume=1.0)
    df = pd.concat([quiet, pre, after])
    title = "FOMC Statement" if fomc else "Non-Farm Payrolls"
    return Context("XAUUSD", df), NewsEvent(t_event, "USD", "High", title)


def test_m10_trades_the_release_fvg_after_the_shock_window():
    ctx, ev = _news_day(0.5)
    sigs = news_model.scan(ctx, news_model.NewsConfig(events=(ev,)))
    assert len(sigs) == 1
    s = sigs[0]
    assert s.direction == 1 and s.model == "M10_news_aftermath"
    assert s.created_time >= ev.time + pd.Timedelta(minutes=15)       # never inside the shock window
    lo, hi = s.notes["leg"]
    assert s.stop < lo < s.entry < hi                                  # stop beyond the leg's origin
    assert s.targets[0][0] >= hi                                       # TP1: the move's extreme
    assert s.notes["fvg"][0] < s.entry < s.notes["fvg"][1]             # entry at the FVG CE


def test_m10_needs_a_displacement():
    ctx, ev = _news_day(0.001)                                         # the release did not move price
    assert news_model.scan(ctx, news_model.NewsConfig(events=(ev,))) == []


def test_m10_fomc_aftermath_is_traded_in_asia():
    ctx, ev = _news_day(0.5, fomc=True)
    sigs = news_model.scan(ctx, news_model.NewsConfig(events=(ev,)))
    assert len(sigs) == 1
    local = sigs[0].created_time.tz_convert("America/New_York")
    assert (local.hour, local.minute) == (20, 0)


def test_m10_scan_without_events_in_range_is_empty():
    ctx, _ = _news_day(0.5)
    far = NewsEvent(pd.Timestamp("2030-01-01", tz="UTC"), "USD", "High", "Non-Farm Payrolls")
    assert news_model.scan(ctx, news_model.NewsConfig(events=(far,))) == []


# --- M8 Power of 3 -----------------------------------------------------------------------------

@pytest.fixture(scope="module")
def gold_ctx():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    df = pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])
    return Context("XAUUSD", df)


def test_m8_buys_below_and_sells_above_the_midnight_open(gold_ctx):
    sigs = MODELS["M8"].scan(gold_ctx, require_bias=False)
    for s in sigs:
        assert s.model == "M8_power_of_3"
        lv = gold_ctx.day_levels(gold_ctx.pos_of(s.created_time))
        assert s.direction * (lv["midnight_open"] - s.entry) > 0
        assert s.window in ("po3_london", "po3_ny_open")
    assert isinstance(sigs, list)
    assert np.all([s.stop != s.entry for s in sigs])
