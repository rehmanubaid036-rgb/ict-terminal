"""Broker symbol names -> one canonical name, so every broker's chart works the same way.

Brokers decorate the same market differently: XAUUSD, XAUUSD.pro, XAUUSD.s, XAUUSDm, #XAUUSD,
GOLD; NAS100, US100.cash, USTEC, NDX100 ... ``canonical()`` maps all of them to the engine's
name (XAUUSD, NAS100 ...), and ``feed_name()`` turns an MT5 account server such as
"FusionMarkets-Demo" or "Pepperstone-Edge-Live" into the feed shown on charts (FUSION, PEPPERSTONE).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

CURRENCIES = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SGD", "HKD", "NOK", "SEK", "DKK",
              "ZAR", "MXN", "TRY", "PLN", "CNH", "HUF", "CZK", "THB"}
METALS = {"XAU", "XAG", "XPT", "XPD"}
CRYPTO = {"BTC", "ETH", "LTC", "XRP", "SOL", "ADA", "DOGE", "DOT", "BNB", "AVAX", "LINK", "BCH", "XLM", "TRX",
          "MATIC", "SHIB", "UNI", "ATOM", "TON", "NEAR"}

# index CFDs: every common broker spelling -> engine name
INDEX_ALIASES = {
    "NAS100": "NAS100", "US100": "NAS100", "USTEC": "NAS100", "NDX100": "NAS100", "NQ100": "NAS100",
    "USTECH": "NAS100", "NASDAQ": "NAS100", "NAS": "NAS100", "USTEC100": "NAS100",
    "US500": "US500", "SPX500": "US500", "SP500": "US500", "USA500": "US500", "US500CASH": "US500", "SPX": "US500",
    "US30": "US30", "DJ30": "US30", "WS30": "US30", "DOW30": "US30", "USA30": "US30", "DJI30": "US30",
    "US2000": "US2000", "RUSSELL2000": "US2000", "US2K": "US2000",
    "GER40": "GER40", "DE40": "GER40", "GER30": "GER40", "DE30": "GER40", "DAX40": "GER40",
    "UK100": "UK100", "FTSE100": "UK100", "FTSE": "UK100",
    "JP225": "JP225", "JPN225": "JP225", "NIK225": "JP225", "JAP225": "JP225",
    "FRA40": "FRA40", "FR40": "FRA40", "EU50": "EU50", "EUSTX50": "EU50", "STOXX50": "EU50",
    "AUS200": "AUS200", "AU200": "AUS200", "HK50": "HK50", "HSI": "HK50",
    "DXY": "DXY", "USDX": "DXY", "USDINDEX": "DXY", "DOLLARINDEX": "DXY",
    "USOIL": "USOIL", "WTI": "USOIL", "XTIUSD": "USOIL", "UKOIL": "UKOIL", "BRENT": "UKOIL", "XBRUSD": "UKOIL",
}
NAME_ALIASES = {"GOLD": "XAUUSD", "SILVER": "XAGUSD", "BITCOIN": "BTCUSD", "ETHEREUM": "ETHUSD"}

_PREFIX = re.compile(r"^[#._!]+")
_SUFFIX_SEP = re.compile(r"[._\-+!#]")


@dataclass(frozen=True)
class Canonical:
    name: str        # engine name, e.g. XAUUSD
    kind: str        # 'forex' | 'commodity' | 'index' | 'crypto'


def _kind(name: str) -> str | None:
    if name in INDEX_ALIASES.values():
        return "commodity" if name in ("USOIL", "UKOIL") else "index"
    if len(name) == 6:
        base, quote = name[:3], name[3:]
        if base in METALS and quote in CURRENCIES:
            return "commodity"
        if base in CRYPTO and quote in ("USD", "USDT", "EUR"):
            return "crypto"
        if base in CURRENCIES and quote in CURRENCIES and base != quote:
            return "forex"
    if len(name) == 7 and name[:4] in {"DOGE", "LINK", "AVAX"} and name[4:] == "USD":
        return "crypto"
    return None


def canonical(broker_name: str) -> Canonical | None:
    """XAUUSD.pro / XAUUSDm / #US30 / US100.cash / GOLD.s -> engine name; None for anything else
    (stocks, ETFs, exotic CFDs we do not chart)."""
    raw = _PREFIX.sub("", broker_name.strip())
    head = _SUFFIX_SEP.split(raw, maxsplit=1)[0]
    candidates = [head.upper()]
    # trailing lower-case account markers: XAUUSDm, EURUSDc, US30i ...
    stripped = re.sub(r"[a-z]+$", "", head)
    if stripped and stripped != head:
        candidates.append(stripped.upper())
    for c in candidates:
        for name in (INDEX_ALIASES.get(c), NAME_ALIASES.get(c), c):
            if name and (k := _kind(name)):
                return Canonical(name, k)
    return None


def feed_name(server: str) -> str:
    """MT5 account server -> short feed name: 'FusionMarkets-Demo' -> 'FUSION', 'Axi-US50-Demo' -> 'AXI'."""
    s = (server or "").upper()
    for key, name in (("PEPPERSTONE", "PEPPERSTONE"), ("FUSION", "FUSION"), ("VANTAGE", "VANTAGE"),
                      ("FOREX.COM", "FOREXCOM"), ("FOREXCOM", "FOREXCOM"), ("GAIN", "FOREXCOM"),
                      ("FXPRO", "FXPRO"), ("FXCM", "FXCM"), ("EXNESS", "EXNESS"), ("ICMARKETS", "ICMARKETS"),
                      ("IC MARKETS", "ICMARKETS"), ("FPMARKETS", "FPMARKETS"), ("FP MARKETS", "FPMARKETS"),
                      ("ROBOFOREX", "ROBOFOREX"), ("AXI", "AXI"), ("XM", "XM"), ("OANDA", "OANDA"),
                      ("TICKMILL", "TICKMILL"), ("BLACKBULL", "BLACKBULL"), ("EIGHTCAP", "EIGHTCAP")):
        if key in s:
            return name
    word = re.split(r"[^A-Z0-9]", s)[0] if s else ""
    return word[:12] or "MT5"


def rank_names(broker_names: list[str], preferred: list[str] | None = None,
               disabled: list[str] | None = None) -> dict[str, list[tuple[str, str]]]:
    """{engine name: [(broker name, kind), ...] best first}. When a broker lists the same market
    more than once (XAUUSD and XAUUSD.pro, NAS100.fs and USTECH), the order is: not ``disabled``,
    in ``preferred`` (Market Watch), the exact name, a name that starts with it, the shortest."""
    pref, off = set(preferred or []), set(disabled or [])
    groups: dict[str, list[tuple[str, str]]] = {}
    for n in broker_names:
        c = canonical(n)
        if c:
            groups.setdefault(c.name, []).append((n, c.kind))
    for name, items in groups.items():
        items.sort(key=lambda x: (x[0] in off, x[0] not in pref, x[0].upper() != name,
                                  not _PREFIX.sub("", x[0]).upper().startswith(name), len(x[0]), x[0]))
    return groups


def pick_names(broker_names: list[str], preferred: list[str] | None = None,
               disabled: list[str] | None = None) -> dict[str, tuple[str, str]]:
    """The best name per market (see ``rank_names``)."""
    return {name: items[0] for name, items in rank_names(broker_names, preferred, disabled).items()}
