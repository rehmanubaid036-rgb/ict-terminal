"""Regression tests on real XAUUSD data (Dukascopy, 2-3 Sep 2026), the day of the journal's
10 AM Silver Bullet long on gold (PDF page 27: entry ~4466.47, stop ~4459.42)."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from ictengine.core import clock
from ictengine.core.candles import resample, validate
from ictengine.core.levels import daily_levels
from ictengine.data.dukascopy import parse_bi5
from ictengine.indicators.fvg import BULL, find_fvgs
from ictengine.indicators.liquidity import SSL, find_pools
from ictengine.indicators.structure import find_structure
from ictengine.indicators.swings import find_swings

DATA = Path(__file__).parent / "data"


def ny(ts):
    return ts.tz_convert(clock.NY).strftime("%H:%M")


@pytest.fixture(scope="module")
def gold():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    frames = [parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days]
    return validate(pd.concat(frames))


@pytest.fixture(scope="module")
def session(gold):
    return gold.loc["2026-09-03 12:00":"2026-09-03 16:00"]  # 08:00-12:00 NY


def test_decoded_real_data(gold):
    assert gold.index[0] == pd.Timestamp("2026-09-02 00:00", tz="UTC")
    assert len(gold) > 2500
    bar = gold.loc[pd.Timestamp("2026-09-03 14:00", tz="UTC")]  # 10:00 NY
    assert (bar.open, bar.high, bar.low, bar.close) == (4466.255, 4468.015, 4458.285, 4464.865)


def test_levels_on_journal_day(gold):
    lv = daily_levels(gold).loc["2026-09-03"]
    assert lv.midnight_open == pytest.approx(4431.12, abs=0.01)
    assert lv.open_0930 == pytest.approx(4479.66, abs=0.01)
    assert lv.asian_range_low < lv.asian_range_high < lv.london_high


def test_ssl_raid_at_10am_below_journal_stop_zone(session):
    sw = find_swings(session, n=1)
    pools = find_pools(session, sw)
    raid = pools[(pools.side == SSL) & (pools.outcome == "sweep") &
                 (pools.price.round(3) == 4459.575)]
    assert len(raid) == 1
    assert ny(session.index[raid.iloc[0].taken_pos]) == "10:00"


def test_bullish_fvg_in_silver_bullet_window_matches_journal_entry(session):
    f = find_fvgs(session)
    sb_start, sb_end = clock.get_window("ny_am_sb").bounds(date(2026, 9, 3))
    created = session.index[f.created_pos.to_numpy()]
    in_window = f[(f.direction == BULL) & (created >= sb_start) & (created < sb_end)]
    # the journal's entry 4466.47 sits in the 10:13 BISI 4465.975-4466.415 (+ spread vs PAXG)
    hit = in_window[(in_window.bottom <= 4466.47 + 0.1) & (in_window.top >= 4466.47 - 0.1)]
    assert len(hit) >= 1
    g = hit.iloc[0]
    assert ny(session.index[g.created_pos]) == "10:13"
    assert (g.bottom, g.top) == (4465.975, 4466.415)


def test_bullish_shift_after_the_raid(session):
    st = find_structure(session, find_swings(session, n=1))
    t = [ny(x) for x in st.time]
    bull_mss = [t[i] for i in range(len(st)) if st.direction.iloc[i] == 1 and st.kind.iloc[i] == "MSS"]
    assert "10:15" in bull_mss


def test_higher_timeframes_resample_cleanly(gold):
    for tf in ("5m", "15m", "1h", "4h"):
        out = resample(gold, tf)
        validate(out)
        assert out.high.max() == gold.high.max()
