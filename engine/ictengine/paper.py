"""Paper trading: orders and positions checked against 1-minute bars.

An order is checked lazily: whenever the account is read, the bars since the order was last
checked are walked in time order, so fills, stops and targets are right even if nobody had the
terminal open. Rules (conservative, like the backtest simulator):
  * market orders fill at the price when they were placed;
  * a limit buy fills when a bar trades at or below the limit (at the limit, or at the open if the
    bar gaps through it); a stop buy fills when a bar trades at or above the stop. Sells mirror it;
  * after the fill, a bar that reaches both the stop loss and the take profit closes at the stop;
  * the fill bar itself only checks the stop loss.
P&L = (exit - entry) x quantity x direction, in the instrument's quote currency.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

WORKING, OPEN, CLOSED, CANCELLED = "working", "open", "closed", "cancelled"


@dataclass
class PaperOrder:
    id: int
    ticker: str
    side: int                  # +1 buy, -1 sell
    type: str                  # market | limit | stop
    qty: float
    price: float | None        # limit / stop price; fill price for a market order
    sl: float | None
    tp: float | None
    status: str
    created: pd.Timestamp
    checked_until: pd.Timestamp
    fill_price: float | None = None
    filled_at: pd.Timestamp | None = None
    exit_price: float | None = None
    closed_at: pd.Timestamp | None = None
    exit_reason: str = ""
    pnl: float = 0.0


def _close(o: PaperOrder, price: float, at: pd.Timestamp, why: str) -> None:
    o.exit_price, o.closed_at, o.exit_reason, o.status = float(price), at, why, CLOSED
    o.pnl = (o.exit_price - (o.fill_price or 0.0)) * o.qty * o.side


def advance(o: PaperOrder, bars: pd.DataFrame) -> PaperOrder:
    """Walks 1m ``bars`` (UTC index, open/high/low/close) after ``o.checked_until``."""
    if o.status not in (WORKING, OPEN):
        return o
    new = bars[bars.index > o.checked_until]
    for ts, b in new.iterrows():
        h, lo, op = float(b["high"]), float(b["low"]), float(b["open"])
        just_filled = False
        if o.status == WORKING:
            p = float(o.price or 0)
            buy = o.side > 0
            if o.type == "limit" and ((buy and lo <= p) or (not buy and h >= p)):
                o.fill_price = min(p, op) if buy else max(p, op)
            elif o.type == "stop" and ((buy and h >= p) or (not buy and lo <= p)):
                o.fill_price = max(p, op) if buy else min(p, op)
            else:
                o.checked_until = ts
                continue
            o.status, o.filled_at, just_filled = OPEN, ts, True
        # an open position: stop loss first (also on the fill bar), then take profit
        d = o.side
        if o.sl is not None and ((d > 0 and lo <= o.sl) or (d < 0 and h >= o.sl)):
            gap = op if not just_filled and ((d > 0 and op < o.sl) or (d < 0 and op > o.sl)) else o.sl
            _close(o, gap, ts, "stop loss")
        elif not just_filled and o.tp is not None and ((d > 0 and h >= o.tp) or (d < 0 and lo <= o.tp)):
            gap = op if (d > 0 and op > o.tp) or (d < 0 and op < o.tp) else o.tp
            _close(o, gap, ts, "take profit")
        o.checked_until = ts
        if o.status == CLOSED:
            break
    return o


def unrealized(o: PaperOrder, price: float | None) -> float:
    if o.status != OPEN or price is None or o.fill_price is None:
        return 0.0
    return (price - o.fill_price) * o.qty * o.side


def validate(side: int, type_: str, qty: float, price: float | None, sl: float | None, tp: float | None, last: float) -> str | None:
    """A message for an order that cannot be placed, else None."""
    if side not in (1, -1) or type_ not in ("market", "limit", "stop"):
        return "Choose buy or sell and the order type."
    if not (qty > 0) or qty > 1e9:
        return "Enter a quantity."
    ref = last if type_ == "market" else price
    if ref is None or not (ref > 0):
        return "Enter the order price."
    if type_ == "limit" and ((side > 0 and ref > last) or (side < 0 and ref < last)):
        return "A buy limit goes below the price, a sell limit above (use a stop order otherwise)."
    if type_ == "stop" and ((side > 0 and ref < last) or (side < 0 and ref > last)):
        return "A buy stop goes above the price, a sell stop below."
    if sl is not None and side * (ref - sl) <= 0:
        return "The stop loss must be below a buy's entry and above a sell's."
    if tp is not None and side * (tp - ref) <= 0:
        return "The take profit must be above a buy's entry and below a sell's."
    return None
