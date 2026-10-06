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

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request
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

from .auth_client import GUEST_FEATURES, AuthClient
from .llm import LLM
from .market import Provider, default_provider, utc_range

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
}
# a customer's own crypto order: status, cancel, transaction hash (the panel checks ownership)
FORWARD_PATTERNS = [("GET", re.compile(r"payments/crypto/order/\d+")),
                    ("POST", re.compile(r"payments/crypto/order/\d+/(cancel|txid)"))]


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
               require_auth: bool | None = None, llm: LLM | None = None) -> FastAPI:
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
        return {"supported_resolutions": ["1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W"],
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
                "supported_resolutions": ["1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W"],
                "volume_precision": 0, "data_status": "streaming"}

    @app.get("/udf/search")
    def udf_search(query: str = "", limit: int = 30, type: str = "", exchange: str = "", a: dict = Depends(logged_in)):
        q = query.upper()
        out = [{"symbol": i.ticker, "full_name": i.ticker, "description": i.description, "exchange": i.feed,
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
        df = _bars(i.ticker, tf, start - WARMUP[tf], end)
        if len(df) < 3:
            return {"symbol": i.ticker, "resolution": resolution, "objects": []}
        a = analyze(df[["open", "high", "low", "close", "volume"]], Params.for_timeframe(tf))
        objs = overlays(a, lookback_bars=len(df), include=tuple(x for x in inc if x in CHART_LAYERS))

        if "smt" in inc and i.symbol in SMT_PARTNERS:
            partner = provider.symbols().get(f"{i.feed}:{SMT_PARTNERS[i.symbol]}")
            if partner is not None:
                pdf = _bars(partner.ticker, tf, start - WARMUP[tf], end)
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
                 "allowed": allowed == "all" or m.id in allowed} for m in MODELS.values()]

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
            out.append({"symbol": t, "price": last, "change": last - prev,
                        "change_pct": (last - prev) / prev * 100 if prev else None,
                        "time": int(d.index[-1].timestamp())})
        return {"quotes": out}

    # ---- saved terminal layouts (charts, indicators, ICT layers, drawings) per user -----------
    def _owner(a: dict) -> str:
        return str(a.get("email") or a.get("user") or "")

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
            ctx = Context(i.symbol, df)
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
        if llm.enabled and ans.intent != "unknown" and store.use_agent(user, int(f.get("ai_messages_per_day") or 0)):
            better = await run_in_threadpool(llm.rephrase, question, ans.text, lang)
            if better:
                out.update(text=better, llm=True, facts=ans.text)
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
        if not r.get("valid") or not copy.get("active"):
            return {**base, "reason": copy.get("reason") or r.get("reason", "")}
        models = _ea_models(copy.get("models") or [])
        sigs = store.live_signals(now, models)
        keep = ("id", "model_id", "symbol", "direction", "entry", "stop", "targets", "expiry", "time_stop",
                "exit_by", "created_time", "grade")
        return {**base, "active": True, "reason": "", "models": [m for m, _ in models],
                "signals": [{k: s.get(k) for k in keep} for s in sigs]}

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
        status, data = await run_in_threadpool(auth.forward, request.method, path, body, dict(request.headers),
                                               request.client.host if request.client else "")
        token = _token(request)
        if path in ("auth/logout", "auth/password/change") and status == 200:
            auth.forget(token)
        elif path == "auth/me" and status == 200:
            auth.remember(token, request.headers.get("X-Device-Id", ""), dict(data.get("access") or {}))
        elif path == "auth/me" and status == 401:
            auth.forget(token)
        return JSONResponse(status_code=status, content=data)

    return app


app = create_app()
