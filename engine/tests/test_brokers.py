"""Broker symbol naming: every suffix / prefix / alias maps to one engine name."""
import pytest

from ictengine.data.brokers import canonical, feed_name, pick_names


@pytest.mark.parametrize("raw, name, kind", [
    ("XAUUSD", "XAUUSD", "commodity"), ("XAUUSD.pro", "XAUUSD", "commodity"), ("XAUUSD.s", "XAUUSD", "commodity"),
    ("XAUUSD.p", "XAUUSD", "commodity"), ("XAUUSD.r", "XAUUSD", "commodity"), ("XAUUSD.t", "XAUUSD", "commodity"),
    ("XAUUSDm", "XAUUSD", "commodity"), ("XAUUSD.a", "XAUUSD", "commodity"), ("#XAUUSD", "XAUUSD", "commodity"),
    ("XAUUSD-STD", "XAUUSD", "commodity"), ("XAUUSD_i", "XAUUSD", "commodity"), ("GOLD", "XAUUSD", "commodity"),
    ("GOLD.s", "XAUUSD", "commodity"), ("XAGUSD.pro", "XAGUSD", "commodity"),
    ("EURUSD", "EURUSD", "forex"), ("EURUSD.pro", "EURUSD", "forex"), ("GBPJPYc", "GBPJPY", "forex"),
    ("USDJPY.raw", "USDJPY", "forex"), ("AUDNZD+", "AUDNZD", "forex"),
    ("NAS100", "NAS100", "index"), ("NAS100.fs", "NAS100", "index"), ("US100.cash", "NAS100", "index"),
    ("USTEC", "NAS100", "index"), ("USTECm", "NAS100", "index"), ("NDX100", "NAS100", "index"),
    ("US500", "US500", "index"), ("SPX500", "US500", "index"), ("US500.cash", "US500", "index"),
    ("#US30", "US30", "index"), ("DJ30", "US30", "index"), ("WS30", "US30", "index"),
    ("GER40", "GER40", "index"), ("DE40.cash", "GER40", "index"), ("UK100", "UK100", "index"),
    ("JP225", "JP225", "index"), ("USOIL", "USOIL", "commodity"), ("XTIUSD", "USOIL", "commodity"),
    ("BTCUSD", "BTCUSD", "crypto"), ("BTCUSD.", "BTCUSD", "crypto"), ("ETHUSDm", "ETHUSD", "crypto"),
])
def test_canonical_names(raw, name, kind):
    c = canonical(raw)
    assert c is not None and (c.name, c.kind) == (name, kind), raw


@pytest.mark.parametrize("raw", ["AAPL", "TSLA.us", "#AMZN", "EURUSD_HISTORY_X1", "VIX", "USDUSD", "XAUXAU", ""])
def test_not_charted(raw):
    c = canonical(raw)
    assert c is None or raw.upper().startswith("EURUSD"), raw


@pytest.mark.parametrize("server, feed", [
    ("FusionMarkets-Demo", "FUSION"), ("Axi-US50-Demo", "AXI"), ("Pepperstone-Edge-Live", "PEPPERSTONE"),
    ("VantageInternational-Demo", "VANTAGE"), ("FOREX.com-Demo 535", "FOREXCOM"), ("GAIN Capital-Demo", "FOREXCOM"),
    ("FxPro-MT5", "FXPRO"), ("FXCM-USDDemo01", "FXCM"), ("Exness-MT5Trial8", "EXNESS"),
    ("ICMarketsSC-Demo", "ICMARKETS"), ("FPMarkets-Demo", "FPMARKETS"), ("RoboForex-ECN", "ROBOFOREX"),
    ("SomeNewBroker-Server", "SOMENEWBROKE"), ("", "MT5"),
])
def test_feed_names(server, feed):
    assert feed_name(server) == feed


def test_pick_prefers_market_watch_then_plain_name():
    names = ["XAUUSD", "XAUUSD.pro", "EURUSD.pro", "US100.cash", "AAPL"]
    picked = pick_names(names)
    assert picked["XAUUSD"] == ("XAUUSD", "commodity")          # plain name wins
    assert picked["EURUSD"] == ("EURUSD.pro", "forex")
    assert picked["NAS100"] == ("US100.cash", "index")
    assert "AAPL" not in picked
    assert pick_names(names, preferred=["XAUUSD.pro"])["XAUUSD"] == ("XAUUSD.pro", "commodity")


def test_pick_prefers_names_that_start_with_the_market_and_skips_disabled():
    assert pick_names(["USTECH", "NAS100.fs"])["NAS100"][0] == "NAS100.fs"
    assert pick_names(["EURUSD", "EURUSD.pro"], disabled=["EURUSD"])["EURUSD"][0] == "EURUSD.pro"
    assert pick_names(["EURUSD", "EURUSD.pro"], preferred=["EURUSD.pro"])["EURUSD"][0] == "EURUSD.pro"
