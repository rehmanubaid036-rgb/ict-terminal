"""FastAPI application.

    uvicorn ictapi.main:app --port 8100        (run from the api/ folder)

Datafeed endpoints follow TradingView's UDF protocol so any UDF-compatible chart (our
KLineChart adapter, or TradingView's library later) can use them unchanged.
"""
from __future__ import annotations

import os
import re
import threading
import time

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from ictengine.analysis import Params, analyze, overlays, smt_overlays
from ictengine.assistant import ask as assistant_ask, safe_question
from ictengine.bias import bias_at
from ictengine.context import Context
from ictengine.core.levels import daily_levels
from ictengine.data.mt5 import MT5Error
from ictengine.models.registry import MODELS
from ictengine.news import calendar as news_calendar, ff_week
from ictengine.store import LayoutError, Store
from ictengine.time_overlays import LAYERS as TIME_LAYERS_ENGINE, time_layers

from .alert_watch import AlertWatcher
from .auth_client import GUEST_FEATURES, AuthClient
from .llm import LLM
from .market import SYNTH_OPS, Provider, default_provider, utc_range

FULL_ACCESS = {"user": "developer", "status": "active", "is_vip": True,
               "features": {**GUEST_FEATURES, "signals": True, "signal_delay_minutes": 0, "models": "all",
                            "ict_indicators": True, "max_charts": 4, "trades": True, "backtest": True}}
# account / billing calls the apps make through this one server; answered by the admin panel
FORWARD = {
    ("POST", "auth/register"), ("POST", "auth/login"), ("POST", "auth/guest"), ("POST", "auth/logout"), ("GET", "auth/me"),
    ("POST", "auth/password/change"), ("POST", "auth/password/reset"), ("POST", "auth/password/reset/confirm"),
    ("GET", "plans"), ("GET", "app-config"), ("GET", "payments/methods"), ("POST", "payments/submit"),
    ("GET", "payments/mine"), ("GET", "payments/crypto/networks"), ("POST", "payments/crypto/order"),
    ("GET", "payments/crypto/open"),
    # community: chat (accounts with a nickname) and ideas (open to read)
    ("GET", "community/status"), ("POST", "community/join"), ("GET", "community/messages"), ("POST", "community/messages"),
    ("GET", "community/ideas"), ("POST", "community/ideas"),
    ("GET", "alerts/settings"), ("POST", "alerts/settings"), ("POST", "alerts/test"), ("POST", "alerts/telegram"),
    ("GET", "ai/settings"), ("POST", "ai/settings"),
    ("GET", "donations/info"), ("POST", "donations"),
    ("GET", "copy/settings"), ("POST", "copy/settings"), ("POST", "copy/token"), ("POST", "donations/crypto"), ("POST", "oauth/poll"),
}
# a customer's own crypto order: status, cancel, transaction hash (the panel checks ownership)
FORWARD_PATTERNS = [("GET", re.compile(r"payments/crypto/order/\d+")),
                    ("POST", re.compile(r"payments/crypto/order/\d+/(cancel|txid)")),
                    ("POST", re.compile(r"community/messages/\d+/report")),
                    ("GET", re.compile(r"donations/crypto/\d+")), ("POST", re.compile(r"donations/crypto/\d+/txid")),
                    ("GET", re.compile(r"community/ideas/\d+")),
                    ("POST", re.compile(r"community/ideas/\d+/(like|comment|delete|report)"))]


def forwarded(method: str, path: str) -> bool:
    return (method, path) in FORWARD or any(m == method and p.fullmatch(path) for m, p in FORWARD_PATTERNS)

RESOLUTIONS = {"1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "120": "2h",
               "240": "4h", "1D": "1d", "D": "1d", "1W": "1w", "W": "1w"}
WARMUP = {"1m": pd.Timedelta(hours=12), "3m": pd.Timedelta(days=1), "5m": pd.Timedelta(days=2),
          "15m": pd.Timedelta(days=4), "30m": pd.Timedelta(days=7), "1h": pd.Timedelta(days=14),
          "2h": pd.Timedelta(days=20), "4h": pd.Timedelta(days=40), "1d": pd.Timedelta(days=200),
          "1w": pd.Timedelta(days=900)}
# Chart layers: built on the chart's own timeframe
CHART_LAYERS = ("fvg", "liquidity", "structure", "order_blocks", "pd_ote", "displacement")
# Time/level layers: built from 1m candles; only on the timeframes where they can be read
_INTRADAY = ("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h")
TIME_LAYER_TFS = {"sessions": _INTRADAY[:6], "quarters": _INTRADAY[:5], "projections": _INTRADAY[:6],
                  "key_levels": _INTRADAY, "opening_gaps": _INTRADAY + ("1d",), "ipda": _INTRADAY + ("1d",)}
TIME_LAYERS = TIME_LAYERS_ENGINE
MAX_TIME_DAYS = {"1m": 3, "3m": 5, "5m": 7, "15m": 12, "30m": 15, "1h": 20, "2h": 20, "4h": 20, "1d": 20, "1w": 20}
# ICT's main markets first in search and as the default chart (most reliable model results)
MAIN_PAIRS = ("XAUUSD", "NAS100", "US500", "EURUSD", "GBPUSD", "XAGUSD", "US30", "GER40", "BTCUSD",
              "BTCUSDT", "ETHUSDT")


def _rank(i) -> tuple:
    main = i.symbol in MAIN_PAIRS
    return (not main, MAIN_PAIRS.index(i.symbol) if main else 0, i.feed == "BINANCE", i.type != "forex", i.ticker)


def _default_symbol(syms: dict) -> str:
    ranked = sorted(syms.values(), key=_rank)
    return ranked[0].ticker if ranked else ""


# SMT partner on the same feed (rulebook 3.x: gold/silver, Nasdaq/S&P, EUR/GBP)
SMT_PARTNERS = {"XAUUSD": "XAGUSD", "XAGUSD": "XAUUSD", "NAS100": "US500", "US500": "NAS100",
                "EURUSD": "GBPUSD", "GBPUSD": "EURUSD"}
INDICATORS = CHART_LAYERS + TIME_LAYERS + ("smt", "bias")
DEFAULT_INDICATORS = ("fvg", "liquidity", "structure", "order_blocks")


def create_app(provider: Provider | None = None, store: Store | None = None, auth: AuthClient | None = None,
               require_auth: bool | None = None, llm: LLM | None = None, watch_alerts: bool = False) -> FastAPI:
    provider = provider or default_provider()
    store = store or Store()
    auth = auth or AuthClient()
    llm = llm or LLM()
    ctx_cache: dict[str, tuple[float, Context]] = {}
    levels_cache: dict[str, tuple[float, pd.DataFrame]] = {}
    if require_auth is None:
        require_auth = os.getenv("ICT_REQUIRE_AUTH", "true").strip().lower() not in ("0", "false", "no", "off")
    app = FastAPI(title="ICT Terminal API", version="0.1.0")
    # find the MT5 terminals / the Binance list in the background, so the first chart opens fast
    threading.Thread(target=provider.symbols, daemon=True, name="warm-feeds").start()

    if watch_alerts:
        # the users' chart alerts keep working when the terminal is closed (see alert_watch.py)
        AlertWatcher(provider, store, auth).start()

    @app.exception_handler(MT5Error)
    async def mt5_unavailable(request: Request, exc: MT5Error):
        # the broker terminal is down / not logged in: say so at once instead of a 500
        return JSONResponse(status_code=503, content={"detail": f"Chart data is not available right now: {exc}"})

    def _token(request: Request) -> str:
        h = request.headers.get("Authorization", "")
        return h[7:].strip() if h.lower().startswith("bearer ") else ""

    async def access(request: Request) -> dict:
        """The caller's plan access (FULL_ACCESS when auth is switched off for development)."""
        if not require_auth:
            return FULL_ACCESS
        return await run_in_threadpool(auth.verify, _token(request), request.headers.get("X-Device-Id", ""),
                                       request.headers.get("X-Device-Name", ""),
                                       request.headers.get("X-Device-Platform", "web"),
                                       request.client.host if request.client else "")

    def logged_in(a: dict = Depends(access)) -> dict:
        if a.get("status") in ("guest", "session_mismatch", None):
            raise HTTPException(401, a.get("reason") or "Please log in.")
        return a

    def feature(a: dict, name: str, message: str) -> dict:
        if not a.get("features", {}).get(name):
            raise HTTPException(403, message)
        return a

    def _info(symbol: str):
        info = provider.symbols().get(symbol.upper())
        if info is None:
            raise HTTPException(404, f"unknown symbol {symbol}")
        return info

    def _tf(resolution: str) -> str:
        m = re.fullmatch(r"(\d{1,2})S", resolution or "")
        if m and 1 <= int(m.group(1)) <= 59:
            return f"{int(m.group(1))}s"            # seconds charts (built from ticks)
        tf = RESOLUTIONS.get(resolution)
        if tf is None:
            raise HTTPException(400, f"unsupported resolution {resolution}")
        return tf

    def _bars(ticker: str, tf: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        return provider.bars(ticker, tf, start, end)

    @app.get("/api/v1/health")
    async def health():    # async: answers even while every worker thread waits for market data
        return {"status": "ok", "models": len(MODELS)}

    # ---- UDF datafeed ------------------------------------------------------------------
    @app.get("/udf/config")
    def udf_config():
        syms = provider.symbols()
        return {"has_seconds": True, "seconds_multipliers": ["1", "5", "15", "30"],
                "supported_resolutions": ["1S", "5S", "15S", "30S", "1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W"],
                "supports_search": True, "supports_group_request": False, "supports_marks": False,
                "supports_timescale_marks": False, "supports_time": True,
                "exchanges": [{"value": f, "name": f, "desc": f} for f in sorted({i.feed for i in syms.values()})],
                "default_symbol": _default_symbol(syms),
                "symbols_types": [{"name": t, "value": t} for t in ("commodity", "index", "crypto", "forex")]}

    @app.get("/udf/time")
    def udf_time():
        return int(pd.Timestamp.now(tz="UTC").timestamp())

    @app.get("/udf/symbols")
    def udf_symbols(symbol: str, a: dict = Depends(logged_in)):
        i = _info(symbol)
        return {"name": i.ticker, "ticker": i.ticker, "description": i.description, "type": i.type,
                "exchange": i.feed, "listed_exchange": i.feed, "timezone": "America/New_York",
                "session": i.session, "minmov": 1, "pricescale": i.pricescale, "has_intraday": True,
                "has_daily": True, "has_weekly_and_monthly": True, "intraday_multipliers": ["1", "3", "5", "15", "30", "60", "120", "240"],
                "supported_resolutions": ["1S", "5S", "15S", "30S", "1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W"],
                "volume_precision": 0, "data_status": "streaming"}

    @app.get("/udf/search")
    def udf_search(query: str = "", limit: int = 30, type: str = "", exchange: str = "", a: dict = Depends(logged_in)):
        q = query.upper()
        synth = []
        if any(c in q for c in SYNTH_OPS):
            raw = q.split(":", 1)[-1].replace(" ", "")
            feeds = sorted({i.feed for i in provider.symbols().values()})
            for f in ([q.split(":", 1)[0]] if ":" in q else feeds):
                i = provider.symbols().get(f"{f}:{raw}")
                if i is not None:
                    synth.append({"symbol": i.ticker, "full_name": i.ticker, "description": i.description, "exchange": i.feed,
                                  "ticker": i.ticker, "type": i.type})
        out = synth + [{"symbol": i.ticker, "full_name": i.ticker, "description": i.description, "exchange": i.feed,
                "ticker": i.ticker, "type": i.type}
               for i in sorted(provider.symbols().values(), key=_rank)
               if (q in i.ticker or q in i.description.upper()) and (not type or i.type == type)
               and (not exchange or i.feed == exchange)]
        return out[:limit]

    @app.get("/udf/history")
    def udf_history(symbol: str, resolution: str, frm: int = Query(alias="from"), to: int = Query(...),
                    countback: int | None = None, a: dict = Depends(logged_in)):
        i, tf = _info(symbol), _tf(resolution)
        start, end = utc_range(frm, to)
        if end <= start:
            raise HTTPException(400, "'to' must be after 'from'")
        df = _bars(i.ticker, tf, start, end)
        if countback:
            df = df.tail(countback)
        if df.empty:
            return {"s": "no_data"}
        return {"s": "ok", "t": (df.index.as_unit("s").asi8).tolist(),
                "o": df["open"].round(8).tolist(), "h": df["high"].round(8).tolist(),
                "l": df["low"].round(8).tolist(), "c": df["close"].round(8).tolist(),
                "v": df["volume"].fillna(0).tolist() if "volume" in df else [0] * len(df)}

    # ---- ICT ----------------------------------------------------------------------------
    @app.get("/api/v1/ict/overlays")
    def ict_overlays(symbol: str, resolution: str, frm: int = Query(alias="from"), to: int = Query(...),
                     indicators: str = ",".join(DEFAULT_INDICATORS), a: dict = Depends(logged_in)):
        feature(a, "ict_indicators", "Your plan does not include ICT indicators.")
        i, tf = _info(symbol), _tf(resolution)
        inc = tuple(x for x in indicators.split(",") if x)
        bad = set(inc) - set(INDICATORS)
        if bad:
            raise HTTPException(400, f"unknown indicators {sorted(bad)}")
        start, end = utc_range(frm, to)
        df = _bars(i.ticker, tf, start - WARMUP.get(tf, pd.Timedelta(minutes=30)), end)
        if len(df) < 3:
            return {"symbol": i.ticker, "resolution": resolution, "objects": []}
        a = analyze(df[["open", "high", "low", "close", "volume"]], Params.for_timeframe("1m" if tf.endswith("s") else tf))
        objs = overlays(a, lookback_bars=len(df), include=tuple(x for x in inc if x in CHART_LAYERS))

        if "smt" in inc and i.symbol in SMT_PARTNERS:
            partner = provider.symbols().get(f"{i.feed}:{SMT_PARTNERS[i.symbol]}")
            if partner is not None:
                pdf = _bars(partner.ticker, tf, start - WARMUP.get(tf, pd.Timedelta(minutes=30)), end)
                if len(pdf) >= 3:
                    objs += smt_overlays(a, pdf[["open", "high", "low", "close", "volume"]], lookback_bars=len(df))

        time_inc = tuple(x for x in inc if x in TIME_LAYERS and tf in TIME_LAYER_TFS[x])
        if time_inc:
            # exact times and prices from 1m candles, only for the last few trading days in view
            last = min(end, df.index[-1] + pd.Timedelta(minutes=1))
            days = MAX_TIME_DAYS[tf]
            view_start = max(start, last - pd.Timedelta(days=days * 7 // 5 + 2))
            m1 = provider.candles(i.ticker, view_start - pd.Timedelta(days=days * 7 // 5 + 9), last)
            if len(m1):
                ipda_lv = _long_levels(i.ticker, last) if "ipda" in time_inc else None
                objs += time_layers(m1, view_start, last, include=time_inc, max_days=days,
                                    macros=tf in ("1m", "3m", "5m"), ipda_levels=ipda_lv)

        t0 = int(start.timestamp())
        objs = [o for o in objs if o.get("t2", o.get("t", t0)) >= t0]  # drop objects that ended before the view
        if "bias" in inc:
            # bias as of the end of the view (a chart scrolled into the past shows that day's bias);
            # whole minutes, so every chart and timeframe in the same minute shares one context
            as_of = min(end, pd.Timestamp.now(tz="UTC")).floor("min")
            ctx = _assistant_context(i.ticker, i.symbol, as_of)
            if ctx is not None:
                b = bias_at(ctx, len(ctx.base) - 1)
                objs.append({"type": "panel", "kind": "bias", "direction": b.direction, "score": b.score,
                             "components": b.components, "draw": b.draw, "draw_source": b.draw_source,
                             "ipda_position": b.ipda_position, "as_of": int(ctx.base.index[-1].timestamp())})
        return {"symbol": i.ticker, "resolution": resolution, "objects": objs}

    @app.get("/api/v1/models")
    def models(a: dict = Depends(access)):
        allowed = a.get("features", {}).get("models") or []
        return [{"id": m.id, "name": m.name, "source": m.source,
                 "allowed": allowed == "all" or m.id in allowed, "default_on": m.default_on} for m in MODELS.values()]

    @app.get("/api/v1/calendar")
    async def calendar(frm: int = Query(alias="from"), to: int = Query(...), impact: str = "High", a: dict = Depends(access)):
        """Economic events for the chart (ForexFactory week + FOMC / NFP history)."""
        start, end = utc_range(frm, to)
        if end - start > pd.Timedelta(days=400):
            start = end - pd.Timedelta(days=400)
        impacts = ("High", "Medium") if impact == "Medium" else ("High",)
        live = await run_in_threadpool(ff_week)
        return {"events": [{"time": int(e.time.timestamp()), "currency": e.currency, "impact": e.impact, "title": e.title}
                           for e in news_calendar(start, end, impacts, live)]}

    @app.get("/api/v1/news")
    async def news(a: dict = Depends(access)):
        """Latest market headlines (public RSS feeds, cached 10 minutes)."""
        from . import news_feed
        return {"items": await run_in_threadpool(news_feed.latest)}

    @app.get("/api/v1/screener")
    def screener(a: dict = Depends(logged_in)):
        """ICT screener: one row per symbol the engine watches (bias, premium / discount, PDH / PDL
        sweeps, nearest FVGs, killzone) plus the day's model setups the plan may see."""
        f = a.get("features", {})
        allowed = f.get("models") or []
        delay = f.get("signal_delay_minutes") or 0
        now = pd.Timestamp.now(tz="UTC")
        end = now - pd.Timedelta(minutes=delay)
        rows = store.screener()
        for r in rows:
            sigs = []
            if f.get("signals"):
                ids = [m for m in MODELS if allowed == "all" or m in allowed]
                sigs = store.signals(r["symbol"], now - pd.Timedelta(hours=24), end, ids, bias_filter=True) if ids else []
            r["setups"] = [{"model_id": s.get("model_id"), "direction": s.get("direction"), "grade": s.get("grade"),
                            "created_time": str(s.get("created_time")), "entry": s.get("entry")} for s in sigs[-5:]][::-1]
            r["a_setups"] = sum(1 for s in sigs if str(s.get("grade", "")).startswith("A"))
        return {"rows": rows}

    # ---- strategy tester: one model on one symbol, run on demand (heavy: one at a time, cached) ---------
    bt_cache: dict[tuple, tuple[float, dict]] = {}
    bt_lock = threading.Lock()

    @app.get("/api/v1/backtest")
    def backtest(symbol: str, model: str, days: int = 60, bias: bool = True, a: dict = Depends(logged_in)):
        """Runs ``model`` on the last ``days`` (30 / 60 / 90) of 1m data with the conservative simulator
        (next-bar fills, stop first, spread paid). Needs the plan's backtest feature."""
        from ictengine.backtest.simulator import run as bt_run, stats as bt_stats
        from ictengine.symbols import SYMBOLS as SPECS

        feature(a, "backtest", "Your plan does not include the strategy tester.")
        f = a.get("features", {})
        allowed = f.get("models") or []
        if model not in MODELS or (allowed != "all" and model not in allowed):
            raise HTTPException(400, "Choose one of your plan's models.")
        days = 30 if days <= 30 else 60 if days <= 60 else 90
        i = _info(symbol)
        key = (i.ticker, model, days, bias, pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"))
        hit = bt_cache.get(key)
        if hit and time.time() - hit[0] < 6 * 3600:
            return hit[1]
        if not bt_lock.acquire(blocking=False):
            raise HTTPException(429, "Another test is running. Try again in a minute.")
        try:
            end = pd.Timestamp.now(tz="UTC")
            start = end - pd.Timedelta(days=days)
            df = provider.candles(i.ticker, start - pd.Timedelta(days=45), end)    # warm-up for the daily bias
            if len(df) < 2000:
                raise HTTPException(400, "Not enough data for this symbol.")
            partner = _partner_1m(i, start - pd.Timedelta(days=45), end) if model == "M16" else None
            ctx = Context(i.symbol, df, partner=partner)
            sigs = [s for s in MODELS[model].scan(ctx, require_bias=bias) if s.created_time >= start]
            spread = SPECS[i.symbol].spread if i.symbol in SPECS else 0.0
            trades = bt_run(sigs, df, spread=spread)
            st = {k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in bt_stats(trades).items()}
            rows = []
            for tr in trades:
                d = tr.signal.to_dict()
                d["model_id"] = model
                rows.append({"signal": d, "status": tr.status, "r": round(tr.r, 3),
                             "fill_time": tr.fill_time.isoformat() if tr.fill_time is not None else None,
                             "exit_time": tr.exit_time.isoformat() if tr.exit_time is not None else None,
                             "fill_price": tr.fill_price})
            out = {"symbol": i.ticker, "model": model, "days": days, "bias": bias, "stats": st, "trades": rows,
                   "from": start.isoformat(), "to": end.isoformat()}
            if len(bt_cache) > 100:
                bt_cache.clear()
            bt_cache[key] = (time.time(), out)
            return out
        finally:
            bt_lock.release()

    # ---- live bars over a WebSocket (the terminal falls back to polling when it is down) -------------
    stream_cache: dict[tuple, tuple[float, list]] = {}

    def _stream_bars(symbol: str, resolution: str) -> list | None:
        """The newest two bars [t, o, h, l, c, v] of a symbol / resolution, shared by every client for 1 s."""
        try:
            i, tf = _info(symbol), _tf(resolution)
        except HTTPException:
            return None
        key = (i.ticker, tf)
        hit = stream_cache.get(key)
        if hit and time.time() - hit[0] < 1.0:
            return hit[1]
        step = pd.Timedelta(tf.replace("d", "D").replace("w", "W"))
        now = pd.Timestamp.now(tz="UTC")
        try:
            df = _bars(i.ticker, tf, now - max(step * 3, pd.Timedelta(minutes=10)), now + step)
        except Exception:     # noqa: BLE001 - a feed that is down: nothing this second
            return None
        rows = [[int(t.timestamp()), float(r.open), float(r.high), float(r.low), float(r.close), float(r.volume)]
                for t, r in df.tail(2).iterrows()]
        stream_cache[key] = (time.time(), rows)
        if len(stream_cache) > 2000:
            stream_cache.clear()
        return rows

    @app.websocket("/ws/stream")
    async def ws_stream(ws: WebSocket):
        """First message {"auth": token, "device": id}; then {"sub": [{"symbol", "resolution"}, ...]} any time.
        Every second each subscription's newest bars are sent when they changed: {"symbol", "resolution", "bars"}."""
        import asyncio
        await ws.accept()
        try:
            hello = await asyncio.wait_for(ws.receive_json(), 10)
        except Exception:     # noqa: BLE001 - no hello, bad JSON or gone
            await ws.close(code=4400)
            return
        if require_auth:
            a = await run_in_threadpool(auth.verify, str(hello.get("auth") or ""), str(hello.get("device") or ""), "", "web",
                                        ws.client.host if ws.client else "")
            if a.get("status") in ("guest", "session_mismatch", None):
                await ws.close(code=4401)
                return
        subs: dict[str, tuple[str, str]] = {}
        sent: dict[str, list] = {}
        sent_at: dict[str, float] = {}

        async def reader():
            while True:
                m = await ws.receive_json()
                if isinstance(m, dict) and isinstance(m.get("sub"), list):
                    subs.clear()
                    for s in m["sub"][:16]:
                        if isinstance(s, dict) and s.get("symbol") and s.get("resolution"):
                            subs[f"{s['symbol']}|{s['resolution']}"] = (str(s["symbol"]).upper()[:40], str(s["resolution"])[:6])
        task = asyncio.create_task(reader())
        try:
            while not task.done():
                for key, (sym, res) in list(subs.items()):
                    rows = await run_in_threadpool(_stream_bars, sym, res)
                    # changed bars at once; the same bars again every 4 s so the terminal knows the stream is alive
                    if rows and (rows != sent.get(key) or time.time() - sent_at.get(key, 0) >= 4):
                        sent[key], sent_at[key] = rows, time.time()
                        await ws.send_json({"symbol": sym, "resolution": res, "bars": rows})
                await asyncio.sleep(1)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            task.cancel()

    @app.get("/api/v1/engine/status")
    def engine_status():
        return {"symbols": store.status()}

    # ---- watchlist quotes --------------------------------------------------------------------
    @app.get("/api/v1/quotes")
    def quotes(symbols: str, a: dict = Depends(logged_in)):
        """Last price and change vs the previous daily close, for up to 30 symbols."""
        now = pd.Timestamp.now(tz="UTC")
        out = []
        for t in [s for s in symbols.upper().split(",") if s][:30]:
            info = provider.symbols().get(t)
            if info is None:
                continue
            try:
                d = provider.bars(t, "1d", now - pd.Timedelta(days=10), now + pd.Timedelta(minutes=1))
            except Exception:          # a feed that is down only blanks its own rows
                d = pd.DataFrame()
            if len(d) == 0:
                out.append({"symbol": t, "price": None, "change": None, "change_pct": None})
                continue
            last = float(d["close"].iloc[-1])
            prev = float(d["close"].iloc[-2]) if len(d) > 1 else float(d["open"].iloc[-1])
            today = d.iloc[-1]
            out.append({"symbol": t, "price": last, "change": last - prev,
                        "change_pct": (last - prev) / prev * 100 if prev else None,
                        "time": int(d.index[-1].timestamp()),
                        "high": float(today["high"]), "low": float(today["low"]),
                        "volume": float(today["volume"]) if "volume" in d.columns else None})
        return {"quotes": out}

    # ---- symbol info panel ---------------------------------------------------------------------
    @app.get("/api/v1/symbol-info")
    def symbol_info(symbol: str, a: dict = Depends(logged_in)):
        """What the symbol is and how it moves: feed, type, tick, session; ranges, ATR / ADR, volume, the SMT partner."""
        i = _info(symbol)
        now = pd.Timestamp.now(tz="UTC")
        try:
            d = provider.bars(i.ticker, "1d", now - pd.Timedelta(days=400), now + pd.Timedelta(minutes=1))
        except Exception:      # a feed that is down: the static facts only
            d = pd.DataFrame()
        out = {"ticker": i.ticker, "symbol": i.symbol, "feed": i.feed, "description": i.description, "type": i.type,
               "session": i.session, "pricescale": i.pricescale, "tick": 1 / i.pricescale if i.pricescale else None,
               "source": i.source, "smt_partner": SMT_PARTNERS.get(i.symbol), "covered": any(s.get("symbol") == i.symbol for s in store.status()),
               "stats": None}
        if len(d) >= 2:
            h, l, c = d["high"], d["low"], d["close"]
            tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
            def span(days: int):
                w = d[d.index >= d.index[-1] - pd.Timedelta(days=days)]
                return {"high": float(w["high"].max()), "low": float(w["low"].min())} if len(w) else None
            last, prev = float(c.iloc[-1]), float(c.iloc[-2])
            out["stats"] = {
                "last": last, "prev_close": prev, "change": last - prev, "change_pct": (last - prev) / prev * 100 if prev else None,
                "day": {"open": float(d["open"].iloc[-1]), "high": float(h.iloc[-1]), "low": float(l.iloc[-1])},
                "week": span(7), "month": span(31), "year": span(365), "days": len(d),
                "atr14": float(tr.tail(14).mean()), "adr20": float((h - l).tail(20).mean()),
                "today_vs_adr": float((h.iloc[-1] - l.iloc[-1]) / (h - l).tail(20).mean() * 100) if float((h - l).tail(20).mean()) else None,
                "avg_volume20": float(d["volume"].tail(20).mean()) if "volume" in d.columns else None,
                "first_day": d.index[0].date().isoformat(),
            }
        return out

    # ---- saved terminal layouts (charts, indicators, ICT layers, drawings) per user -----------
    def _partner_1m(i, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame | None:
        """1m bars of the SMT partner on the same feed (M16 needs them); None when there is none."""
        if i.symbol not in SMT_PARTNERS:
            return None
        partner = provider.symbols().get(f"{i.feed}:{SMT_PARTNERS[i.symbol]}")
        if partner is None:
            return None
        try:
            pdf = provider.candles(partner.ticker, start, end)
        except Exception:  # noqa: BLE001 - no partner data: M16 just finds nothing
            return None
        return pdf if len(pdf) else None

    def _owner(a: dict) -> str:
        return str(a.get("email") or a.get("user") or "")

    # ---- paper trading (orders checked against 1m bars, see ictengine.paper) ---------------------
    from ictengine import paper as pp

    def _bars_1m(ticker: str, since: pd.Timestamp) -> pd.DataFrame:
        now = pd.Timestamp.now(tz="UTC")
        since = max(since, now - pd.Timedelta(days=30))
        try:
            return provider.candles(ticker, since, now + pd.Timedelta(minutes=1))
        except Exception:      # a feed that is down: check again next time
            return pd.DataFrame()

    def _order(d: dict) -> "pp.PaperOrder":
        ts = lambda v: pd.Timestamp(v) if v not in (None, "", "None", "NaT") else None   # noqa: E731
        return pp.PaperOrder(id=int(d.get("id") or 0), ticker=d["ticker"], side=int(d["side"]), type=d["type"], qty=float(d["qty"]),
                             price=d.get("price"), sl=d.get("sl"), tp=d.get("tp"), status=d["status"], created=ts(d["created"]),
                             checked_until=ts(d["checked_until"]), fill_price=d.get("fill_price"), filled_at=ts(d.get("filled_at")),
                             exit_price=d.get("exit_price"), closed_at=ts(d.get("closed_at")), exit_reason=d.get("exit_reason", ""),
                             pnl=float(d.get("pnl") or 0))

    def _plain(o: "pp.PaperOrder") -> dict:
        from dataclasses import asdict
        return {k: (v.isoformat() if isinstance(v, pd.Timestamp) else v) for k, v in asdict(o).items()}

    def _last(ticker: str) -> float | None:
        now = pd.Timestamp.now(tz="UTC")
        try:
            d = provider.bars(ticker, "1d", now - pd.Timedelta(days=60), now + pd.Timedelta(minutes=1))
        except Exception:
            return None
        return float(d["close"].iloc[-1]) if len(d) else None

    def _paper_state(user: str) -> dict:
        acc = store.paper_account(user)
        live = [_order(d) for d in store.paper_orders(user, (pp.WORKING, pp.OPEN))]
        realized = 0.0
        for t in {o.ticker for o in live}:
            mine = [o for o in live if o.ticker == t]
            bars = _bars_1m(t, min(o.checked_until for o in mine))
            if not len(bars):
                continue
            for o in mine:
                before = (o.status, o.checked_until)
                pp.advance(o, bars)
                if (o.status, o.checked_until) != before:
                    store.paper_save(user, _plain(o))
                if o.status == pp.CLOSED:
                    realized += o.pnl
        if realized:
            store.paper_set_balance(user, acc["balance"] + realized)
            acc = store.paper_account(user)
        prices = {t: _last(t) for t in {o.ticker for o in live if o.status in (pp.WORKING, pp.OPEN)}}
        open_ = [o for o in live if o.status == pp.OPEN]
        upnl = sum(pp.unrealized(o, prices.get(o.ticker)) for o in open_)
        history = store.paper_orders(user, (pp.CLOSED, pp.CANCELLED), limit=60)
        closed = [h for h in history if h["status"] == pp.CLOSED]
        wins = sum(1 for h in closed if (h.get("pnl") or 0) > 0)
        return {"balance": acc["balance"], "start_balance": acc["start_balance"], "equity": acc["balance"] + upnl, "unrealized": upnl,
                "positions": [{**_plain(o), "last": prices.get(o.ticker), "upnl": pp.unrealized(o, prices.get(o.ticker))} for o in open_],
                "orders": [{**_plain(o), "last": prices.get(o.ticker)} for o in live if o.status == pp.WORKING],
                "history": history, "trades": len(closed), "win_rate": wins / len(closed) if closed else None}

    @app.get("/api/v1/paper")
    def paper_get(a: dict = Depends(logged_in)):
        return _paper_state(_owner(a))

    @app.post("/api/v1/paper/order")
    async def paper_order(request: Request, a: dict = Depends(logged_in)):
        b = await request.json()
        ticker = str(b.get("ticker", "")).upper()
        _info(ticker)
        num = lambda k: float(b[k]) if b.get(k) not in (None, "") else None   # noqa: E731
        side, typ, qty = int(b.get("side") or 0), str(b.get("type") or "market"), float(b.get("qty") or 0)
        price, sl, tp = num("price"), num("sl"), num("tp")
        last = await run_in_threadpool(_last, ticker)
        if last is None:
            raise HTTPException(503, "No price for this symbol right now.")
        problem = pp.validate(side, typ, qty, price, sl, tp, last)
        if problem:
            raise HTTPException(400, problem)
        now = pd.Timestamp.now(tz="UTC").floor("min")
        user = _owner(a)
        if len(store.paper_orders(user, (pp.WORKING, pp.OPEN))) >= 50:
            raise HTTPException(400, "Up to 50 open positions and orders.")
        o = pp.PaperOrder(id=0, ticker=ticker, side=side, type=typ, qty=qty, price=last if typ == "market" else price, sl=sl, tp=tp,
                          status=pp.OPEN if typ == "market" else pp.WORKING, created=now, checked_until=now,
                          fill_price=last if typ == "market" else None, filled_at=now if typ == "market" else None)
        store.paper_save(user, _plain(o))
        return await run_in_threadpool(_paper_state, user)

    def _mine(user: str, oid: int) -> "pp.PaperOrder":
        for d in store.paper_orders(user, (pp.WORKING, pp.OPEN)):
            if d["id"] == oid:
                return _order(d)
        raise HTTPException(404, "Order not found (it may have filled or closed).")

    @app.post("/api/v1/paper/{oid}/close")
    def paper_close(oid: int, a: dict = Depends(logged_in)):
        user = _owner(a)
        _paper_state(user)                 # fills / stops up to now first
        o = _mine(user, oid)
        if o.status == pp.WORKING:
            o.status = pp.CANCELLED
        else:
            last = _last(o.ticker)
            if last is None:
                raise HTTPException(503, "No price for this symbol right now.")
            pp._close(o, last, pd.Timestamp.now(tz="UTC"), "closed")
            acc = store.paper_account(user)
            store.paper_set_balance(user, acc["balance"] + o.pnl)
        store.paper_save(user, _plain(o))
        return _paper_state(user)

    @app.post("/api/v1/paper/{oid}/modify")
    async def paper_modify(oid: int, request: Request, a: dict = Depends(logged_in)):
        b = await request.json()
        user = _owner(a)
        o = _mine(user, oid)
        num = lambda k: (float(b[k]) if b.get(k) not in (None, "") else None) if k in b else getattr(o, k)   # noqa: E731
        sl, tp, price = num("sl"), num("tp"), num("price") if o.status == pp.WORKING else o.price
        last = await run_in_threadpool(_last, o.ticker) or (o.fill_price or o.price or 0)
        if o.status == pp.WORKING:
            problem = pp.validate(o.side, o.type, o.qty, price, sl, tp, last)
        else:
            problem = ("The stop loss must stay on the losing side." if sl is not None and o.side * (last - sl) <= 0 else
                       "The take profit must stay on the winning side." if tp is not None and o.side * (tp - last) <= 0 else None)
        if problem:
            raise HTTPException(400, problem)
        o.sl, o.tp, o.price = sl, tp, price if o.status == pp.WORKING else o.price
        store.paper_save(user, _plain(o))
        return await run_in_threadpool(_paper_state, user)

    @app.post("/api/v1/paper/reset")
    async def paper_reset(request: Request, a: dict = Depends(logged_in)):
        b = await request.json()
        start = float(b.get("balance") or 10_000)
        if not 100 <= start <= 10_000_000:
            raise HTTPException(400, "Start balance: 100 to 10,000,000.")
        store.paper_reset(_owner(a), start)
        return _paper_state(_owner(a))

    # ---- chart pictures shared by link ---------------------------------------------------------
    SNAP_MAX_BYTES = 3_000_000
    SNAP_PER_DAY = 40
    SNAP_ID = re.compile(r"^[A-Za-z0-9_-]{8,20}$")

    @app.post("/api/v1/snapshots")
    async def snapshot_add(request: Request, a: dict = Depends(logged_in)):
        import base64
        import secrets
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "Send JSON.")
        m = re.match(r"^data:image/(png|jpeg);base64,(.+)$", str(data.get("image") or ""), re.S)
        if not m:
            raise HTTPException(400, "The picture must be a PNG or JPEG data URL.")
        try:
            raw = base64.b64decode(m.group(2), validate=True)
        except ValueError:
            raise HTTPException(400, "The picture is not valid base64.")
        ext = "png" if m.group(1) == "png" else "jpg"
        if not (raw.startswith(b"\x89PNG\r\n\x1a\n") if ext == "png" else raw.startswith(b"\xff\xd8")):
            raise HTTPException(400, "That is not a picture.")
        if len(raw) > SNAP_MAX_BYTES:
            raise HTTPException(413, "The picture is too large (over 3 MB).")
        user = _owner(a)
        day_ago = (pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=1)).isoformat()
        if len(store.snapshots(user, day_ago)) >= SNAP_PER_DAY:
            raise HTTPException(429, f"You can share up to {SNAP_PER_DAY} pictures a day.")
        sid = secrets.token_urlsafe(9)
        (store.snapshot_dir / f"{sid}.{ext}").write_bytes(raw)
        title = re.sub(r"[\x00-\x1f<>]", "", str(data.get("title") or ""))[:120]
        store.add_snapshot(sid, user, title, ext, len(raw))
        return {"id": sid, "url": f"/api/v1/snapshots/{sid}", "image": f"/api/v1/snapshots/{sid}.{ext}"}

    @app.get("/api/v1/snapshots")
    def snapshot_list(a: dict = Depends(logged_in)):
        return {"snapshots": store.snapshots(_owner(a))}

    @app.delete("/api/v1/snapshots/{sid}")
    def snapshot_delete(sid: str, a: dict = Depends(logged_in)):
        if not SNAP_ID.match(sid) or not store.delete_snapshot(sid, _owner(a)):
            raise HTTPException(404, "No such picture.")
        return {"deleted": True}

    @app.get("/api/v1/snapshots/{name}")
    def snapshot_get(name: str, request: Request):
        """Open to everyone with the link: the picture itself (id.png / id.jpg) or a small page showing it."""
        from fastapi.responses import FileResponse, HTMLResponse
        from html import escape
        sid, _, ext = name.partition(".")
        row = store.snapshot(sid) if SNAP_ID.match(sid) else None
        if row is None:
            raise HTTPException(404, "This picture was removed or the link is wrong.")
        f = store.snapshot_dir / f"{sid}.{row['ext']}"
        if ext:
            if ext != row["ext"] or not f.exists():
                raise HTTPException(404, "No such picture.")
            return FileResponse(f, media_type="image/png" if row["ext"] == "png" else "image/jpeg",
                                headers={"Cache-Control": "public, max-age=86400"})
        img = f"/api/v1/snapshots/{sid}.{row['ext']}"
        full = str(request.base_url).rstrip("/") + img
        title = escape(row["title"] or "ICT Terminal chart")
        page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><meta property="og:title" content="{title}"><meta property="og:image" content="{escape(full)}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><meta name="robots" content="noindex">
<style>body{{margin:0;background:#0b1020;color:#e3e8f4;font:15px Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px}}
img{{max-width:100%;height:auto;border-radius:10px;border:1px solid #232c45}}a{{color:#2dd4bf}}small{{color:#8a94ad}}</style></head>
<body><h1 style="font-size:18px;margin:4px 0">{title}</h1><img src="{img}" alt="{title}">
<small>Shared {escape(row["created_at"][:16].replace("T", " "))} UTC · <a href="/">ICT Terminal</a> · not financial advice</small></body></html>"""
        return HTMLResponse(page, headers={"Cache-Control": "public, max-age=600"})

    # ---- usage statistics (admin > Statistics): page views, visitors, terminal opens and minutes ---------
    TRACK_KINDS = {"site": "site_view", "terminal_open": "terminal_open", "terminal_minute": "terminal_minute"}
    track_seen: dict[str, float] = {}

    @app.post("/api/v1/track")
    async def track(request: Request):
        """Anonymous use counters. Visitors are counted by a daily hash of address + browser (nothing personal
        is stored). Terminal minutes come from a once-a-minute ping while the terminal is visible."""
        import hashlib
        try:
            data = await request.json()
        except ValueError:
            data = {}
        kind = TRACK_KINDS.get(str(data.get("kind") or ""))
        if kind is None:
            return {"ok": False}
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")
        ua = request.headers.get("user-agent", "")[:200]
        day = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d")
        visitor = hashlib.sha256(f"{day}|{ip}|{ua}".encode()).hexdigest()[:20]
        # at most one count per visitor, kind and 20 s (refreshes and scripts do not inflate it)
        k = f"{visitor}|{kind}"
        now = time.time()
        if now - track_seen.get(k, 0) < 20:
            return {"ok": True}
        track_seen[k] = now
        if len(track_seen) > 50_000:
            track_seen.clear()
        if kind == "site_view":
            page = re.sub(r"[^A-Za-z0-9/_.-]", "", str(data.get("page") or "/"))[:80] or "/"
            ref = re.sub(r"[^A-Za-z0-9.-]", "", str(data.get("ref") or ""))[:60]
            await run_in_threadpool(store.count_usage, "site_view", page, 1, visitor, "site_visitor")
            if ref:
                await run_in_threadpool(store.count_usage, "site_ref", ref)
            return {"ok": True}
        a = await access(request)                                   # the terminal's user (guest / plan)
        who = hashlib.sha256(f"{day}|{_owner(a) or visitor}".encode()).hexdigest()[:20]
        platform = re.sub(r"[^a-z]", "", str(request.headers.get("X-Device-Platform", "web")).lower())[:12] or "web"
        plan = "guest" if a.get("guest") or a.get("status") == "guest" else ("vip" if a.get("is_vip") else "free")
        if kind == "terminal_open":
            await run_in_threadpool(store.count_usage, "terminal_open", platform, 1, who, "terminal_user")
            await run_in_threadpool(store.count_usage, "terminal_plan", plan)
        else:
            await run_in_threadpool(store.count_usage, "terminal_minute", platform, 1, who, "terminal_user")
        return {"ok": True}

    @app.get("/api/v1/alerts/fired")
    def alerts_fired(since: int = 0, a: dict = Depends(logged_in)):
        """Chart alerts the server sent (ms times), so the terminal can show them and switch them off."""
        return {"fired": store.alerts_fired(_owner(a), max(since, int(time.time() * 1000) - 7 * 86_400_000))}

    @app.get("/api/v1/layouts")
    def layouts_list(a: dict = Depends(logged_in)):
        return {"layouts": store.layouts(_owner(a))}

    @app.get("/api/v1/layouts/{name}")
    def layouts_get(name: str, a: dict = Depends(logged_in)):
        row = store.layout(_owner(a), name)
        if row is None:
            raise HTTPException(404, "No layout with this name.")
        return row

    @app.put("/api/v1/layouts/{name}")
    async def layouts_put(name: str, request: Request, a: dict = Depends(logged_in)):
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "The layout must be JSON.")
        try:
            updated = store.save_layout(_owner(a), name, data)
        except LayoutError as e:
            raise HTTPException(400, str(e))
        return {"name": name.strip(), "updated_at": updated}

    @app.delete("/api/v1/layouts/{name}")
    def layouts_delete(name: str, a: dict = Depends(logged_in)):
        if not store.delete_layout(_owner(a), name):
            raise HTTPException(404, "No layout with this name.")
        return {"deleted": name}

    # ---- chart templates: shared setups; staff publish them, the default one greets new users --------
    def _staff(a: dict) -> None:
        if not a.get("staff"):
            raise HTTPException(403, "Only the admin can change templates.")

    @app.get("/api/v1/templates")
    def templates_list(a: dict = Depends(logged_in)):
        return {"templates": store.templates(), "default": store.default_template(), "can_edit": bool(a.get("staff"))}

    @app.get("/api/v1/templates/{name}")
    def templates_get(name: str, a: dict = Depends(logged_in)):
        row = store.template(name)
        if row is None:
            raise HTTPException(404, "No template with this name.")
        return row

    @app.put("/api/v1/templates/{name}")
    async def templates_put(name: str, request: Request, default: bool = False, a: dict = Depends(logged_in)):
        _staff(a)
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "The template must be JSON.")
        try:
            updated = store.save_template(name, data)
            if default:
                store.set_default_template(name)
        except LayoutError as e:
            raise HTTPException(400, str(e))
        return {"name": name.strip(), "updated_at": updated, "default": store.default_template()}

    @app.post("/api/v1/templates/{name}/default")
    def templates_default(name: str, a: dict = Depends(logged_in)):
        _staff(a)
        try:
            store.set_default_template(name)
        except LayoutError as e:
            raise HTTPException(404, str(e))
        return {"default": name}

    @app.delete("/api/v1/templates/{name}")
    def templates_delete(name: str, a: dict = Depends(logged_in)):
        _staff(a)
        if not store.delete_template(name):
            raise HTTPException(404, "No template with this name.")
        return {"deleted": name}

    scan_cache: dict[tuple, tuple[float, list]] = {}

    @app.get("/api/v1/signals")
    def signals(symbol: str, frm: int = Query(alias="from"), to: int = Query(...), models: str = "",
                require_bias: bool = True, source: str = "store", a: dict = Depends(logged_in)):
        """Signals from the engine runner's store (fast), or ``source=scan`` to compute them now.
        Only the plan's models are returned, and a plan delay hides the newest signals."""
        feature(a, "signals", "Your plan does not include live signals.")
        i = _info(symbol)
        # unknown ids (a model removed since the layout was saved) are skipped
        ids = [m for m in models.split(",") if m in MODELS] if models.strip(",") else list(MODELS)
        if source not in ("store", "scan"):
            raise HTTPException(400, "source must be 'store' or 'scan'")
        f = a.get("features", {})
        allowed = f.get("models") or []
        if allowed != "all":
            ids = [m for m in ids if m in allowed]
        start, end = utc_range(frm, to)
        delay = f.get("signal_delay_minutes") or 0
        if delay:
            end = min(end, pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=delay))
        if not ids or end <= start:
            return {"symbol": i.ticker, "source": source, "signals": [], "delay_minutes": delay}
        # covered: the engine runner watches this symbol, so the store is complete for it
        covered = any(r.get("symbol") == i.symbol for r in store.status())
        if source == "store":
            return {"symbol": i.ticker, "source": "store", "delay_minutes": delay, "covered": covered,
                    "signals": store.signals(i.symbol, start, end, ids, bias_filter=require_bias)}
        # a scan is heavy: one per symbol / models / period every 5 minutes, shared by every user
        key = (i.ticker, tuple(sorted(ids)), require_bias, int(start.timestamp()) // 300, int(end.timestamp()) // 300)
        hit = scan_cache.get(key)
        if hit and time.time() - hit[0] < 300:
            return {"symbol": i.ticker, "source": "scan", "delay_minutes": delay, "covered": covered, "signals": hit[1]}
        df = provider.candles(i.ticker, start - pd.Timedelta(days=30), end)
        out = []
        if len(df) >= 1000:
            partner = _partner_1m(i, start - pd.Timedelta(days=30), end) if "M16" in ids else None
            ctx = Context(i.symbol, df, partner=partner)
            for mid in ids:
                for s in MODELS[mid].scan(ctx, require_bias=require_bias):
                    if start <= s.created_time < end:
                        d = s.to_dict()
                        d["model_id"] = mid
                        out.append(d)
            out.sort(key=lambda d: d["created_time"])
        if len(scan_cache) > 200:
            scan_cache.clear()
        scan_cache[key] = (time.time(), out)
        return {"symbol": i.ticker, "source": "scan", "delay_minutes": delay, "covered": covered, "signals": out}

    def _long_levels(ticker: str, last: pd.Timestamp) -> pd.DataFrame:
        """Daily levels of ~95 days (for the 60-day IPDA), cached 5 minutes: past days never change."""
        key = f"{ticker}|{last.floor('h')}"
        hit = levels_cache.get(key)
        if hit and time.time() - hit[0] < 300:
            return hit[1]
        lv = daily_levels(provider.candles(ticker, last - pd.Timedelta(days=95), last))
        if len(levels_cache) > 20:
            levels_cache.clear()
        levels_cache[key] = (time.time(), lv)
        return lv

    # ---- ICT Assistant (templates; an optional free LLM only rewrites the wording) -------------
    def _assistant_context(ticker: str, symbol: str, as_of: pd.Timestamp | None) -> Context | None:
        key = f"{ticker}|{as_of}"
        hit = ctx_cache.get(key)
        if hit and time.time() - hit[0] < 60:
            return hit[1]
        end = (as_of or pd.Timestamp.now(tz="UTC")) + pd.Timedelta(minutes=1)
        df = provider.candles(ticker, end - pd.Timedelta(days=35), end)   # 20+ trading days for IPDA 20D
        if len(df) < 500:
            return None
        ctx = Context(symbol, df)
        if len(ctx_cache) > 20:
            ctx_cache.clear()
        ctx_cache[key] = (time.time(), ctx)
        return ctx

    @app.post("/api/v1/agent/ask")
    async def agent_ask(request: Request, a: dict = Depends(logged_in)):
        try:
            data = await request.json()
        except ValueError:
            data = {}
        i = _info(str(data.get("symbol", "")))
        question = safe_question(str(data.get("question", "")))
        lang = "ur" if data.get("lang") == "ur" else "en"
        if not question:
            raise HTTPException(400, "Ask a question.")
        try:
            as_of = pd.Timestamp(data["as_of"]).tz_convert("UTC") if data.get("as_of") else None  # replay mode
        except (ValueError, TypeError):
            raise HTTPException(400, "as_of must be an ISO time with a timezone") from None
        ctx = await run_in_threadpool(_assistant_context, i.ticker, i.symbol, as_of)
        if ctx is None:
            raise HTTPException(503, "Not enough recent data for this symbol.")
        f = a.get("features", {})
        sigs = []
        if f.get("signals"):
            allowed = f.get("models") or []
            end = ctx.base.index[-1] + pd.Timedelta(minutes=1)
            if f.get("signal_delay_minutes"):
                end = min(end, pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=f["signal_delay_minutes"]))
            ids = list(MODELS) if allowed == "all" else [m for m in MODELS if m in allowed]
            sigs = store.signals(i.symbol, end - pd.Timedelta(hours=24), end, ids, bias_filter=False) if ids else []
        ans = assistant_ask(ctx, question, sigs, lang)
        out = {**ans.to_dict(), "symbol": i.ticker, "llm": False}
        user = a.get("email") or a.get("user") or "?"
        if ans.intent != "unknown":
            # the user's own key (no plan limit), else the site's model from the admin panel, else api/.env
            cfg = await run_in_threadpool(auth.ai_config, a.get("email") or "") if require_auth else {}
            own = LLM.from_config(cfg.get("user"))
            model = own or LLM.from_config(cfg.get("site")) or (llm if llm.enabled else None)
            if model is not None and (own is not None or store.use_agent(user, int(f.get("ai_messages_per_day") or 0))):
                better = await run_in_threadpool(model.rephrase, question, ans.text, lang)
                if better:
                    out.update(text=better, llm=True, facts=ans.text, llm_by=model.provider)
        return out

    # ---- ICT Bridge EA ------------------------------------------------------------------------
    def _ea_models(approved: list[str]) -> list[tuple[str, bool]]:
        """Admin entries are 'M9' (signals made without the bias filter) or 'M9:BIAS'."""
        out = []
        for m in approved:
            mid, _, flag = m.partition(":")
            if mid in MODELS:
                out.append((mid, flag.upper() == "BIAS"))
        return out

    # ---- the customer's auto-trading settings (terminal > MT5 tab), applied to what their EA gets -----------
    GRADE_RANK = {"A+": 3, "A": 2, "B": 1}
    SESSIONS = {"asia": (18, 2), "london": (2, 7), "ny_am": (7, 12), "ny_pm": (12, 18)}   # New York hours [from, to)

    def _session_of(hour: int) -> str:
        for name, (a, b) in SESSIONS.items():
            if (a <= hour < b) if a < b else (hour >= a or hour < b):
                return name
        return ""

    def _user_pairs(approved: list[str], f: dict) -> list[tuple[str, bool]]:
        """The admin's approved models, narrowed to the user's choice; the user can add the daily-bias filter
        (never remove the admin's)."""
        mine = set(f.get("models") or [])
        out = []
        for mid, bias in _ea_models(approved):
            if mine and mid not in mine:
                continue
            pair = (mid, bias or bool(f.get("bias_only")))
            if pair not in out:
                out.append(pair)
        return out

    def _filter_steps(f: dict):
        """(label, test) for each of the user's filters on one signal."""
        syms = {s.upper() for s in f.get("symbols") or []}
        need = {"A+": 3, "A": 2}.get(f.get("min_grade") or "all", 0)
        sess = set(f.get("sessions") or [])
        days = set(f.get("weekdays") or [])
        direction = {"long": 1, "short": -1}.get(f.get("direction") or "both")

        def ny(s):
            return _ny(s["created_time"])
        return [
            ("Your symbols", lambda s: not syms or str(s.get("symbol", "")).upper() in syms),
            ("Grade", lambda s: GRADE_RANK.get(s.get("grade") or "", 0) >= need),
            ("Direction", lambda s: direction is None or int(s.get("direction") or 0) == direction),
            ("Sessions", lambda s: not sess or _session_of(ny(s).hour) in sess),
            ("Week days", lambda s: not days or ny(s).weekday() in days),
        ]

    def _ny(t) -> pd.Timestamp:
        t = pd.Timestamp(t)
        return (t.tz_localize("UTC") if t.tz is None else t).tz_convert("America/New_York")

    def _passes(s: dict, f: dict) -> bool:
        return all(test(s) for _, test in _filter_steps(f))

    def _day_cap(sigs: list[dict], f: dict, now: pd.Timestamp, pairs) -> list[dict]:
        """At most ``max_trades_day`` signals a New York day: the first ones of the day that passed the filters."""
        cap = int(f.get("max_trades_day") or 0)
        if cap <= 0 or not sigs:
            return sigs
        day0 = now.tz_convert("America/New_York").normalize().tz_convert("UTC")
        today = [s for s in store.signals_window(day0, now, pairs) if _passes(s, f)]
        allowed = {s["id"] for s in today[:cap]}
        return [s for s in sigs if s["id"] in allowed]

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _save_ea_state(r: dict, data: dict) -> None:
        """Keeps the account snapshot the EA sent (EA 1.11+), shown in the terminal's MT5 tab."""
        email = (r.get("access") or {}).get("email") or ""
        login = str(data.get("mt5_login") or "")[:20]
        if not email or not login or "positions" not in data:
            return
        pos = [{"ticket": str(p.get("ticket", ""))[:24], "symbol": str(p.get("symbol", ""))[:24], "side": 1 if p.get("side") == 1 else -1,
                **{k: _num(p.get(k)) for k in ("volume", "open", "sl", "tp", "price", "profit", "swap", "time")},
                "magic": str(p.get("magic", ""))[:20], "comment": str(p.get("comment", ""))[:40]}
               for p in (data.get("positions") or [])[:50] if isinstance(p, dict)]
        orders = [{"ticket": str(o.get("ticket", ""))[:24], "symbol": str(o.get("symbol", ""))[:24], "type": int(_num(o.get("type")) or 0),
                   **{k: _num(o.get(k)) for k in ("volume", "price", "sl", "tp")}, "magic": str(o.get("magic", ""))[:20]}
                  for o in (data.get("orders") or [])[:50] if isinstance(o, dict)]
        store.set_ea_state(email, login, {"server": str(data.get("mt5_server") or "")[:80], "currency": str(data.get("currency") or "")[:8],
                                          "balance": _num(data.get("balance")), "equity": _num(data.get("equity")),
                                          "ea_version": str(data.get("ea_version") or "")[:20], "magic": str(data.get("magic") or "")[:20],
                                          "positions": pos, "orders": orders})

    EA_FILES = {"ICT_Bridge.mq5", "ICT_Json.mqh"}

    @app.get("/api/v1/ea/download/{name}")
    def ea_download(name: str):
        """The ICT Bridge EA source (open it in MetaEditor and press Compile)."""
        from pathlib import Path as _P
        from fastapi.responses import FileResponse
        f = _P(__file__).resolve().parents[2] / "ea" / "mt5" / name
        if name not in EA_FILES or not f.exists():
            raise HTTPException(404, "No such file.")
        return FileResponse(f, media_type="text/plain", filename=name)

    @app.get("/api/v1/mt5/state")
    def mt5_state(a: dict = Depends(logged_in)):
        """The user's MT5 accounts as their ICT Bridge EA last reported them, and the EA's recent trade events."""
        user = _owner(a)
        return {"accounts": store.ea_states(user), "events": store.ea_events(user, limit=50)}

    @app.post("/api/v1/ea/feed")
    async def ea_feed(request: Request):
        """The EA's poll: check-in (login, balance, ...) and the signals it may trade right now."""
        try:
            data = await request.json()
        except ValueError:
            data = {}
        info = {k: data.get(k) for k in ("mt5_login", "mt5_server", "balance", "currency", "ea_version", "open_copies")}
        r = await run_in_threadpool(auth.ea_checkin, str(data.get("ea_token", "")), info,
                                    request.client.host if request.client else "")
        now = pd.Timestamp.now(tz="UTC")
        base = {"server_time": now.isoformat(), "active": False, "reason": r.get("reason", ""), "signals": []}
        if not r.get("copy"):
            return JSONResponse(status_code=401, content=base)
        copy = r["copy"]
        _save_ea_state(r, data)
        if not r.get("valid") or not copy.get("active"):
            return {**base, "reason": copy.get("reason") or r.get("reason", "")}
        f = copy.get("filters") or {}
        models = _user_pairs(copy.get("models") or [], f)
        sigs = [s for s in store.live_signals(now, models) if _passes(s, f)]
        sigs = _day_cap(sigs, f, now, models)
        keep = ("id", "model_id", "symbol", "direction", "entry", "stop", "targets", "expiry", "time_stop",
                "exit_by", "created_time", "grade")
        out = {**base, "active": True, "reason": "", "models": [m for m, _ in models],
               "signals": [{k: s.get(k) for k in keep} for s in sigs]}
        # the user's risk settings replace the EA's inputs (EA 1.12+); sent only when set
        for key, name in (("risk_percent", "user_risk_percent"), ("max_open", "user_max_open"),
                          ("max_daily_loss", "user_max_daily_loss")):
            v = _num(f.get(key))
            if v and v > 0:
                out[name] = v
        return out

    @app.post("/api/v1/mt5/preview")
    async def mt5_preview(request: Request, a: dict = Depends(logged_in)):
        """How the signals of the last N days pass through the auto-trading settings, step by step, before any
        reaches MT5. Body: {approved: [...admin models from copy settings], filters: {...}, days}."""
        try:
            data = await request.json()
        except ValueError:
            data = {}
        f = data.get("filters") if isinstance(data.get("filters"), dict) else {}
        approved = [str(m).upper()[:20] for m in (data.get("approved") or []) if isinstance(m, str)][:40]
        days = min(max(int(_num(data.get("days")) or 7), 1), 30)
        now = pd.Timestamp.now(tz="UTC")
        start = now - pd.Timedelta(days=days)

        def run():
            steps = []
            every = store.signals_window(start, now)
            steps.append({"step": "All signals (every model)", "n": len(every)})
            admin_pairs = _ea_models(approved)
            adm = store.signals_window(start, now, admin_pairs)
            steps.append({"step": "Approved by admin for auto-trading", "n": len(adm)})
            mine = set(f.get("models") or [])
            steps.append({"step": "Your models", "n": sum(1 for s in adm if not mine or s["model_id"] in mine)})
            pairs = _user_pairs(approved, f)
            cur = store.signals_window(start, now, pairs)
            steps.append({"step": "Daily bias agrees" if f.get("bias_only") else "Daily bias (off: not checked)", "n": len(cur)})
            for label, test in _filter_steps(f):
                cur = [s for s in cur if test(s)]
                steps.append({"step": label, "n": len(cur)})
            cap = int(_num(f.get("max_trades_day")) or 0)
            if cap > 0:
                per_day: dict = {}
                kept = []
                for s in cur:
                    d = _ny(s["created_time"]).date()
                    if per_day.get(d, 0) < cap:
                        per_day[d] = per_day.get(d, 0) + 1
                        kept.append(s)
                cur = kept
                steps.append({"step": f"Max {cap} a day", "n": len(cur)})
            last = [{"id": s["id"], "time": s["created_time"], "symbol": s["symbol"], "model_id": s["model_id"],
                     "direction": s.get("direction"), "grade": s.get("grade") or "", "entry": s.get("entry"),
                     "stop": s.get("stop")} for s in cur[-25:]][::-1]
            return {"days": days, "steps": steps, "signals": last}
        return await run_in_threadpool(run)

    @app.post("/api/v1/ea/report")
    async def ea_report(request: Request):
        """Fills, exits and errors from the EA, kept for the journal."""
        try:
            data = await request.json()
        except ValueError:
            data = {}
        r = await run_in_threadpool(auth.ea_checkin, str(data.get("ea_token", "")), {"checkin": False},
                                    request.client.host if request.client else "")
        if not r.get("copy"):
            raise HTTPException(401, r.get("reason") or "Invalid EA token.")
        events = [e for e in (data.get("events") or []) if isinstance(e, dict)][:100]
        n = store.add_ea_events(r.get("access", {}).get("email", "") or "unknown", str(data.get("mt5_login", "")), events)
        return {"stored": n}

    # ---- Google / Facebook sign-in pages (the browser goes through this server to the panel) -------
    OAUTH_PAGES = re.compile(r"(google|facebook)/(start|callback)|finish")

    @app.api_route("/api/v1/oauth/{rest:path}", methods=["GET", "POST"])
    async def oauth_pages(rest: str, request: Request):
        """Start (redirect to Google / Facebook), callback (the "continue?" page) and finish (the form post) are
        HTML pages of the admin panel: passed through as they are, redirects included. oauth/poll is JSON (forward)."""
        from fastapi.responses import Response
        if rest == "poll":
            return await forward("oauth/poll", request)
        if not OAUTH_PAGES.fullmatch(rest):
            raise HTTPException(404, "Not found")
        import requests as rq
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")
        headers = auth._service_headers(ip)
        if request.headers.get("content-type"):
            headers["Content-Type"] = request.headers["content-type"]
        body = await request.body()

        def call():
            return rq.request(request.method, f"{auth.panel_url}/api/v1/oauth/{rest}", params=dict(request.query_params),
                              data=body or None, headers=headers, allow_redirects=False, timeout=20)
        try:
            r = await run_in_threadpool(call)
        except rq.RequestException:
            return JSONResponse(status_code=503, content={"detail": "Account server is unreachable. Try again shortly."})
        out = {k: v for k, v in r.headers.items() if k.lower() in ("location", "content-type", "cache-control")}
        return Response(r.content, status_code=r.status_code, headers=out)

    # ---- accounts & billing: forwarded to the admin panel ---------------------------------
    @app.api_route("/api/v1/{path:path}", methods=["GET", "POST"])
    async def forward(path: str, request: Request):
        if not forwarded(request.method, path):
            raise HTTPException(404, "Not found")
        body = None
        if request.method == "POST":
            try:
                body = await request.json()
            except ValueError:
                body = {}
        query = {k: v for k, v in request.query_params.items()} if request.method == "GET" else None
        status, data = await run_in_threadpool(auth.forward, request.method, path, body, dict(request.headers),
                                               request.client.host if request.client else "", query)
        token = _token(request)
        if path in ("auth/logout", "auth/password/change") and status == 200:
            auth.forget(token)
        elif path == "auth/me" and status == 200:
            auth.remember(token, request.headers.get("X-Device-Id", ""), dict(data.get("access") or {}))
        elif path == "auth/me" and status == 401:
            auth.forget(token)
        return JSONResponse(status_code=status, content=data)

    return app


app = create_app(watch_alerts=os.getenv("ICT_ALERT_WATCH", "true").strip().lower() not in ("0", "false", "no", "off"))
