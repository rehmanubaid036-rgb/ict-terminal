"""Paper trading fills, stops and targets on 1m bars."""
import pandas as pd

from ictengine import paper as pp


def bars(rows, start="2026-10-01 14:00"):
    idx = pd.date_range(pd.Timestamp(start, tz="UTC"), periods=len(rows), freq="1min")
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)


def order(**kw):
    t0 = pd.Timestamp("2026-10-01 13:59", tz="UTC")
    base = dict(id=1, ticker="AXI:XAUUSD", side=1, type="limit", qty=2, price=100.0, sl=95.0, tp=110.0, status=pp.WORKING,
                created=t0, checked_until=t0)
    base.update(kw)
    return pp.PaperOrder(**base)


def test_limit_buy_fills_then_hits_target():
    o = pp.advance(order(), bars([(103, 104, 101, 102), (102, 102, 99.5, 101), (101, 111, 100.5, 109)]))
    assert (o.fill_price, o.exit_price, o.exit_reason, o.status) == (100.0, 110.0, "take profit", pp.CLOSED)
    assert o.pnl == (110 - 100) * 2


def test_gap_through_the_limit_fills_at_the_open_and_stop_wins_a_wide_bar():
    o = pp.advance(order(), bars([(98, 99, 97, 98)]))
    assert o.fill_price == 98 and o.status == pp.OPEN              # gapped below the limit: filled at the open
    o = pp.advance(o, bars([(98, 111, 94, 100)], start="2026-10-01 14:01"))
    assert (o.exit_price, o.exit_reason) == (95.0, "stop loss")    # both in one bar: the stop first


def test_sell_stop_and_waiting_order_keeps_its_place():
    o = order(side=-1, type="stop", price=100.0, sl=104.0, tp=90.0)
    pp.advance(o, bars([(102, 103, 101, 102)]))
    assert o.status == pp.WORKING and o.checked_until == pd.Timestamp("2026-10-01 14:00", tz="UTC")
    pp.advance(o, bars([(102, 102, 99, 99.5), (99.5, 99.8, 89, 90)], start="2026-10-01 14:01"))
    assert (o.fill_price, o.exit_price, o.status) == (100.0, 90.0, pp.CLOSED) and o.pnl == 20


def test_validation():
    assert pp.validate(1, "limit", 1, 105, None, None, 100) is not None          # buy limit above the price
    assert pp.validate(1, "market", 1, None, 101, None, 100) is not None         # stop above a buy
    assert pp.validate(-1, "market", 1, None, 101, 95, 100) is None
    assert pp.unrealized(order(status=pp.OPEN, fill_price=100.0), 103) == 6
