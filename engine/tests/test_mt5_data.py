"""MT5 data conversion tests (no terminal needed)."""
import numpy as np
import pandas as pd
import pytest

from ictengine.data.mt5 import BROKERS, rates_to_frame, server_to_utc


def rates(times, base=100.0):
    n = len(times)
    arr = np.zeros(n, dtype=[("time", "<i8"), ("open", "<f8"), ("high", "<f8"), ("low", "<f8"), ("close", "<f8"),
                             ("tick_volume", "<u8"), ("spread", "<i4"), ("real_volume", "<u8")])
    arr["time"] = [int(pd.Timestamp(t).timestamp()) for t in times]
    arr["open"] = arr["close"] = base
    arr["high"], arr["low"] = base + 1, base - 1
    arr["tick_volume"] = 5
    return arr


def test_server_time_is_new_york_plus_seven_hours():
    # Sunday 18:00 NY week open = server 01:00 Monday, in summer (UTC+3) and in winter (UTC+2)
    idx = pd.DatetimeIndex(["2026-07-06 01:00", "2026-01-05 01:00"])
    utc = server_to_utc(idx, 7)
    assert list(utc) == [pd.Timestamp("2026-07-05 22:00", tz="UTC"), pd.Timestamp("2026-01-04 23:00", tz="UTC")]


def test_rates_to_frame_columns_and_order():
    df = rates_to_frame(rates(["2026-09-03 17:01", "2026-09-03 17:00"]), 7)
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert df.index.is_monotonic_increasing and str(df.index.tz) == "UTC"
    assert df.index[0] == pd.Timestamp("2026-09-03 14:00", tz="UTC")  # 10:00 NY = server 17:00
    assert df.volume.iloc[0] == 5.0


def test_dst_gap_bars_are_dropped_not_misplaced():
    # NY 2026-03-08 02:30 does not exist (spring forward) -> server 09:30 that day is dropped
    df = rates_to_frame(rates(["2026-03-08 09:30", "2026-03-09 17:00"]), 7)
    assert len(df) == 1 and df.index[0] == pd.Timestamp("2026-03-09 14:00", tz="UTC")  # EDT from 8 Mar


def test_empty_rates():
    assert rates_to_frame(None, 7).empty
    assert rates_to_frame(rates([]), 7).empty


def test_broker_symbol_maps():
    axi = BROKERS["axi_demo"]
    assert axi.symbols["XAUUSD"] == "XAUUSD.pro" and axi.server_minus_ny_hours == 7


def test_terminal_path_can_be_overridden(monkeypatch):
    from ictengine.data.mt5 import terminal_path
    axi = BROKERS["axi_demo"]
    monkeypatch.delenv("ICT_MT5_AXI_DEMO_TERMINAL", raising=False)
    assert terminal_path(axi) == axi.terminal
    monkeypatch.setenv("ICT_MT5_AXI_DEMO_TERMINAL", r"C:\MT5\terminal64.exe")
    assert terminal_path(axi) == r"C:\MT5\terminal64.exe"


def test_failed_connect_is_not_retried_for_a_minute(monkeypatch):
    import sys, types
    from ictengine.data import mt5 as m5
    calls = []
    fake = types.SimpleNamespace(initialize=lambda **kw: calls.append(kw) or False,
                                 last_error=lambda: (-10005, "IPC timeout"))
    monkeypatch.setitem(sys.modules, "MetaTrader5", fake)
    monkeypatch.setattr(m5, "_failed", {})
    clock = [1000.0]
    monkeypatch.setattr(m5.time, "monotonic", lambda: clock[0])
    broker = m5.BROKERS["axi_demo"]
    with pytest.raises(m5.MT5Error, match="IPC timeout"):
        m5._connect(broker)
    assert len(calls) == 1 and calls[0]["timeout"] == m5.CONNECT_TIMEOUT_MS
    clock[0] += 10
    with pytest.raises(m5.MT5Error, match="next try in 51s"):     # fails at once, no second IPC wait
        m5._connect(broker)
    assert len(calls) == 1
    clock[0] += 51
    fake.initialize = lambda **kw: calls.append(kw) or True          # terminal is back
    assert m5._connect(broker) is fake and len(calls) == 2
    assert m5._failed == {}


class _Terminal:
    """Fake MetaTrader5 module offering a fixed list of symbol names."""

    def __init__(self, names):
        self.names = names

    def symbol_info(self, name):
        return object() if name in self.names else None

    def symbols_get(self):
        import types
        return [types.SimpleNamespace(name=n) for n in self.names]


@pytest.mark.parametrize("names, symbol, expected", [
    (["XAUUSD.pro", "NAS100.fs", "US500"], "XAUUSD", "XAUUSD.pro"),          # Axi Pro account: the configured names
    (["XAUUSD", "US100", "US500", "BTCUSD"], "XAUUSD", "XAUUSD"),            # Fusion / Axi Standard: no suffix
    (["XAUUSD", "US100", "US500", "BTCUSD"], "NAS100", "US100"),             # another name for the Nasdaq
    (["XAUUSDm", "USTECm", "US500m"], "XAUUSD", "XAUUSDm"),                  # Exness-style suffix
    (["XAUUSDm", "USTECm", "US500m"], "NAS100", "USTECm"),
    (["GOLD", "SILVER"], "XAUUSD", "GOLD"),
    (["SPX500.cash", "XAUUSD.a"], "US500", "SPX500.cash"),
])
def test_symbol_names_are_found_on_any_broker(monkeypatch, names, symbol, expected):
    from ictengine.data import mt5 as m5
    monkeypatch.setattr(m5, "_resolved", {})
    assert m5.resolve_symbol(_Terminal(names), m5.BROKERS["axi_demo"], symbol) == expected


def test_missing_symbol_is_a_clear_error(monkeypatch):
    from ictengine.data import mt5 as m5
    monkeypatch.setattr(m5, "_resolved", {})
    with pytest.raises(m5.MT5Error, match="BTCUSD is not offered"):
        m5.resolve_symbol(_Terminal(["XAUUSD", "XAUEUR"]), m5.BROKERS["axi_demo"], "BTCUSD")


def test_resolved_names_are_remembered(monkeypatch):
    from ictengine.data import mt5 as m5
    monkeypatch.setattr(m5, "_resolved", {})
    t = _Terminal(["XAUUSD"])
    assert m5.resolve_symbol(t, m5.BROKERS["axi_demo"], "XAUUSD") == "XAUUSD"
    t.names = []                                   # not asked again
    assert m5.resolve_symbol(t, m5.BROKERS["axi_demo"], "XAUUSD") == "XAUUSD"


def test_running_month_is_fetched_incrementally(monkeypatch, tmp_path):
    import types
    from datetime import datetime as dt, timezone as tz
    from ictengine.data import mt5 as m5
    now = pd.Timestamp.now(tz="UTC").floor("min")
    calls = []

    def rates_between(frm, to):
        # server time = UTC+3 here (NY+7 in summer); bars every minute up to "now"
        t0 = max(pd.Timestamp(frm).tz_convert("UTC") if pd.Timestamp(frm).tzinfo else pd.Timestamp(frm, tz="UTC"),
                 now.replace(day=1, hour=0, minute=0) - pd.Timedelta(hours=3))
        times = pd.date_range(t0.floor("min"), now, freq="1min")
        server = (times + pd.Timedelta(hours=3)).tz_localize(None)
        return np.array([(int(t.timestamp()), 1.0, 2.0, 0.5, 1.5, 1, 0, 0) for t in server],
                        dtype=[("time", "i8"), ("open", "f8"), ("high", "f8"), ("low", "f8"), ("close", "f8"),
                               ("tick_volume", "i8"), ("spread", "i4"), ("real_volume", "i8")])

    fake = types.SimpleNamespace(TIMEFRAME_M1=1, symbol_select=lambda *a: True, last_error=lambda: (0, ""),
                                 copy_rates_range=lambda s, tf, frm, to: calls.append(frm) or rates_between(frm, to))
    monkeypatch.setattr(m5, "_live", {})
    clock = [100.0]
    monkeypatch.setattr(m5.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(m5, "resolve_symbol", lambda mt5, b, s: "XAUUSD")
    first = m5.fetch_month("axi_demo", "XAUUSD", now.year, now.month, cache_dir=tmp_path, mt5=fake)
    assert len(calls) == 1 and first.index[-1] == now
    clock[0] += 1
    again = m5.fetch_month("axi_demo", "XAUUSD", now.year, now.month, cache_dir=tmp_path, mt5=fake)
    assert len(calls) == 1 and again is first                      # within LIVE_TTL: no MT5 call
    clock[0] += 5
    third = m5.fetch_month("axi_demo", "XAUUSD", now.year, now.month, cache_dir=tmp_path, mt5=fake)
    assert len(calls) == 2
    asked_from = pd.Timestamp(calls[1]) if pd.Timestamp(calls[1]).tzinfo else pd.Timestamp(calls[1], tz="UTC")
    assert asked_from >= now - pd.Timedelta(hours=13)               # only the newest bars
    assert third.index.is_unique and third.index.equals(first.index)  # same bars, merged without gaps


def test_discover_skips_names_without_history(monkeypatch):
    """Axi Standard lists XAUUSD.pro (in Market Watch) but only XAUUSD returns candles."""
    import sys, types
    from ictengine.data import mt5 as m5
    sym = lambda n, visible: types.SimpleNamespace(name=n, visible=visible, trade_mode=4, digits=2, description=n)
    fake = types.SimpleNamespace(
        TIMEFRAME_M1=1, initialize=lambda **kw: True, shutdown=lambda: None, last_error=lambda: (0, ""),
        account_info=lambda: types.SimpleNamespace(server="Axi-US51-Live", trade_mode=2),
        symbols_get=lambda: [sym("XAUUSD.pro", True), sym("XAUUSD", False), sym("NAS100", True), sym("EURUSD", True)],
        symbol_select=lambda n, on: True, symbol_info_tick=lambda n: None,
        copy_rates_from_pos=lambda n, tf, a, b: None if n.endswith(".pro") else [1, 2, 3])
    monkeypatch.setitem(sys.modules, "MetaTrader5", fake)
    monkeypatch.setattr(m5, "_failed", {})
    monkeypatch.setattr(m5, "_current", None)
    d = m5.discover(r"C:\ICT Engine\mt5\terminal64.exe")
    assert d["feed"] == "AXI" and not d["demo"]
    assert d["symbols"]["XAUUSD"]["broker"] == "XAUUSD"          # .pro has no data on this account
    assert d["symbols"]["NAS100"]["broker"] == "NAS100" and d["offset"] == 7
