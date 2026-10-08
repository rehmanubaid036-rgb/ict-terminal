"""Server-side chart alerts: the user's alerts keep working when the terminal is closed.

The terminal saves its alerts in the user's autosave layout (``__autosave__``). Every 15 s this watcher
reads the layouts of the users the admin panel lists (an active plan and at least one delivery channel:
WhatsApp, Telegram, email or webhook), checks each active alert against 1m candles, and asks the admin
panel to deliver what fired. What the server sent is kept in ``alert_fired`` so the terminal can show it
and switch those alerts off when it opens again.

Alert kinds (same as the terminal):
  price    above / below / crossing a price        once, then off until the user restarts it
  line     price crosses a trend line (or ray)     once
  box      price enters a zone (FVG / OB / box)     once
  session  a session or killzone starts (NY time)  every day
  ict      new MSS / BOS / FVG / liquidity sweep    on every new event (checked every minute)
"""
from __future__ import annotations

import logging
import threading
import time
from zoneinfo import ZoneInfo

import pandas as pd

from ictengine.analysis import Params, analyze, overlays

log = logging.getLogger("ictapi.alerts")
NY = ZoneInfo("America/New_York")
AUTOSAVE = "__autosave__"
LOOKBACK = pd.Timedelta(minutes=10)            # a price alert looks at the last 10 minutes (no flood after a restart)
SESSIONS = {"asia_kz": ("Asian killzone", "20:00"), "london_kz": ("London killzone", "02:00"),
            "london_sb": ("London Silver Bullet", "03:00"), "ny_am_kz": ("New York AM killzone", "07:00"),
            "ny_open": ("New York open", "09:30"), "ny_am_sb": ("NY AM Silver Bullet", "10:00"),
            "london_close": ("London close killzone", "10:00"), "ny_pm_sb": ("NY PM Silver Bullet", "14:00"),
            "wolf_asia": ("Wolf Asia window", "19:00")}
ICT_TF = {"1m": ("1m", 60), "5m": ("5m", 300), "15m": ("15m", 900), "1H": ("1h", 3600), "4H": ("4h", 14400)}
ICT_LAYER = {"mss": "structure", "bos": "structure", "fvg": "fvg", "sweep": "liquidity"}


IND_NAMES = {"rsi": "RSI", "ema": "Price vs EMA", "sma": "Price vs SMA", "macd": "MACD vs signal", "stochrsi": "Stoch RSI %K"}


def ind_series(df: pd.DataFrame, typ: str, n: int) -> tuple[pd.Series, pd.Series] | None:
    """(line, level) of an indicator condition; the level is a constant series for RSI / Stoch RSI."""
    c = df["close"]
    n = max(2, int(n or 14))
    if typ in ("rsi", "stochrsi"):
        d = c.diff()
        up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
        dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
        rsi = 100 - 100 / (1 + up / dn.replace(0, float("nan")))
        rsi = rsi.where(dn != 0, 100.0)
        if typ == "rsi":
            return rsi, None
        lo, hi = rsi.rolling(n).min(), rsi.rolling(n).max()
        k = ((rsi - lo) / (hi - lo).replace(0, float("nan")) * 100).rolling(3).mean()
        return k, None
    if typ == "ema":
        return c, c.ewm(span=n, adjust=False, min_periods=n).mean()
    if typ == "sma":
        return c, c.rolling(n).mean()
    if typ == "macd":
        m = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
        return m, m.ewm(span=9, adjust=False).mean()
    return None


def ind_hit(df: pd.DataFrame, spec: dict) -> tuple[int, str] | None:
    """(bar time, words) when the condition holds on the last CLOSED bar (crossing: it crossed on that bar)."""
    if len(df) < 3:
        return None
    s = ind_series(df.iloc[:-1], spec.get("type", ""), int(spec.get("n") or 14))      # the forming bar is left out
    if s is None:
        return None
    a, b = s
    lvl = float(spec.get("value") or 0)
    b = b if b is not None else pd.Series(lvl, index=a.index)
    x0, x1, y0, y1 = a.iloc[-2], a.iloc[-1], b.iloc[-2], b.iloc[-1]
    if any(pd.isna(v) for v in (x0, x1, y0, y1)):
        return None
    cond = spec.get("cond", "crossing")
    hit = (x1 > y1) if cond == "above" else (x1 < y1) if cond == "below" else ((x0 - y0) * (x1 - y1) < 0 or (x0 != y0 and x1 == y1))
    if not hit:
        return None
    typ = spec.get("type")
    what = {"rsi": f"RSI({spec.get('n')}) {x1:.1f}", "stochrsi": f"Stoch RSI %K {x1:.1f}", "macd": f"MACD {x1:.4f} / signal {y1:.4f}",
            "ema": f"price {_px(float(x1))} vs EMA({spec.get('n')}) {_px(float(y1))}", "sma": f"price {_px(float(x1))} vs SMA({spec.get('n')}) {_px(float(y1))}"}.get(typ, "")
    word = {"above": "is above", "below": "is below"}.get(cond, "crossed")
    target = "the signal line" if typ == "macd" else (f"the {typ.upper()}" if typ in ("ema", "sma") else _px(lvl))
    return int(df.index[-2].timestamp()), f"{IND_NAMES.get(typ, typ)} {word} {target} ({what})"


def _sym(ticker: str) -> str:
    return ticker.split(":")[-1]


def _px(v: float) -> str:
    return f"{v:.{5 if abs(v) < 10 else 2}f}".rstrip("0").rstrip(".")


def live_alerts(alerts: list, features: dict) -> list[dict]:
    """The active alerts the plan lets the server watch (the first N when the plan has an alert limit)."""
    act = [a for a in alerts if isinstance(a, dict) and a.get("active") and a.get("id") and a.get("ticker")]
    cap = int(features.get("alerts_limit") or 0)
    act = act[:cap] if cap > 0 else act
    if not features.get("ict_indicators"):
        act = [a for a in act if a.get("kind") != "ict"]
    return act


def armed_ms(a: dict) -> int:
    """When the alert was made or last restarted (ms)."""
    return int(max(a.get("created") or 0, a.get("armedAt") or 0))


def price_hit(a: dict, bars: pd.DataFrame, prev: float | None) -> tuple[str, int] | None:
    """(text, bar time ms) of the first bar in ``bars`` that sets the alert off; ``prev`` = the close before."""
    kind = a.get("kind") or "price"
    sym = _sym(a["ticker"])
    pc = prev
    for ts, b in bars.iterrows():
        t_ms = int(ts.timestamp() * 1000)
        hi, lo, cl = float(b["high"]), float(b["low"]), float(b["close"])
        text = None
        if kind == "line" and isinstance(a.get("line"), dict):
            p1, p2, ray = a["line"]["a"], a["line"]["b"], bool(a["line"].get("ray"))
            if not ray and t_ms > max(p1["t"], p2["t"]):
                return None
            span = (p2["t"] - p1["t"]) or 1
            lv = p1["v"] + (p2["v"] - p1["v"]) * (t_ms + 30_000 - p1["t"]) / span
            if pc is not None and ((pc < lv <= hi) or (pc > lv >= lo)):
                text = f"{sym} crossed the trend line ({_px(lv)})"
        elif kind == "box" and isinstance(a.get("box"), dict):
            top, bot = float(a["box"]["top"]), float(a["box"]["bottom"])
            if pc is not None and not (bot <= pc <= top) and lo <= top and hi >= bot:
                text = f"{sym} entered the zone {_px(bot)}-{_px(top)}"
        elif kind == "price":
            p, cond = float(a.get("price") or 0), a.get("condition")
            if cond == "above" and hi >= p:
                text = f"{sym} is above {_px(p)}"
            elif cond == "below" and lo <= p:
                text = f"{sym} is below {_px(p)}"
            elif cond == "crossing" and pc is not None and ((pc < p <= hi) or (pc > p >= lo)):
                text = f"{sym} crossed {_px(p)}"
        if text:
            return text + (f" - {a['note']}" if a.get("note") else ""), t_ms
        pc = cl
    return None


def session_hit(a: dict, now: pd.Timestamp, last_day: str | None) -> tuple[str, str] | None:
    """(text, NY date) when the session started in the last 5 minutes and was not told today."""
    w = SESSIONS.get(a.get("session") or "")
    if w is None:
        return None
    ny = now.tz_convert(NY)
    today = ny.strftime("%Y-%m-%d")
    if today in (last_day, a.get("lastFired")):
        return None
    hh, mm = map(int, w[1].split(":"))
    start = ny.normalize() + pd.Timedelta(hours=hh, minutes=mm)
    if not (start <= ny < start + pd.Timedelta(minutes=5)):
        return None
    return f"{w[0]} ({w[1]} NY) has started" + (f" - {a['note']}" if a.get("note") else ""), today


def ict_events(objs: list[dict], event: str, tf_seconds: int) -> list[tuple[int, int, str]]:
    """(time the event completed, direction, words) for one event type, as the terminal reads them."""
    out = []
    for o in objs:
        if event in ("mss", "bos") and o.get("kind") == "structure" and str(o.get("text", "")).lower() == event:
            d = int(o.get("direction") or 0)
            out.append((int(o["t2"]) + tf_seconds, d, f"{str(o['text']).upper()}{' with displacement' if o.get('displacement') else ''} "
                                                      f"{'up' if d > 0 else 'down'} at {_px(float(o['price']))}"))
        elif event == "fvg" and o.get("kind") == "fvg":
            d = int(o.get("direction") or 0)
            out.append((int(o["t1"]) + 2 * tf_seconds, d, f"new {'bullish FVG (BISI)' if d > 0 else 'bearish FVG (SIBI)'} "
                                                          f"{_px(float(o['bottom']))}-{_px(float(o['top']))}"))
        elif event == "sweep" and o.get("kind") == "liquidity" and o.get("status") == "sweep":
            d = 1 if o.get("side") == "ssl" else -1
            out.append((int(o["t2"]) + tf_seconds, d, f"{str(o.get('side', '')).upper()} swept at {_px(float(o['price']))}"))
    return out


class AlertWatcher:
    PRICE_EVERY = 15
    ICT_EVERY = 60
    USERS_EVERY = 60

    def __init__(self, provider, store, auth):
        self.provider, self.store, self.auth = provider, store, auth
        self._users: list[dict] = []
        self._users_at = 0.0
        self._ict_at = 0.0
        self._stop = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True, name="alert-watch").start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        self._stop.wait(20)                              # let the feeds start first
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:                            # noqa: BLE001 - never stop watching
                log.exception("alert watcher")
            self._stop.wait(self.PRICE_EVERY)

    def users(self) -> list[dict]:
        if time.time() - self._users_at > self.USERS_EVERY:
            got = self.auth.alert_users()
            if got is not None:
                self._users, self._users_at = got, time.time()
        return self._users

    # ---- one pass --------------------------------------------------------------------------
    def run_once(self, now: pd.Timestamp | None = None, ict: bool | None = None) -> int:
        """Checks every watched user's alerts once; returns how many fired."""
        now = now or pd.Timestamp.now(tz="UTC")
        if ict is None:
            ict = time.time() - self._ict_at >= self.ICT_EVERY
            if ict:
                self._ict_at = time.time()
        bars_cache: dict[str, pd.DataFrame] = {}
        objs_cache: dict[tuple, list] = {}
        fired = 0
        for u in self.users():
            email = u.get("email") or ""
            row = self.store.layout(email, AUTOSAVE) if email else None
            if not row or not isinstance(row.get("data"), dict):
                continue
            alerts = live_alerts(row["data"].get("alerts") or [], u.get("features") or {})
            if not alerts:
                continue
            states = self.store.alert_states(email)
            for a in alerts:
                try:
                    fired += self._check(email, a, states.get(a["id"]) or {}, now, ict, bars_cache, objs_cache)
                except Exception:                        # noqa: BLE001 - one bad alert must not stop the rest
                    log.exception("alert %s of %s", a.get("id"), email)
        return fired

    def _bars(self, ticker: str, now: pd.Timestamp, cache: dict) -> pd.DataFrame:
        if ticker not in cache:
            try:
                cache[ticker] = self.provider.candles(ticker, now - LOOKBACK - pd.Timedelta(minutes=5), now + pd.Timedelta(minutes=1))
            except Exception:                            # noqa: BLE001 - a feed that is down: next pass
                cache[ticker] = pd.DataFrame()
        return cache[ticker]

    def _send(self, email: str, a: dict, key_at: int, kind: str, text: str, extra: dict) -> list[str] | None:
        """Delivers through the admin panel; None when the panel could not be reached (try again next pass)."""
        sent = self.auth.send_alert(email, f"chart|{a['id']}|{key_at}", text,
                                    {"symbol": _sym(a["ticker"]), "ticker": a["ticker"], "kind": kind, **extra})
        if sent is None:
            return None
        self.store.add_alert_fired(email, a["id"], int(time.time() * 1000), kind, text, extra, sent)
        return sent

    def _check(self, email, a, st, now, ict, bars_cache, objs_cache) -> int:
        kind = a.get("kind") or "price"
        if kind in ("price", "line", "box"):
            if st.get("fired_ms") and st["fired_ms"] >= armed_ms(a):
                return 0                                 # already fired since it was made / restarted
            bars = self._bars(a["ticker"], now, bars_cache)
            if not len(bars):
                return 0
            since = max(now - LOOKBACK, pd.Timestamp(armed_ms(a), unit="ms", tz="UTC").floor("min"))
            before, window = bars[bars.index < since], bars[bars.index >= since]
            prev = float(before["close"].iloc[-1]) if len(before) else None
            hit = price_hit(a, window, prev)
            if hit is None:
                return 0
            text, at = hit
            if self._send(email, a, at, kind, text, {"bar_ms": at}) is None:
                return 0
            self.store.set_alert_state(email, a["id"], fired_ms=int(time.time() * 1000))
            return 1
        if kind == "session":
            hit = session_hit(a, now, st.get("last_day"))
            if hit is None:
                return 0
            text, day = hit
            if self._send(email, a, int(day.replace("-", "")), kind, text, {"day": day}) is None:
                return 0
            self.store.set_alert_state(email, a["id"], last_day=day)
            return 1
        if kind == "ict" and ict and isinstance(a.get("ict"), dict):
            ev, tfl = a["ict"].get("event"), a["ict"].get("tf")
            if ev not in ICT_LAYER or tfl not in ICT_TF:
                return 0
            tf, secs = ICT_TF[tfl]
            key = (a["ticker"], tf)
            if key not in objs_cache:
                objs_cache[key] = self._ict_objects(a["ticker"], tf, secs, now)
            now_s = int(now.timestamp())
            seen = max(int(st.get("seen") or 0), int(a["ict"].get("seen") or 0), armed_ms(a) // 1000,
                       now_s - max(2 * secs, 600))       # never old events after a pause
            want = int(a["ict"].get("dir") or 0)
            hits = sorted(h for h in ict_events(objs_cache[key], ev, secs) if seen < h[0] <= now_s + 60 and (not want or h[1] == want))
            if not hits:
                return 0
            last = hits[-1][0]
            text = f"{_sym(a['ticker'])} {tfl}: " + "; ".join(h[2] for h in hits[-3:]) + \
                   (f" (+{len(hits) - 3} more)" if len(hits) > 3 else "") + (f" - {a['note']}" if a.get("note") else "")
            if self._send(email, a, last, kind, text, {"seen": last}) is None:
                return 0
            self.store.set_alert_state(email, a["id"], seen=last)
            return 1
        if kind == "indicator" and ict and isinstance(a.get("ind"), dict):
            spec = a["ind"]
            tfl = spec.get("tf")
            if tfl not in ICT_TF:
                return 0
            tf, secs = ICT_TF[tfl]
            key = ("ind", a["ticker"], tf)
            if key not in objs_cache:
                try:
                    objs_cache[key] = self.provider.bars(a["ticker"], tf, now - pd.Timedelta(seconds=300 * secs), now + pd.Timedelta(minutes=1))
                except Exception:                    # noqa: BLE001
                    objs_cache[key] = pd.DataFrame()
            df = objs_cache[key]
            hit = ind_hit(df, spec) if len(df) else None
            if hit is None:
                return 0
            at, words = hit
            seen = max(int(st.get("seen") or 0), int(spec.get("seen") or 0), armed_ms(a) // 1000 - secs)
            if at <= seen or (spec.get("freq") != "every" and st.get("fired_ms") and st["fired_ms"] >= armed_ms(a)):
                return 0
            text = f"{_sym(a['ticker'])} {tfl}: {words}" + (f" - {a['note']}" if a.get("note") else "")
            if self._send(email, a, at, kind, text, {"seen": at, "once": spec.get("freq") != "every"}) is None:
                return 0
            self.store.set_alert_state(email, a["id"], seen=at, fired_ms=int(time.time() * 1000))
            return 1
        return 0

    def _ict_objects(self, ticker: str, tf: str, secs: int, now: pd.Timestamp) -> list[dict]:
        try:
            df = self.provider.bars(ticker, tf, now - pd.Timedelta(seconds=300 * secs), now + pd.Timedelta(minutes=1))
        except Exception:                                # noqa: BLE001
            return []
        if len(df) < 10:
            return []
        an = analyze(df[["open", "high", "low", "close", "volume"]], Params.for_timeframe(tf))
        return overlays(an, lookback_bars=len(df), include=("structure", "fvg", "liquidity"))
