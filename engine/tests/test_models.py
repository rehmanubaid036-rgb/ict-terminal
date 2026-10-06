from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from helpers import bars, random_walk
from ictengine.bias import bias_at
from ictengine.context import Context
from ictengine.data.dukascopy import parse_bi5
from ictengine.indicators.liquidity import BSL, SSL
from ictengine.models import silver_bullet as sb
from ictengine.models.common import KeyLevel, allocate, find_raids, session_levels, target_ladder
from ictengine.signals import Signal

DATA = Path(__file__).parent / "data"


# --- building blocks -------------------------------------------------------------

def ctx_from(rows, start="2025-07-15 13:00"):
    return Context("XAUUSD", bars(rows, start=start), timeframes=("5m",))


def test_find_raids_needs_close_back_inside():
    rows = [(101.0, 101.5, 100.5, 101.0)] * 5 + [
        (101.0, 101.2, 99.4, 100.6),   # 5: wicks below 100, closes back above -> raid
        (100.6, 101.0, 100.4, 100.8),
        (100.8, 100.9, 99.0, 99.2),    # 7: below 99.5 and stays below -> not a raid
        (99.2, 99.3, 98.8, 99.0), (99.0, 99.2, 98.7, 98.9), (98.9, 99.1, 98.6, 98.8)]
    ctx = ctx_from(rows)
    lv = [KeyLevel(100.0, SSL, "a", 0), KeyLevel(99.5, SSL, "b", 6)]
    raids = find_raids(ctx, lv, SSL, 0, len(rows))
    assert [(r.level.name, r.taken_pos, r.reclaim_pos, r.extreme) for r in raids] == [("a", 5, 5, 99.4)]


def test_level_used_only_after_it_exists_and_while_intact():
    rows = [(101.0, 101.5, 100.5, 101.0)] * 3 + [(101.0, 101.2, 99.4, 100.6)] + [(100.6, 101.0, 100.4, 100.8)] * 3 + \
           [(100.8, 101.0, 99.3, 100.5)]
    ctx = ctx_from(rows)
    late = KeyLevel(100.0, SSL, "late", 5)        # exists from bar 5: only the bar-7 raid counts
    assert [r.taken_pos for r in find_raids(ctx, [late], SSL, 0, len(rows))] == [7]
    early = KeyLevel(100.0, SSL, "early", 0)      # already raided at bar 3, before a search from 5
    assert find_raids(ctx, [early], SSL, 5, len(rows)) == []


def test_target_ladder_orders_filters_and_merges():
    lv = [KeyLevel(p, BSL, f"l{p}", 0) for p in (100.5, 101.2, 101.3, 102.5, 104.0)] + [KeyLevel(98, SSL, "s", 0)]
    out = target_ladder(lv, entry=100.0, risk=1.0, direction=1, min_first_rr=1.0, merge_rr=0.25)
    assert [l.price for l in out] == [101.3, 102.5, 104.0]  # 100.5 too close, 101.2 merged into 101.3
    short = target_ladder([KeyLevel(p, SSL, "x", 0) for p in (99.5, 98.0, 96.0)], 100.0, 1.0, -1)
    assert [l.price for l in short] == [98.0, 96.0]


def test_allocate_partials():
    assert allocate([1, 2, 3]) == [(1, 0.5), (2, 0.25), (3, 0.25)]
    assert allocate([1, 2]) == [(1, 0.5), (2, 0.5)]
    assert allocate([1]) == [(1, 1.0)]
    assert allocate([]) == []


def test_session_levels_only_after_their_window_closes():
    ctx = Context("XAUUSD", random_walk(3 * 24 * 60, start="2025-07-14 00:00", seed=81), timeframes=("5m",))
    before = ctx.pos_of(pd.Timestamp("2025-07-16 03:59", tz="UTC"))  # 23:59 NY: Asian range not finished
    after = ctx.pos_of(pd.Timestamp("2025-07-16 04:00", tz="UTC"))
    names_before = {l.name for l in session_levels(ctx, before)}
    names_after = {l.name for l in session_levels(ctx, after)}
    assert "asian_range_high" not in names_before and "asian_range_high" in names_after
    assert {"pdh", "pdl"} <= names_after


def test_bias_components_are_bounded():
    ctx = Context("XAUUSD", random_walk(6 * 24 * 60, start="2025-07-13 22:00", seed=82))
    for t in range(3000, len(ctx.base), 997):
        b = bias_at(ctx, t)
        assert set(b.components) == {"daily_structure", "h4_structure", "ipda_zone", "pd_reaction", "mo_zone"}
        assert all(v in (-1, 0, 1) for v in b.components.values())
        assert b.direction == (np.sign(b.score) if abs(b.score) >= 2 else 0)
        if b.direction and b.draw is not None:
            assert b.direction * (b.draw - ctx.price(t)) > 0


# --- Silver Bullet on the real journal day ----------------------------------------

@pytest.fixture(scope="module")
def gold_ctx():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    df = pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])
    return Context("XAUUSD", df)


def test_without_bias_the_earliest_setup_wins(gold_ctx):
    # neutral bias: a 10:09 short completes before the 10:16 long and is taken
    sigs = sb.scan(gold_ctx, sb.SBConfig(require_bias=False, windows=("ny_am_sb",)))
    day = [s for s in sigs if s.created_time.date() == date(2026, 9, 3)]
    assert [(s.direction, s.created_time) for s in day] == [(-1, pd.Timestamp("2026-09-03 14:09", tz="UTC"))]


def test_rulebook_silver_bullet_skips_the_journal_long(gold_ctx):
    # The strict rulebook M1 (MSS with displacement + entry in discount) does not take the
    # journal's 10:16 long: it fails both rules. A deliberate choice - the strict M1 is the
    # only model with a positive backtest (NAS100, 16 months, with bias).
    sigs = sb.scan(gold_ctx, sb.SBConfig(manual_bias=1, windows=("ny_am_sb",)))
    assert [s for s in sigs if s.created_time.date() == date(2026, 9, 3)] == []


def test_silver_bullet_finds_the_journal_long(gold_ctx):
    # the journal trader was bullish that day: with the two strict rules relaxed the 10:16 long is found
    sigs = sb.scan(gold_ctx, sb.SBConfig(manual_bias=1, windows=("ny_am_sb",), strict_mss=False, require_discount=False))
    day = [s for s in sigs if s.created_time.date() == date(2026, 9, 3)]
    assert len(day) == 1
    s = day[0]
    assert s.direction == 1 and s.window == "ny_am_sb"
    assert 4469.3 <= s.entry <= 4472.1            # CE of the 10:16 BISI
    assert s.stop < 4464.155                        # beyond the raided 1m low
    assert s.targets[-1][0] >= 4490 and s.rr() >= 2
    assert s.expiry == pd.Timestamp("2026-09-03 14:45", tz="UTC")  # 10:45 NY
    assert isinstance(s, Signal) and s.checklist["kill_zone"]


def test_silver_bullet_signals_never_use_future_data(gold_ctx):
    """Signals found on a prefix of the data equal the full-data signals created in that prefix."""
    full = sb.scan(gold_ctx, sb.SBConfig(require_bias=False))
    cut = pd.Timestamp("2026-09-03 15:30", tz="UTC")
    pre_ctx = Context("XAUUSD", gold_ctx.base[gold_ctx.base.index < cut])
    pre = sb.scan(pre_ctx, sb.SBConfig(require_bias=False))
    key = lambda s: (s.window, s.created_time, s.direction, round(s.entry, 6), round(s.stop, 6),
                     tuple((round(p, 6), f) for p, f in s.targets), s.grade)
    expected = [key(s) for s in full if s.created_time < cut - pd.Timedelta(minutes=1)]
    got = [key(s) for s in pre if s.created_time < cut - pd.Timedelta(minutes=1)]
    assert got == expected


# --- every registered model -------------------------------------------------------

from ictengine.models.registry import MODELS, run_models  # noqa: E402


@pytest.mark.parametrize("mid", list(MODELS))
def test_model_signals_are_valid(gold_ctx, mid):
    for s in MODELS[mid].scan(gold_ctx, require_bias=False):
        assert s.model.startswith(mid + "_")
        assert s.rr() >= 2 - 1e-9
        assert s.created_time < s.expiry
        assert s.direction * (s.entry - s.stop) > 0
        assert s.grade in ("A+", "A", "B")


@pytest.mark.parametrize("mid", list(MODELS))
def test_model_never_uses_future_data(gold_ctx, mid):
    cut = pd.Timestamp("2026-09-03 12:40", tz="UTC")  # 08:40 NY: inside NY sessions/killzones
    full = MODELS[mid].scan(gold_ctx, require_bias=False)
    pre = MODELS[mid].scan(Context("XAUUSD", gold_ctx.base[gold_ctx.base.index < cut]), require_bias=False)
    key = lambda s: (s.window, s.created_time, s.direction, round(s.entry, 6), round(s.stop, 6),
                     tuple((round(p, 6), f) for p, f in s.targets))
    limit = cut - pd.Timedelta(minutes=5)  # a 5m setup is only complete at its candle's close
    assert [key(s) for s in pre if s.created_time < limit] == [key(s) for s in full if s.created_time < limit]


def test_run_models_merges_in_time_order(gold_ctx):
    sigs = run_models(gold_ctx, require_bias=False)
    assert [s.created_time for s in sigs] == sorted(s.created_time for s in sigs)
    assert {s.model.split("_")[0] for s in sigs} <= set(MODELS)


# --- M5 / M7 / M14 / M15 specifics ---------------------------------------------------

from ictengine.models import reversal_models as rm  # noqa: E402
from ictengine.models.setup import find_setup  # noqa: E402


def test_accept_filter_can_reject_every_setup(gold_ctx):
    # M4 (OTE) has setups on these two days under the rulebook rules
    full = rm.scan(gold_ctx, rm.replace(rm.M4_CONFIG, require_bias=False))
    none = rm.scan(gold_ctx, rm.replace(rm.M4_CONFIG, require_bias=False, accept=lambda c, s: False))
    assert len(full) > 0 and none == []


def test_unicorn_is_a_subset_condition(gold_ctx):
    # every unicorn signal has a breaker formed after its raid overlapping its FVG
    for s in rm.scan(gold_ctx, rm.replace(rm.M7_CONFIG, require_bias=False)):
        assert s.model == "M7_unicorn"


def test_max_grade_cap(gold_ctx):
    sigs = rm.scan(gold_ctx, rm.replace(rm.M14_CONFIG, require_bias=False))
    assert all(s.grade in ("A", "B") for s in sigs)


def test_asian_q2_window_runs_on_the_evening_before():
    w = rm.M5_CONFIG.windows[0]
    s0, s1 = w.bounds(date(2026, 9, 3))
    assert s0 == pd.Timestamp("2026-09-02 23:45", tz="UTC")  # 19:45 EDT on 2 Sep
    assert s1 == pd.Timestamp("2026-09-03 01:00", tz="UTC")


def test_protraction_precondition_scales_with_adr():
    days = pd.date_range("2026-01-01", periods=30, freq="D")
    lv = pd.DataFrame({"day_high": 110.0, "day_low": 100.0, "cbdr_high": 101.0, "cbdr_low": 100.0,
                       "asian_range_high": 101.0, "asian_range_low": 100.0}, index=days)

    class C:
        levels = lv
    assert rm.protraction_ranges_are_small(C, days[25].date(), 0)          # 1 vs ADR 10: small
    lv.loc[days[25], "cbdr_high"] = 106.0
    assert not rm.protraction_ranges_are_small(C, days[25].date(), 0)      # CBDR 6 > 35% of 10
    assert not rm.protraction_ranges_are_small(C, days[5].date(), 0)       # not enough history


def test_ote_entry_lies_inside_its_own_leg(gold_ctx):
    """Regression: the OTE leg must be measured on base bars around the setup (M4 runs on 5m)."""
    base = gold_ctx.base
    sigs = rm.scan(gold_ctx, rm.replace(rm.M4_CONFIG, require_bias=False))
    assert sigs
    for s in sigs:
        t0 = pd.Timestamp(s.notes["raid_time"])
        seg = base[(base.index >= t0) & (base.index <= s.created_time)]
        if s.direction == 1:
            assert seg.low.min() - 1 <= s.entry <= seg.high.max()
        else:
            assert seg.low.min() <= s.entry <= seg.high.max() + 1


def test_org_direction():
    from ictengine.models.array_models import org_direction
    days = pd.date_range("2026-01-01", periods=25, freq="D")
    lv = pd.DataFrame({"day_high": 110.0, "day_low": 100.0, "org_high": np.nan, "org_low": np.nan,
                       "open_0930": np.nan}, index=days)

    class C:
        levels = lv
    d = days[22].date()
    lv.loc[days[22], ["org_low", "org_high", "open_0930"]] = [104.0, 106.0, 106.0]   # gap up -> fill down
    assert org_direction(C, d, 0) == -1
    lv.loc[days[22], ["org_low", "org_high", "open_0930"]] = [104.0, 106.0, 104.0]   # gap down -> fill up
    assert org_direction(C, d, 0) == 1
    lv.loc[days[22], ["org_low", "org_high", "open_0930"]] = [105.0, 105.2, 105.2]   # 0.2 < 5% of ADR 10
    assert org_direction(C, d, 0) == 0


# --- M16 SMT and M8 PO3 ----------------------------------------------------------------

from ictengine.models import filters  # noqa: E402


def test_smt_model_needs_partner(gold_ctx):
    assert filters.scan_m16(gold_ctx, require_bias=False) == []


def test_smt_divergence_check():
    from ictengine.models.common import KeyLevel, Raid
    from ictengine.models.setup import Setup
    from ictengine.indicators.liquidity import SSL
    a = random_walk(200, seed=91)
    held = a.copy()
    held["low"] = 1.0  # partner never makes a new low
    held["high"] = held[["open", "close"]].max(axis=1).clip(lower=1.0) + 5
    held["open"] = held["close"] = 3.0
    ctx = Context("XAUUSD", a, timeframes=("5m",), partner=held)
    raid = Raid(KeyLevel(2400.0, SSL, "x", 50), 120, 121, 2399.0)
    s = Setup(1, raid, None, None, 125, 120, True)
    assert filters.smt_at_raid(ctx, s)
    broke = held.copy()
    broke.loc[broke.index[120], "low"] = 0.5   # partner also made a lower low during the raid
    ctx2 = Context("XAUUSD", a, timeframes=("5m",), partner=broke)
    assert not filters.smt_at_raid(ctx2, s)


def test_partner_alignment_never_looks_ahead():
    a = random_walk(100, seed=92)
    b = a.iloc[::2] * 0 + 7.0  # partner only every other minute
    ctx = Context("XAUUSD", a, timeframes=("5m",), partner=b)
    al = ctx.partner_aligned
    # an odd minute gets the previous even minute's partner bar, never the next one
    assert al.index.equals(a.index) and al["close"].iloc[1] == 7.0 and al["close"].notna().all()


def test_po3_filter_keeps_only_manipulated_ny_longs(gold_ctx):
    sigs = rm.scan(gold_ctx, rm.replace(rm.M2_CONFIG, require_bias=False))
    kept = filters.po3_filter(gold_ctx, sigs)
    assert set(id(s) for s in kept) <= set(id(s) for s in sigs)
    for s in kept:
        local = s.created_time.tz_convert("America/New_York")
        if 6 <= local.hour < 16:
            t = gold_ctx.pos_of(s.created_time)
            lv = gold_ctx.day_levels(t)
            assert lv is not None
