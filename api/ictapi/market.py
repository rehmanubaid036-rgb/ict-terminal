"""Market data feeds for the charts. A ticker is ``FEED:SYMBOL`` (FUSION:XAUUSD, PEPPERSTONE:NAS100,
BINANCE:BTCUSDT). Feeds:

* MT5 brokers: every MT5 terminal installed inside the ICT folder (``mt5``, ``mt5-pepperstone`` ...,
  or listed in ICT_MT5_TERMINALS) is discovered on its own: the feed name comes from the account
  server and every chartable symbol is picked up whatever its suffix / prefix (XAUUSD.pro, XAUUSDm,
  #US30, US100.cash ...). ICC Terminal's terminals are never used.
* BINANCE: the 20 most traded USDT pairs, live, from Binance's free public data.

Providers return 1m candles (UTC index); ``bars`` returns any timeframe (Binance natively).
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import date

import pandas as pd

from ictengine.core.candles import resample
from ictengine.data import mt5 as m5
from ictengine.data.mt5 import ict_terminals
from ictengine.data.binance import STEP, Binance, BinanceError

log = logging.getLogger("ictapi.market")


@dataclass(frozen=True)
class SymbolInfo:
    ticker: str          # 'FUSION:XAUUSD'
    feed: str            # 'FUSION'
    symbol: str          # engine symbol 'XAUUSD'
    description: str
    type: str            # 'commodity' | 'index' | 'crypto' | 'forex'
    pricescale: int      # 10^decimals, UDF convention
    session: str = "24x7"
    source: str = ""     # the feed's own name, e.g. 'XAUUSD.pro' or 'BTCUSDT'


SESSIONS = {"forex": "1700-1700", "commodity": "1800-1700", "index": "1800-1700", "crypto": "24x7"}

# the fixed list used by tests / replays (FrameProvider)
STATIC_SYMBOLS: dict[str, SymbolInfo] = {s.ticker: s for s in (
    SymbolInfo("AXI:XAUUSD", "AXI", "XAUUSD", "Gold vs US Dollar", "commodity", 100, "1800-1700"),
    SymbolInfo("AXI:XAGUSD", "AXI", "XAGUSD", "Silver vs US Dollar", "commodity", 1000, "1800-1700"),
    SymbolInfo("AXI:NAS100", "AXI", "NAS100", "Nasdaq 100 CFD", "index", 10, "1800-1700"),
    SymbolInfo("AXI:US500", "AXI", "US500", "S&P 500 CFD", "index", 10, "1800-1700"),
    SymbolInfo("AXI:BTCUSD", "AXI", "BTCUSD", "Bitcoin vs US Dollar", "crypto", 100),
    SymbolInfo("AXI:EURUSD", "AXI", "EURUSD", "Euro vs US Dollar", "forex", 100000, "1700-1700"),
    SymbolInfo("AXI:GBPUSD", "AXI", "GBPUSD", "British Pound vs US Dollar", "forex", 100000, "1700-1700"),
)}
SYMBOLS = STATIC_SYMBOLS        # kept for older imports


def _empty() -> pd.DataFrame:
    return pd.DataFrame({k: pd.Series(dtype=float) for k in ("open", "high", "low", "close", "volume")},
                        index=pd.DatetimeIndex([], tz="UTC"))


class Provider:
    def symbols(self) -> dict[str, SymbolInfo]:
        return {}

    def candles(self, ticker: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        raise NotImplementedError

    def bars(self, ticker: str, tf: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        df = self.candles(ticker, start, end)
        if df.empty or tf == "1m":
            return df
        return resample(df, tf).drop(columns="n_bars")


class FrameProvider(Provider):
    """In-memory data (tests, replay)."""

    def __init__(self, frames: dict[str, pd.DataFrame], symbols: dict[str, SymbolInfo] | None = None):
        self.frames = frames
        self._symbols = symbols or STATIC_SYMBOLS

    def symbols(self):
        return self._symbols

    def candles(self, ticker, start, end):
        df = self.frames.get(ticker)
        if df is None:
            return _empty()
        return df[(df.index >= start) & (df.index < end)]


# ---- MT5 brokers ------------------------------------------------------------------------------
class MT5Provider(Provider):
    """Every ICT MT5 terminal, discovered and refreshed every ``refresh`` seconds."""

    def __init__(self, terminals: list[str] | None = None, refresh: float = 900):
        self._fixed = terminals
        self.refresh = refresh
        self._lock = threading.Lock()
        self._at = 0.0
        self._symbols: dict[str, SymbolInfo] = {}
        self._broker_key: dict[str, str] = {}        # feed -> registered broker key
        self.errors: dict[str, str] = {}             # terminal -> last discovery error

    def _discover(self) -> None:
        symbols, keys, errors = {}, {}, {}
        for path in (self._fixed if self._fixed is not None else ict_terminals()):
            try:
                d = m5.discover(path)
            except Exception as e:          # one dead terminal must not hide the others
                errors[path] = f"{type(e).__name__}: {e}"
                continue
            feed = d["feed"]
            n = 2
            while feed in keys:              # two terminals of the same broker
                feed, n = f"{d['feed']}{n}", n + 1
            key = feed.lower()
            m5.register_broker(key, path, d["offset"], {name: s["broker"] for name, s in d["symbols"].items()})
            keys[feed] = key
            for name, s in d["symbols"].items():
                t = f"{feed}:{name}"
                symbols[t] = SymbolInfo(t, feed, name, s["description"] or name, s["kind"], 10 ** max(0, s["digits"]),
                                        SESSIONS[s["kind"]], s["broker"])
        if symbols or not self._symbols:     # keep the last good list while terminals restart
            self._symbols, self._broker_key = symbols, keys
        self.errors = errors
        self._at = time.time()

    def symbols(self):
        with self._lock:
            if time.time() - self._at > (self.refresh if self._symbols else 60):
                self._discover()
            return self._symbols

    def candles(self, ticker, start, end):
        info = self.symbols().get(ticker)
        if info is None:
            return _empty()
        df = m5.load(self._broker_key[info.feed], info.symbol, start.date(), end.date())
        return df[(df.index >= start) & (df.index < end)]


# ---- Binance ----------------------------------------------------------------------------------
class BinanceProvider(Provider):
    """Top 20 USDT pairs. 1m history is capped (``max_1m_days``) and cached, so ICT layers stay light."""

    def __init__(self, client: Binance | None = None, top: int = 20, max_1m_days: int = 14):
        self.client = client or Binance()
        self.top = top
        self.max_1m = pd.Timedelta(days=max_1m_days)
        self._lock = threading.Lock()
        self._cache: dict[str, pd.DataFrame] = {}
        self._symbols: dict[str, SymbolInfo] = {}
        self._at = 0.0

    def symbols(self):
        with self._lock:
            if time.time() - self._at > (3600 if self._symbols else 120):
                self._at = time.time()
                try:
                    self._symbols = {f"BINANCE:{p['symbol']}": SymbolInfo(
                        f"BINANCE:{p['symbol']}", "BINANCE", p["symbol"], f"{p['base']} / Tether (Binance)", "crypto",
                        10 ** p["decimals"], "24x7", p["symbol"]) for p in self.client.top_usdt(self.top)}
                except BinanceError as e:
                    log.warning("binance symbols: %s", e)
            return self._symbols

    def candles(self, ticker, start, end):
        info = self.symbols().get(ticker)
        if info is None:
            return _empty()
        end = min(end, pd.Timestamp.now(tz="UTC").ceil("min"))
        start = max(start, end - self.max_1m)
        with self._lock:
            have = self._cache.get(info.source, _empty())
            parts = [have]
            if have.empty or start < have.index[0]:
                parts.append(self.client.klines(info.source, "1m", start, have.index[0] if len(have) else end,
                                                max_bars=10 ** 6))
            if len(have) and end > have.index[-1]:
                parts.append(self.client.klines(info.source, "1m", have.index[-1], end, max_bars=10 ** 6))
            df = pd.concat([p for p in parts if len(p)]) if any(len(p) for p in parts) else _empty()
            df = df[~df.index.duplicated(keep="last")].sort_index()
            df = df[df.index >= pd.Timestamp.now(tz="UTC") - self.max_1m - pd.Timedelta(days=1)]
            self._cache[info.source] = df
        return df[(df.index >= start) & (df.index < end)]

    def bars(self, ticker, tf, start, end):
        if tf == "1m":
            return self.candles(ticker, start, end)
        info = self.symbols().get(ticker)
        if info is None:
            return _empty()
        df = self.client.klines(info.source, tf, start, end, max_bars=5000)
        # the newest bar is still forming: keep it, the chart updates it
        return df[df.index < end + pd.Timedelta(seconds=STEP[tf])]


class MultiProvider(Provider):
    """All feeds behind one provider; a ticker goes to the feed that lists it."""

    def __init__(self, providers: list[Provider]):
        self.providers = providers

    def symbols(self):
        out: dict[str, SymbolInfo] = {}
        for p in self.providers:
            try:
                out.update(p.symbols())
            except Exception as e:           # a feed that is down only removes its own symbols
                log.warning("feed %s: %s", type(p).__name__, e)
        return out

    def _owner(self, ticker: str) -> Provider | None:
        for p in self.providers:
            if ticker in p.symbols():
                return p
        return None

    def candles(self, ticker, start, end):
        p = self._owner(ticker)
        return p.candles(ticker, start, end) if p else _empty()

    def bars(self, ticker, tf, start, end):
        p = self._owner(ticker)
        return p.bars(ticker, tf, start, end) if p else _empty()


def default_provider() -> Provider:
    return MultiProvider([MT5Provider(), BinanceProvider()])


def utc_range(frm: int, to: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    return pd.Timestamp(frm, unit="s", tz="UTC"), pd.Timestamp(to, unit="s", tz="UTC")


def today_utc() -> date:
    return pd.Timestamp.now(tz="UTC").date()
