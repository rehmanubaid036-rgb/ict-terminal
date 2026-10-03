"""ICT Assistant: answers chart questions from engine data with templates. No language model,
so it costs nothing and puts no load on the server. An optional LLM (see ``llm.py``) may
rephrase the answer, but every fact comes from here.

``ask(ctx, question, signals, lang)`` -> {"intent", "text", "data"}
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .bias import bias_at
from .context import Context
from .core import clock
from .indicators.fvg import active_at
from .indicators.liquidity import BSL, SSL
from .models.common import session_levels, swing_levels

INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("help", ("help", "madad", "kya kar", "what can")),
    ("bias", ("bias", "direction", "trend", "bullish", "bearish", "rukh")),
    ("levels", ("level", "open", "pdh", "pdl", "midnight", "range")),
    ("liquidity", ("liquid", "bsl", "ssl", "stop", "equal high", "equal low", "eqh", "eql", "sweep")),
    ("fvg", ("fvg", "gap", "imbalance", "bisi", "sibi")),
    ("signals", ("signal", "setup", "trade", "model", "scan", "entry")),
    ("session", ("session", "time", "killzone", "kill zone", "silver bullet", "waqt", "macro", "window")),
]

T = {
    "en": {
        "help": ("I read the chart with the ICT engine. Ask about: bias, levels, liquidity, FVG, signals, "
                 "session / killzone. Example: \"where is liquidity?\""),
        "unknown": "I did not understand. Try: bias, levels, liquidity, FVG, signals or session.",
        "bias": "Daily bias for {symbol}: {dir} (score {score}). {parts}. Draw on liquidity: {draw}.",
        "no_bias": "Daily bias for {symbol}: neutral (score {score}). {parts}. Wait for clarity.",
        "levels": "{symbol} key levels today: {items}.",
        "liq": "{symbol} at {price}: nearest buy-side liquidity {above}; nearest sell-side liquidity {below}.",
        "fvg": "{symbol} {tf} active FVGs near {price}: {items}.",
        "no_fvg": "No active {tf} FVG near price on {symbol}.",
        "signals": "{symbol} signals in the last 24h: {items}.",
        "no_signals": "No model signal on {symbol} in the last 24h.",
        "session": "New York time {ny}. Session: {session}. {kz}{next}",
        "in_kz": "Inside {kz}. ",
        "next": "Next Silver Bullet: {name} at {at} NY.",
        "bull": "BULLISH", "bear": "BEARISH",
    },
    "ur": {
        "help": ("Main ICT engine se chart parhta hoon. Poochiye: bias, levels, liquidity, FVG, signals, "
                 "session / killzone. Misal: \"liquidity kahan hai?\""),
        "unknown": "Samajh nahi aaya. Ye try karein: bias, levels, liquidity, FVG, signals ya session.",
        "bias": "{symbol} ka daily bias: {dir} (score {score}). {parts}. Draw on liquidity: {draw}.",
        "no_bias": "{symbol} ka daily bias: neutral (score {score}). {parts}. Abhi wazeh nahi, intezar karein.",
        "levels": "{symbol} ke aaj ke key levels: {items}.",
        "liq": "{symbol} {price} pe hai: qareebi buy-side liquidity {above}; qareebi sell-side liquidity {below}.",
        "fvg": "{symbol} {tf} pe price {price} ke qareeb active FVGs: {items}.",
        "no_fvg": "{symbol} pe price ke qareeb koi active {tf} FVG nahi.",
        "signals": "{symbol} pe pichle 24 ghante ke signals: {items}.",
        "no_signals": "{symbol} pe pichle 24 ghante mein koi model signal nahi.",
        "session": "New York time {ny}. Session: {session}. {kz}{next}",
        "in_kz": "{kz} chal raha hai. ",
        "next": "Agla Silver Bullet: {name}, {at} NY.",
        "bull": "BULLISH", "bear": "BEARISH",
    },
}

COMPONENT_NAMES = {"daily_structure": "daily structure", "h4_structure": "4H structure",
                   "ipda_zone": "IPDA zone", "pd_reaction": "PDH/PDL reaction", "mo_zone": "Midnight Open"}


@dataclass
class Answer:
    intent: str
    text: str
    data: dict

    def to_dict(self) -> dict:
        return {"intent": self.intent, "text": self.text, "data": self.data}


def detect_intent(question: str) -> str:
    q = question.lower()
    for name, words in INTENTS:
        if any(w in q for w in words):
            return name
    return "unknown"


def ask(ctx: Context, question: str, signals: list[dict] | None = None, lang: str = "en",
        fvg_tf: str = "15m") -> Answer:
    lang = lang if lang in T else "en"
    tr = T[lang]
    intent = detect_intent(question)
    t = len(ctx.base) - 1
    price = ctx.price(t)
    sym = ctx.symbol
    fmt = _fmt(ctx)

    if intent == "help":
        return Answer(intent, tr["help"], {})
    if intent == "bias":
        b = bias_at(ctx, t)
        parts = ", ".join(f"{COMPONENT_NAMES.get(k, k.replace('_', ' '))} {'+' if v > 0 else '-' if v < 0 else '0'}" for k, v in b.components.items())
        draw = f"{fmt(b.draw)} ({b.draw_source})" if b.draw is not None else "-"
        key = "bias" if b.direction else "no_bias"
        d = tr["bull"] if b.direction > 0 else tr["bear"]
        return Answer(intent, tr[key].format(symbol=sym, dir=d, score=b.score, parts=parts, draw=draw),
                      {"direction": b.direction, "score": b.score, "components": b.components, "draw": b.draw})
    if intent == "levels":
        lv = ctx.day_levels(t)
        names = [("midnight_open", "Midnight Open"), ("ny_true_open", "NY True Open 07:30"), ("open_0930", "09:30 Open"),
                 ("pdh", "PDH"), ("pdl", "PDL"), ("asian_range_high", "Asian High"), ("asian_range_low", "Asian Low"),
                 ("london_high", "London High"), ("london_low", "London Low")]
        items = [(label, float(lv[k])) for k, label in names if lv is not None and np.isfinite(lv[k])]
        text = tr["levels"].format(symbol=sym, items=", ".join(f"{a} {fmt(v)}" for a, v in items) or "-")
        return Answer(intent, text, {"levels": dict(items)})
    if intent == "liquidity":
        lvls = session_levels(ctx, t) + swing_levels(ctx, t, ("15m", "1h", "4h"), 1)
        above = _unique(sorted((l for l in lvls if l.side == BSL and l.price > price), key=lambda l: l.price))[:3]
        below = _unique(sorted((l for l in lvls if l.side == SSL and l.price < price), key=lambda l: -l.price))[:3]
        fa = ", ".join(f"{fmt(l.price)} ({l.name})" for l in above) or "-"
        fb = ", ".join(f"{fmt(l.price)} ({l.name})" for l in below) or "-"
        return Answer(intent, tr["liq"].format(symbol=sym, price=fmt(price), above=fa, below=fb),
                      {"price": price, "bsl": [(l.price, l.name) for l in above], "ssl": [(l.price, l.name) for l in below]})
    if intent == "fvg":
        p = ctx.htf_pos(fvg_tf, t)
        f = active_at(ctx.analyses[fvg_tf].fvgs, p) if p >= 0 else pd.DataFrame()
        if len(f):
            f = f.assign(dist=(f["ce"] - price).abs()).sort_values("dist").head(4)
        if not len(f):
            return Answer(intent, tr["no_fvg"].format(symbol=sym, tf=fvg_tf), {"fvgs": []})
        rows = [{"dir": "BISI" if r.direction > 0 else "SIBI", "bottom": float(r.bottom), "top": float(r.top),
                 "ce": float(r.ce), "status": r.status} for r in f.itertuples()]
        items = ", ".join(f"{x['dir']} {fmt(x['bottom'])}-{fmt(x['top'])} (CE {fmt(x['ce'])}, {x['status']})" for x in rows)
        return Answer(intent, tr["fvg"].format(symbol=sym, tf=fvg_tf, price=fmt(price), items=items), {"fvgs": rows})
    if intent == "signals":
        sigs = signals or []
        if not sigs:
            return Answer(intent, tr["no_signals"].format(symbol=sym), {"signals": []})
        now = ctx.base.index[-1]

        def when(s) -> str:
            # "01 Oct 10:13 NY (2h ago)": the time the setup formed, New York time
            try:
                t = pd.Timestamp(s["created_time"])
                t = t.tz_localize("UTC") if t.tzinfo is None else t
            except (KeyError, ValueError):
                return ""
            mins = max(0, int((now - t).total_seconds() // 60))
            ago = f"{mins}m" if mins < 60 else f"{mins // 60}h" if mins < 48 * 60 else f"{mins // 1440}d"
            return f"{t.tz_convert(clock.NY).strftime('%d %b %H:%M')} NY ({ago} ago) "

        items = "; ".join(
            f"{when(s)}{s.get('model_id', '')} {'LONG' if s['direction'] > 0 else 'SHORT'} {s.get('grade', '')} "
            f"entry {fmt(s['entry'])} SL {fmt(s['stop'])} TP {fmt(s['targets'][-1][0])}" for s in reversed(sigs[-5:]))
        return Answer(intent, tr["signals"].format(symbol=sym, items=items), {"signals": sigs[-5:]})
    if intent == "session":
        now = ctx.base.index[t]
        ny = now.tz_convert(clock.NY)
        sess = clock.session_of(now)
        kzs = clock.active_windows(now, ("killzone", "silver_bullet", "macro"))
        kz = tr["in_kz"].format(kz=", ".join(clock.get_window(k).label for k in kzs)) if kzs else ""
        nxt = _next_silver_bullet(now)
        nx = tr["next"].format(name=nxt[0], at=nxt[1].tz_convert(clock.NY).strftime("%H:%M")) if nxt else ""
        return Answer(intent, tr["session"].format(ny=ny.strftime("%a %H:%M"), session=clock.get_window(sess).label, kz=kz,
                                                   next=nx), {"session": sess, "windows": kzs})
    return Answer("unknown", tr["unknown"], {})


def _unique(levels):
    """One entry per price (the same swing often appears on several timeframes)."""
    seen, out = set(), []
    for lv in levels:
        key = round(lv.price, 6)
        if key not in seen:
            seen.add(key)
            out.append(lv)
    return out


def _next_silver_bullet(now: pd.Timestamp):
    day = clock.trading_day(now)
    best = None
    for d in (day, day + pd.Timedelta(days=1)):
        for key in ("london_sb", "ny_am_sb", "ny_pm_sb"):
            w = clock.get_window(key)
            start = w.bounds(d)[0]
            if start > now and (best is None or start < best[1]):
                best = (w.label, start)
    return best


def _fmt(ctx: Context):
    decimals = max(0, -int(np.floor(np.log10(ctx.spec.tick_size)))) if ctx.spec.tick_size < 1 else 0
    return lambda v: "-" if v is None else f"{v:,.{decimals}f}"


def safe_question(q: str, max_len: int = 300) -> str:
    """Trim and strip control characters from user text before it is used anywhere."""
    q = re.sub(r"[\x00-\x1f\x7f]", " ", q or "")
    return q.strip()[:max_len]
