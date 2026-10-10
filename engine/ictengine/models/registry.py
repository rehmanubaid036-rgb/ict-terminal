"""All models the engine can run, by id. The API, backtester and admin panel list models from
here, and each can be switched on/off per user/plan."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ..context import Context
from ..signals import Signal
from . import alpha_gold, array_models, asian_q2, filters, news_model, reversal_models, silver_bullet, vsa_engulf_ea, vsisa, wolf_asia


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    scan: Callable[..., list[Signal]]
    source: str  # rulebook origin: 'PDF' (user journal) or 'WEB' (research)
    default_on: bool = True  # False: listed and selectable, but not in the signal lists / alerts until chosen


def _sb(ctx: Context, **kw) -> list[Signal]:
    from dataclasses import replace
    cfg = replace(silver_bullet.SBConfig(), **kw) if kw else silver_bullet.SBConfig()
    return silver_bullet.scan(ctx, cfg)


MODELS: dict[str, ModelInfo] = {m.id: m for m in (
    ModelInfo("M1", "Silver Bullet", _sb, "PDF"),
    ModelInfo("M2", "ICT 2022 Mentorship Model", reversal_models.scan_m2, "WEB"),
    ModelInfo("M3", "Judas Swing / Turtle Soup", reversal_models.scan_m3, "PDF"),
    ModelInfo("M4", "Optimal Trade Entry (OTE)", reversal_models.scan_m4, "PDF"),
    ModelInfo("M5", "Asian Q2 Judas", asian_q2.scan_m5, "PDF"),
    ModelInfo("M6", "Asian Range Scalp", reversal_models.scan_m6, "PDF"),
    ModelInfo("M7", "Unicorn", reversal_models.scan_m7, "WEB"),
    ModelInfo("M8", "Power of 3 (AMD)", reversal_models.scan_m8, "PDF"),
    ModelInfo("M9", "Market Maker Buy/Sell (simplified)", reversal_models.scan_m9, "WEB"),
    ModelInfo("M10", "News Aftermath", news_model.scan_m10, "PDF"),
    ModelInfo("M11", "IFVG Reversal", array_models.scan_m11, "WEB", default_on=False),   # weakest in the 2026-10 audit
    ModelInfo("M12", "Breaker Model", array_models.scan_m12, "WEB"),
    ModelInfo("M13", "Opening Range Gap", array_models.scan_m13, "WEB"),
    ModelInfo("M14", "London Close Reversal", reversal_models.scan_m14, "WEB"),
    ModelInfo("M15", "London Protraction", reversal_models.scan_m15, "WEB"),
    ModelInfo("M16", "SMT Reversal", filters.scan_m16, "WEB"),
    ModelInfo("M17", "Wolf Asia Session (NDOG)", wolf_asia.scan_m17, "WOLF"),
    ModelInfo("M18", "The Alpha Model Gold", alpha_gold.scan_m18, "WOLF"),
    # Custom Models > VSA Models: the user's volume-spread-analysis EA (XAUUSD, 5m / 15m)
    ModelInfo("M19", "VSA Engulf Hybrid EA (Gold)", vsa_engulf_ea.scan_m19, "VSA"),
    # Custom Models > VSA Models: the VSISA course (Sajid Ahmed), docs/research/vsisa/VSISA_LOGIC.md
    ModelInfo("M20", "VSA Imbalance Shift", vsisa.scan_m20, "VSA"),
    ModelInfo("M21", "VSA Low-Volume Engulf", vsisa.scan_m21, "VSA"),
    ModelInfo("M22", "VSA End of Rising / Falling Market", vsisa.scan_m22, "VSA"),
    ModelInfo("M23", "VSA False Break", vsisa.scan_m23, "VSA"),
    ModelInfo("M24", "VSA No-Supply / No-Demand Test", vsisa.scan_m24, "VSA"),
    ModelInfo("M25", "VSA AR / AS Line Break", vsisa.scan_m25, "VSA"),
)}


def run_models(ctx: Context, ids=None, **kw) -> list[Signal]:
    ids = list(MODELS) if ids is None else ids
    out: list[Signal] = []
    for i in ids:
        out.extend(MODELS[i].scan(ctx, **kw))
    return sorted(out, key=lambda s: s.created_time)
