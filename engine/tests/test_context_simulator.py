import pandas as pd
import pytest

from helpers import bars, random_walk
from ictengine.backtest.simulator import run, simulate, stats, trades_frame
from ictengine.context import Context, bar_close_times
from ictengine.signals import LONG, SHORT, Signal


def utc(s):
    return pd.Timestamp(s, tz="UTC")


# --- context: as-of alignment -------------------------------------------------

@pytest.fixture(scope="module")
def ctx():
    return Context("XAUUSD", random_walk(3 * 24 * 60, start="2025-07-14 00:00", seed=71))


def test_5m_bar_visible_only_after_it_closes(ctx):
    t_open = ctx.pos_of(utc("2025-07-15 14:03"))   # bar 14:03 closes 14:04 -> 14:00 5m bar still forming
    t_close = ctx.pos_of(utc("2025-07-15 14:04"))  # bar 14:04 closes 14:05 -> 14:00 5m bar done
    f5 = ctx.frames["5m"]
    assert f5.index[ctx.htf_pos("5m", t_open)] == utc("2025-07-15 13:55")
    assert f5.index[ctx.htf_pos("5m", t_close)] == utc("2025-07-15 14:00")


def test_4h_and_daily_alignment(ctx):
    t = ctx.pos_of(utc("2025-07-15 13:59"))  # closes 14:00 UTC = 10:00 EDT -> 4h bar 06:00-10:00 NY done
    assert ctx.frames["4h"].index[ctx.htf_pos("4h", t)] == utc("2025-07-15 10:00")
    t = ctx.pos_of(utc("2025-07-15 21:58"))  # 17:59 NY: today's daily bar still forming
    assert ctx.frames["1d"].index[ctx.htf_pos("1d", t)] == utc("2025-07-13 22:00")
    t = ctx.pos_of(utc("2025-07-15 21:59"))  # closes 18:00 NY -> the day closed
    assert ctx.frames["1d"].index[ctx.htf_pos("1d", t)] == utc("2025-07-14 22:00")


def test_htf_never_ahead_of_base(ctx):
    base_close = ctx.base.index + pd.Timedelta(minutes=1)
    for tf in ctx.timeframes:
        frame = ctx.frames[tf]
        for t in range(0, len(ctx.base), 97):
            p = ctx.htf_pos(tf, t)
            if p >= 0:
                close = pd.Timestamp(bar_close_times(frame.index[p:p + 1], tf)[0], tz="UTC")
                assert close <= base_close[t]


def test_daily_close_time_on_dst_day():
    lab = pd.DatetimeIndex([utc("2025-11-01 22:00")])  # 18:00 EDT Sat label; day spans DST end
    close = pd.Timestamp(bar_close_times(lab, "1d")[0], tz="UTC")
    assert close == utc("2025-11-02 23:00")  # 18:00 EST next day: a 25 hour bar


def test_context_unknown_symbol():
    with pytest.raises(KeyError):
        Context("FOO", random_walk(100))


# --- signal validation ----------------------------------------------------------

def sig(**kw):
    base = dict(model="test", symbol="XAUUSD", direction=LONG, created_time=utc("2025-07-15 14:00"),
                entry=100.0, stop=99.0, targets=[(101.0, 0.5), (102.0, 0.25), (103.0, 0.25)],
                expiry=utc("2025-07-15 14:30"))
    base.update(kw)
    return Signal(**base)


def test_signal_validation():
    with pytest.raises(ValueError):
        sig(stop=100.5)                                    # stop above a long entry
    with pytest.raises(ValueError):
        sig(targets=[(101, 0.5), (100.5, 0.5)])            # targets out of order
    with pytest.raises(ValueError):
        sig(targets=[(101, 0.5), (102, 0.4)])              # fractions do not sum to 1
    s = sig()
    assert s.risk == 1.0 and s.rr() == 3.0 and s.rr(0) == 1.0
    assert s.to_dict()["created_time"].startswith("2025-07-15T14:00")


# --- simulator ------------------------------------------------------------------

def frame(rows):
    return bars(rows, start="2025-07-15 14:00")  # row 0 = signal bar


def test_full_win_with_partials():
    df = frame([(100.5, 100.6, 100.4, 100.5),   # signal bar (14:00)
                (100.5, 100.6, 99.9, 100.2),     # fills at 100
                (100.2, 101.2, 100.1, 101.0),    # TP1 (0.5 @ 101) -> stop to BE
                (101.0, 102.1, 100.8, 102.0),    # TP2 (0.25 @ 102)
                (102.0, 103.5, 101.9, 103.2)])   # TP3 (0.25 @ 103)
    t = simulate(sig(), df)
    assert t.status == "win" and t.fill_price == 100.0
    assert t.r == pytest.approx(0.5 * 1 + 0.25 * 2 + 0.25 * 3)
    assert [e[3] for e in t.exits] == ["target"] * 3


def test_stop_loss():
    df = frame([(100.5, 100.6, 100.4, 100.5), (100.5, 100.6, 99.9, 100.2), (100.2, 100.3, 98.8, 99.0)])
    t = simulate(sig(), df)
    assert t.status == "loss" and t.r == pytest.approx(-1.0)


def test_breakeven_after_tp1():
    df = frame([(100.5, 100.6, 100.4, 100.5), (100.5, 100.6, 99.9, 100.2),
                (100.2, 101.2, 100.1, 101.0), (101.0, 101.1, 99.5, 99.6)])
    t = simulate(sig(), df)
    assert t.r == pytest.approx(0.5) and t.exits[-1][3] == "breakeven"


def test_same_bar_stop_and_target_assumes_stop():
    df = frame([(100.5, 100.6, 100.4, 100.5), (100.5, 100.6, 99.9, 100.2), (100.2, 101.5, 98.5, 100.0)])
    assert simulate(sig(), df).r == pytest.approx(-1.0)


def test_stop_on_fill_bar():
    df = frame([(100.5, 100.6, 100.4, 100.5), (100.5, 101.5, 98.5, 100.0)])
    t = simulate(sig(), df)
    assert t.r == pytest.approx(-1.0) and t.fill_time == utc("2025-07-15 14:01")


def test_signal_bar_cannot_fill():
    df = frame([(100.5, 100.6, 99.5, 100.5), (100.5, 100.8, 100.2, 100.6)] + [(100.6, 100.8, 100.3, 100.5)] * 40)
    assert simulate(sig(), df).status == "expired"


def test_gap_through_limit_fills_at_open_and_gap_through_stop_exits_at_open():
    df = frame([(100.5, 100.6, 100.4, 100.5), (99.8, 100.1, 99.7, 100.0), (98.5, 98.6, 98.0, 98.2)])
    t = simulate(sig(), df)
    assert t.fill_price == 99.8 and t.exits[0][1] == 98.5
    assert t.r == pytest.approx((98.5 - 99.8) / 1.0)


def test_time_stop_closes_if_tp1_not_reached():
    rows = [(100.5, 100.6, 100.4, 100.5), (100.5, 100.6, 99.9, 100.2)] + [(100.3, 100.6, 100.1, 100.4)] * 30
    t = simulate(sig(time_stop=utc("2025-07-15 14:20")), frame(rows))
    assert t.exits[-1][3] == "time_stop" and t.exit_time == utc("2025-07-15 14:20")
    assert t.r == pytest.approx(0.3)


def test_short_trade_and_spread():
    s = sig(direction=SHORT, entry=100.0, stop=101.0, targets=[(99.0, 1.0)])
    df = frame([(99.5, 99.6, 99.4, 99.5), (99.5, 100.1, 99.4, 99.8), (99.8, 99.9, 98.9, 99.0)])
    t = simulate(s, df, spread=0.1)
    assert t.fill_price == pytest.approx(99.9)  # sells the bid: entry worse by the spread
    assert t.r == pytest.approx(0.9)


def test_run_skips_overlapping_signals_and_stats():
    df = random_walk(2000, start="2025-07-15 13:00", seed=5)
    p = float(df.close.iloc[100])
    sigs = []
    for k in (100, 101, 600):
        ts = df.index[k]
        e = float(df.close.iloc[k])
        sigs.append(sig(created_time=ts, entry=e - 0.1, stop=e - 3.0,
                        targets=[(e + 2, 0.5), (e + 4, 0.5)], expiry=ts + pd.Timedelta(minutes=30)))
    trades = run(sigs, df)
    s = stats(trades)
    assert s["signals"] == len(trades) <= 3
    assert set(trades_frame(trades).columns) >= {"model", "r", "status"}
    assert p > 0
