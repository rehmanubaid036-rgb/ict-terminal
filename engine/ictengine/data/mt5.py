"""1m candles from a broker's MetaTrader 5 terminal (Python ``MetaTrader5`` package, Windows).

MT5 returns bar times in the broker's *server* time. Most CFD brokers run "New York close"
servers: server time = New York time + 7h (UTC+2 in winter, UTC+3 in summer, switching with
US DST). ``BROKERS`` stores that offset per broker, verified against Dukascopy UTC data.
Daylight-saving switches happen on Sunday mornings while markets are closed, so bars whose
local time is ambiguous or non-existent are dropped (there are none in practice).

Complete months are cached as pickles under ``data/mt5/<broker>/<SYMBOL>/YYYY-MM.pkl``.
"""
from __future__ import annotations

import glob
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from ..core.clock import NY

ICT_ROOT = Path(__file__).resolve().parents[3]       # the ICT folder (C:\ICT Engine on the VPS)
DEFAULT_CACHE = ICT_ROOT / "data" / "mt5"


@dataclass(frozen=True)
class Broker:
    key: str
    terminal: str                       # path to terminal64.exe
    server_minus_ny_hours: int = 7      # server time = NY time + this
    symbols: dict[str, str] = field(default_factory=dict)  # engine symbol -> broker symbol


BROKERS: dict[str, Broker] = {
    "axi_demo": Broker("axi_demo", r"E:\axi mt5 new 25 april\terminal64.exe", 7, {
        "XAUUSD": "XAUUSD.pro", "XAGUSD": "XAGUSD.pro", "NAS100": "NAS100.fs", "US500": "US500",
        "US30": "US30", "BTCUSD": "BTCUSD", "EURUSD": "EURUSD.pro", "GBPUSD": "GBPUSD.pro",
    }),
}


class MT5Error(RuntimeError):
    pass


# Other names brokers use for the same market (account types add suffixes such as .pro / .a / m).
ALIASES: dict[str, tuple[str, ...]] = {
    "XAUUSD": ("XAUUSD", "GOLD"), "XAGUSD": ("XAGUSD", "SILVER"),
    "NAS100": ("NAS100", "US100", "USTEC", "NDX100", "NQ100", "USTECH"),
    "US500": ("US500", "SPX500", "SP500", "US500CASH", "USA500"),
    "US30": ("US30", "DJ30", "WS30", "DOW30", "USA30"),
    "BTCUSD": ("BTCUSD", "BITCOIN"), "EURUSD": ("EURUSD",), "GBPUSD": ("GBPUSD",),
}
_resolved: dict[tuple[str, str], str] = {}     # (terminal path, engine symbol) -> broker symbol


def resolve_symbol(mt5, broker: Broker, symbol: str) -> str:
    """The name of ``symbol`` on the connected terminal: the configured name, then common aliases,
    then an alias with the account's suffix (XAUUSD.pro, XAUUSDm, US500.cash ...)."""
    key = (terminal_path(broker), symbol)
    if key in _resolved:
        return _resolved[key]
    configured = broker.symbols.get(symbol)
    bases = ([configured] if configured else []) + list(ALIASES.get(symbol, (symbol,)))
    if not hasattr(mt5, "symbol_info"):            # minimal fakes in tests
        return configured or symbol
    found = next((b for b in bases if mt5.symbol_info(b) is not None), None)
    if found is None:
        names = [s.name for s in (mt5.symbols_get() or ())]
        for base in bases:
            plain = base.split(".")[0].upper()
            hits = sorted((n for n in names if n.upper().startswith(plain) and len(n) - len(plain) <= 6), key=len)
            if hits:
                found = hits[0]
                break
    if found is None:
        raise MT5Error(f"{symbol} is not offered by the MT5 terminal {key[0]} (tried {', '.join(bases)} and suffixes)")
    _resolved[key] = found
    return found


def server_to_utc(times: pd.DatetimeIndex, server_minus_ny_hours: int) -> pd.DatetimeIndex:
    """Naive server timestamps -> UTC (NaT where the NY wall time is ambiguous/missing)."""
    ny_wall = times - pd.Timedelta(hours=server_minus_ny_hours)
    return ny_wall.tz_localize(NY, ambiguous="NaT", nonexistent="NaT").tz_convert("UTC")


def rates_to_frame(rates, server_minus_ny_hours: int) -> pd.DataFrame:
    if rates is None or len(rates) == 0:
        return _empty()
    raw = pd.DataFrame(rates)
    idx = server_to_utc(pd.DatetimeIndex(pd.to_datetime(raw["time"], unit="s")), server_minus_ny_hours)
    df = pd.DataFrame({"open": raw["open"].to_numpy(float), "high": raw["high"].to_numpy(float),
                       "low": raw["low"].to_numpy(float), "close": raw["close"].to_numpy(float),
                       "volume": raw["tick_volume"].to_numpy(float)}, index=idx)
    df = df[df.index.notna()]
    return df[~df.index.duplicated(keep="first")].sort_index()


def terminal_path(broker: Broker) -> str:
    """The broker's terminal64.exe; ICT_MT5_<KEY>_TERMINAL (e.g. ICT_MT5_AXI_DEMO_TERMINAL) overrides
    the built-in path, so the VPS can use its own installation."""
    return os.getenv(f"ICT_MT5_{broker.key.upper()}_TERMINAL", "").strip() or broker.terminal


# The MetaTrader5 package talks to one terminal through one global connection, so every call is
# serialised. After a failed connect the next attempt waits RETRY_AFTER seconds: without that, each
# chart request would wait for its own IPC timeout and tie up the API (logins and sign-ups too).
_lock = threading.RLock()
CONNECT_TIMEOUT_MS = 30_000
RETRY_AFTER = 60.0
_failed: dict[str, tuple[float, str]] = {}     # terminal path -> (time of failure, message)


def _connect(broker: Broker):
    import MetaTrader5 as mt5  # Windows-only dependency, imported lazily
    path = terminal_path(broker)
    last = _failed.get(path)
    if last and time.monotonic() - last[0] < RETRY_AFTER:
        wait = int(RETRY_AFTER - (time.monotonic() - last[0])) + 1
        raise MT5Error(f"{last[1]} (next try in {wait}s)")
    global _current
    if _current and _current != path and hasattr(mt5, "shutdown"):
        mt5.shutdown()                      # the package talks to one terminal at a time
        _current = None
    if not mt5.initialize(path=path, timeout=CONNECT_TIMEOUT_MS):
        msg = f"cannot start/attach MT5 terminal {path}: {mt5.last_error()}"
        _failed[path] = (time.monotonic(), msg)
        raise MT5Error(msg)
    _failed.pop(path, None)
    _current = path
    return mt5


_current: str | None = None      # terminal the package is connected to
LIVE_TTL = 2.0                   # seconds a running month is reused before asking MT5 again
_live: dict[tuple, tuple[float, pd.DataFrame]] = {}   # (broker, symbol, year, month, tf) -> (fetched at, bars)
# MT5 timeframes read directly (charts): M1 .. H1. The broker's server clock is New York + whole hours, so these
# bars start on New York minutes / hours; 2h, 4h, day and week are built from H1 on the New York 18:00 day.
NATIVE_TF = {"M1": "TIMEFRAME_M1", "M3": "TIMEFRAME_M3", "M5": "TIMEFRAME_M5", "M15": "TIMEFRAME_M15",
             "M30": "TIMEFRAME_M30", "H1": "TIMEFRAME_H1"}
EMPTY_TTL = 6 * 3600              # a finished month with no bars (before the broker's history) is not asked again for 6 h
_empty_months: dict[tuple, float] = {}


def server_minus_ny(mt5, symbols, default: int = 7) -> int:
    """Hours the broker's server clock is ahead of New York, read from the freshest live tick of
    ``symbols`` (a name or a list; put a 24/7 market such as BTCUSD in it so weekends work).
    Falls back to ``default`` (NY+7, the usual "New York close" server) when no tick is fresh.

    A closed market's last tick is hours old; its age can land close to a whole number of hours and
    look like a clock offset (a restart at 04:00 UTC on a Saturday read EURUSD's Friday tick as
    "offset 0" and moved every CFD candle 7 hours). So the freshest tick of several markets is used
    and it must sit within 2 minutes of a whole hour."""
    if isinstance(symbols, str):
        symbols = [symbols]
    if not hasattr(mt5, "symbol_info_tick"):
        return default
    utc = pd.Timestamp.now(tz="UTC")
    weekend = utc.weekday() == 5 or (utc.weekday() == 4 and utc.hour >= 21) or (utc.weekday() == 6 and utc.hour < 22)
    if weekend:   # FX / CFD ticks are a day old at weekends: only a 24/7 market can tell the clock
        symbols = [n for n in symbols if n and n.upper().startswith(("BTC", "ETH"))]
    ticks = []
    for name in symbols:
        tick = mt5.symbol_info_tick(name) if name else None
        if tick is not None and getattr(tick, "time", 0):
            ticks.append(int(tick.time))
    if not ticks:
        return default
    diff = (max(ticks) - time.time()) / 3600       # server-clock seconds read as UTC, minus UTC now
    hours = round(diff)
    if abs(diff - hours) > 2 / 60 or not -12 <= hours <= 14:   # no fresh tick (closed markets)
        return default
    ny = pd.Timestamp.now(tz=NY).utcoffset().total_seconds() / 3600
    return int(hours - ny)


def _first_with_data(mt5, items: list[tuple[str, str]]) -> tuple[str, str]:
    if len(items) == 1 or not hasattr(mt5, "copy_rates_from_pos"):
        return items[0]
    for name, kind in items:
        mt5.symbol_select(name, True)
        rates = mt5.copy_rates_from_pos(name, mt5.TIMEFRAME_M1, 0, 5)
        if rates is not None and len(rates):
            return name, kind
    return items[0]


def register_broker(key: str, terminal: str, offset: int, symbols: dict[str, str]) -> Broker:
    """Adds / replaces a broker discovered at run time (see ``discover``)."""
    b = Broker(key, terminal, offset, dict(symbols))
    BROKERS[key] = b
    for name, bname in symbols.items():
        _resolved[(terminal, name)] = bname
    return b


def discover(terminal: str) -> dict:
    """Everything the charts need from one MT5 terminal: its feed name (from the account server),
    the clock offset and every chartable symbol with the broker's own spelling and digits."""
    from .brokers import feed_name, rank_names
    with _lock:
        probe = Broker("probe", terminal, 7, {})
        mt5 = _connect(probe)
        acc = mt5.account_info()
        server = getattr(acc, "server", "") if acc else ""
        all_syms = list(mt5.symbols_get() or ())
        ranked = rank_names([s.name for s in all_syms], [s.name for s in all_syms if getattr(s, "visible", False)],
                            [s.name for s in all_syms if getattr(s, "trade_mode", 4) == 0])   # 0 = disabled
        # a market listed under several names (Axi Standard also lists XAUUSD.pro, whose history
        # that account cannot load): use the first name that really returns candles
        picked = {name: _first_with_data(mt5, items) for name, items in ranked.items()}
        by_name = {s.name: s for s in all_syms}
        # the clock offset from the freshest of several liquid markets (BTCUSD keeps ticking at weekends)
        liquid = [picked[n][0] for n in ("BTCUSD", "EURUSD", "XAUUSD", "GBPUSD") if n in picked]
        for name in liquid:
            mt5.symbol_select(name, True)
        offset = server_minus_ny(mt5, liquid) if liquid else 7
        symbols = {name: {"broker": bname, "kind": kind, "digits": int(getattr(by_name[bname], "digits", 2)),
                          "description": str(getattr(by_name[bname], "description", "") or name)}
                   for name, (bname, kind) in picked.items()}
        return {"terminal": terminal, "server": server, "feed": feed_name(server), "offset": offset,
                "demo": bool(acc and getattr(acc, "trade_mode", 2) == 0), "symbols": symbols}


def fetch_month(broker_key: str, symbol: str, year: int, month: int, cache_dir: Path = DEFAULT_CACHE,
                mt5=None, timeframe: str = "M1") -> pd.DataFrame:
    broker = BROKERS[broker_key]
    if symbol not in broker.symbols and symbol not in ALIASES:
        raise KeyError(f"{symbol} is not mapped for broker {broker_key}")
    if timeframe not in NATIVE_TF:
        raise ValueError(f"unsupported MT5 timeframe {timeframe}")
    # M1 keeps its old place (existing caches); other timeframes get their own folder
    folder = Path(cache_dir) / broker_key / symbol if timeframe == "M1" else Path(cache_dir) / broker_key / symbol / timeframe
    path = folder / f"{year:04d}-{month:02d}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    complete = pd.Timestamp(end) <= pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=1)
    key = (broker_key, symbol, year, month, timeframe)
    if complete and time.monotonic() - _empty_months.get(key, -1e18) < EMPTY_TTL:
        return _empty()                      # known to have no history: do not ask MT5 again yet
    live = None if complete else _live.get(key)
    if live and time.monotonic() - live[0] < LIVE_TTL:
        return live[1]                       # charts poll every few seconds: share one fetch
    mt5 = mt5 or _connect(broker)
    tf_const = getattr(mt5, NATIVE_TF[timeframe])
    bsym = resolve_symbol(mt5, broker, symbol)
    mt5.symbol_select(bsym, True)
    if live is not None and len(live[1]):
        # the running month: only the newest bars (12 h back covers any server-clock offset)
        frm = (live[1].index[-1] - pd.Timedelta(hours=12)).to_pydatetime()
        rates = mt5.copy_rates_range(bsym, tf_const, frm, end + pd.Timedelta(days=1))
    else:
        # request a day either side: server time is ahead of UTC, the frame is trimmed after conversion
        rates = mt5.copy_rates_range(bsym, tf_const, start - pd.Timedelta(days=1), end + pd.Timedelta(days=1))
    if rates is None:
        if complete and timeframe != "M1":
            _empty_months[key] = time.monotonic()      # before the broker's history: an empty month, not an error
            return _empty()
        raise MT5Error(f"copy_rates_range {bsym} {year}-{month:02d}: {mt5.last_error()}")
    df = rates_to_frame(rates, broker.server_minus_ny_hours)
    df = df[(df.index >= pd.Timestamp(start)) & (df.index < pd.Timestamp(end))]
    if live is not None and len(live[1]):
        old = live[1]
        df = pd.concat([old[old.index < df.index[0]], df]) if len(df) else old
    if complete and len(df):
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_pickle(path)
        _live.pop(key, None)
    elif complete:
        _empty_months[key] = time.monotonic()
    elif not complete:
        _live[key] = (time.monotonic(), df)
    return df


def load(broker_key: str, symbol: str, start: date, end: date, **kw) -> pd.DataFrame:
    """1m candles (UTC) from ``start`` to ``end`` inclusive, month by month."""
    with _lock:
        return _load(broker_key, symbol, start, end, **kw)


def _load(broker_key: str, symbol: str, start: date, end: date, **kw) -> pd.DataFrame:
    mt5 = None
    frames = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        frames.append(fetch_month(broker_key, symbol, y, m, mt5=mt5, **kw))   # connects only when needed
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    frames = [f for f in frames if len(f)]
    if not frames:
        return _empty()
    df = pd.concat(frames).sort_index()
    df = df[~df.index.duplicated(keep="first")]
    lo = pd.Timestamp(start, tz="UTC")
    hi = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
    return df[(df.index >= lo) & (df.index < hi)]


MAX_TICKS = 300_000


def ticks(broker_key: str, symbol: str, start: pd.Timestamp, end: pd.Timestamp, mt5=None) -> pd.DataFrame:
    """Ticks [start, end) (UTC) with a ``price`` column (last trade, else bid) and ``volume`` (1 per tick
    when the broker sends none). For seconds charts; never cached."""
    broker = BROKERS[broker_key]
    with _lock:
        mt5 = mt5 or _connect(broker)
        bsym = resolve_symbol(mt5, broker, symbol)
        mt5.symbol_select(bsym, True)
        # MT5 reads the times as the server's clock: NY wall time + the server offset
        to_server = lambda t: (t.tz_convert(NY).tz_localize(None) + pd.Timedelta(hours=broker.server_minus_ny_hours)).to_pydatetime().replace(tzinfo=timezone.utc)  # noqa: E731
        raw = mt5.copy_ticks_range(bsym, to_server(start), to_server(end), mt5.COPY_TICKS_ALL)
    if raw is None:
        raise MT5Error(f"copy_ticks_range {bsym}: {mt5.last_error()}")
    if len(raw) == 0:
        return pd.DataFrame({"price": pd.Series(dtype=float), "volume": pd.Series(dtype=float)}, index=pd.DatetimeIndex([], tz="UTC"))
    t = pd.DataFrame(raw)[-MAX_TICKS:]
    naive = pd.DatetimeIndex(pd.to_datetime(t["time_msc"], unit="ms"))
    idx = server_to_utc(naive, broker.server_minus_ny_hours)
    last = t["last"].to_numpy(float) if "last" in t else None
    bid = t["bid"].to_numpy(float)
    price = bid if last is None else pd.Series(last).where(pd.Series(last) > 0, pd.Series(bid)).to_numpy(float)
    vol = t["volume"].to_numpy(float) if "volume" in t else None
    out = pd.DataFrame({"price": price, "volume": vol if vol is not None and vol.sum() > 0 else 1.0}, index=idx)
    out = out[out.index.notna() & (out["price"] > 0)]
    return out[(out.index >= start) & (out.index < end)]


def ticks_to_bars(t: pd.DataFrame, seconds: int) -> pd.DataFrame:
    """OHLC bars of ``seconds`` from ticks (bars without a tick are left out, like the broker's)."""
    if t.empty:
        return _empty()
    g = t.resample(f"{seconds}s", label="left", closed="left")
    df = pd.DataFrame({"open": g["price"].first(), "high": g["price"].max(), "low": g["price"].min(),
                       "close": g["price"].last(), "volume": g["volume"].sum()})
    return df.dropna(subset=["open"])


def _empty() -> pd.DataFrame:
    return pd.DataFrame({k: pd.Series(dtype=float) for k in ("open", "high", "low", "close", "volume")},
                        index=pd.DatetimeIndex([], tz="UTC"))


def ict_terminals(root: Path = ICT_ROOT) -> list[str]:
    """MT5 terminals that belong to ICT: ICT_MT5_TERMINALS (paths separated by ;), the older
    ICT_MT5_AXI_DEMO_TERMINAL, and any terminal64.exe in <ICT folder>/mt5*/. Never ICC's."""
    paths = [p.strip().strip('"') for p in os.getenv("ICT_MT5_TERMINALS", "").split(";") if p.strip()]
    legacy = os.getenv("ICT_MT5_AXI_DEMO_TERMINAL", "").strip().strip('"')
    if legacy:
        paths.append(legacy)
    paths += [b.terminal for b in BROKERS.values() if b.key == "axi_demo"]   # the development PC's demo
    for pattern in ("mt5*/terminal64.exe", "mt5*/*/terminal64.exe"):   # "mt5" (the main one) first
        paths += sorted(glob.glob(str(root / pattern)), key=lambda p: (Path(p).parent.name.lower(), p))
    seen, out = set(), []
    for p in paths:
        key = os.path.normcase(os.path.abspath(p))
        if key not in seen and os.path.isfile(p):
            seen.add(key)
            out.append(p)
    return out
