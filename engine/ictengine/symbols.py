"""Per-instrument settings the models need (rulebook 0, 2.11b)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SymbolSpec:
    name: str
    tick_size: float          # smallest price step
    big_figure: float         # grid for institutional .00/.20/.50/.80 levels
    min_fvg: float            # rulebook 2.6 [DEFAULT] minimum FVG height
    stop_buffer: float        # distance placed beyond a sweep extreme for the stop
    smt_partner: str | None = None
    spread: float = 0.0       # typical retail spread (price units), charged in every backtest
    min_target: float = 0.0   # rulebook M1 "min target": indices ~10 points, FX ~15 pips; others [DEFAULT]


SYMBOLS: dict[str, SymbolSpec] = {
    "XAUUSD": SymbolSpec("XAUUSD", 0.01, 100.0, 0.30, 0.20, "XAGUSD", 0.30, 3.0),
    "XAGUSD": SymbolSpec("XAGUSD", 0.001, 1.0, 0.01, 0.005, "XAUUSD", 0.03, 0.10),
    "NAS100": SymbolSpec("NAS100", 0.1, 1000.0, 2.0, 1.0, "US500", 1.5, 10.0),
    "US500": SymbolSpec("US500", 0.1, 100.0, 0.5, 0.25, "NAS100", 0.5, 2.5),
    "BTCUSD": SymbolSpec("BTCUSD", 0.01, 1000.0, 15.0, 5.0, "ETHUSD", 15.0, 100.0),
    "EURUSD": SymbolSpec("EURUSD", 0.00001, 0.01, 0.0002, 0.0001, "GBPUSD", 0.0001, 0.0015),
    "GBPUSD": SymbolSpec("GBPUSD", 0.00001, 0.01, 0.0002, 0.0001, "EURUSD", 0.00012, 0.0015),
}


def spec(symbol: str) -> SymbolSpec:
    try:
        return SYMBOLS[symbol]
    except KeyError:
        raise KeyError(f"no SymbolSpec for {symbol!r}; add it to ictengine.symbols.SYMBOLS") from None
