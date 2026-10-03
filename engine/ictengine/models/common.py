"""Building blocks shared by the ICT models: key liquidity levels, sweeps of them, target
ladders and partial allocation."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..context import Context
from ..core import clock
from ..indicators.liquidity import BSL, SSL, resting_at


@dataclass(frozen=True)
class KeyLevel:
    price: float
    side: str        # 'bsl' above price / 'ssl' below
    name: str        # 'asian_range_low', 'pdh', '1m_eqh', ...
    known_pos: int   # first base bar at which the level exists


def session_levels(ctx: Context, t: int) -> list[KeyLevel]:
    """Session / daily highs and lows that are complete at base bar ``t`` (rulebook 1.6)."""
    lv = ctx.day_levels(t)
    if lv is None:
        return []
    day = ctx.trading_day[t]
    out = []
    first_today = int(np.searchsorted(ctx.trading_day, day))
    for key in ("pdh", "pdl", "pwh", "pwl"):
        if np.isfinite(lv[key]):
            out.append(KeyLevel(float(lv[key]), BSL if key.endswith("h") else SSL, key, first_today))
    day_d = pd.Timestamp(day).date()
    for win, prefix in (("asian_range", "asian_range"), ("asia", "asia"), ("london", "london"), ("cbdr", "cbdr")):
        end = clock.get_window(win).bounds(day_d)[1]
        end_pos = ctx.pos_of(end)
        if end_pos <= t and np.isfinite(lv[f"{prefix}_high"]):
            out.append(KeyLevel(float(lv[f"{prefix}_high"]), BSL, f"{prefix}_high", end_pos))
            out.append(KeyLevel(float(lv[f"{prefix}_low"]), SSL, f"{prefix}_low", end_pos))
    return out


def running_range(ctx: Context, start: pd.Timestamp, t: int, name: str) -> list[KeyLevel]:
    """High / low from ``start`` up to bar ``t`` (e.g. NY pre-market 06:00 -> window open)."""
    s = ctx.pos_of(start)
    if s > t:
        return []
    seg = ctx.base.iloc[s:t + 1]
    return [KeyLevel(float(seg["high"].max()), BSL, f"{name}_high", t + 1),
            KeyLevel(float(seg["low"].min()), SSL, f"{name}_low", t + 1)]


def swing_levels(ctx: Context, t: int, timeframes=("1m", "5m", "15m"), min_level: int = 1) -> list[KeyLevel]:
    """Swing pools and equal highs/lows of ``timeframes`` known by the close of bar ``t``, each
    with the base bar from which it exists (pools already traded through by then are left out)."""
    out = []
    for tf in timeframes:
        p = ctx.htf_pos(tf, t)
        if p < 0:
            continue
        pools = resting_at(ctx.analyses[tf].pools, p)
        pools = pools[(pools["level"] >= min_level) | pools["source"].isin(["eqh", "eql"])]
        for r in pools.itertuples(index=False):
            out.append(KeyLevel(float(r.price), r.side, f"{tf}_{r.source}", ctx.known_from(tf, int(r.created_pos))))
    return out


def raid_levels(ctx: Context, end: int, timeframes=("1m", "5m", "15m"), min_level: int = 1,
                since: int | None = None) -> list[KeyLevel]:
    """Swing pools of ``timeframes`` created before bar ``end`` and still intact at bar ``since``
    (default: one trading day before ``end``): the candidates for a raid search, which itself
    checks that a level was intact when it was raided."""
    since = max(0, end - 1440) if since is None else since
    out = []
    for tf in timeframes:
        p = ctx.htf_pos(tf, end - 1)
        if p < 0:
            continue
        p0 = max(ctx.htf_pos(tf, since), 0)
        pools = ctx.analyses[tf].pools
        tk = pools["taken_pos"].to_numpy()
        keep = (pools["created_pos"].to_numpy() <= p) & ((tk == -1) | (tk >= p0))
        keep &= (pools["level"].to_numpy() >= min_level) | pools["source"].isin(["eqh", "eql"]).to_numpy()
        for r in pools[keep].itertuples(index=False):
            out.append(KeyLevel(float(r.price), r.side, f"{tf}_{r.source}", ctx.known_from(tf, int(r.created_pos))))
    return out


@dataclass(frozen=True)
class Raid:
    level: KeyLevel
    taken_pos: int    # bar that traded through the level
    reclaim_pos: int  # bar that closed back on the original side
    extreme: float    # furthest price reached during the raid


def find_raids(ctx: Context, levels: list[KeyLevel], side: str, start: int, end: int,
               close_within: int = 3) -> list[Raid]:
    """Every raid (wick through a ``side`` level, close back inside within ``close_within``
    bars) completed between bars ``start`` and ``end`` (exclusive), ordered by reclaim bar.
    Each level is searched only from the bar it exists (``known_pos``); a level already traded
    through before the search start is not resting liquidity any more and is skipped."""
    h, lo, c = (ctx.base[k].to_numpy(float) for k in ("high", "low", "close"))
    out: dict[tuple, Raid] = {}
    for lvl in levels:
        if lvl.side != side or lvl.known_pos >= end:
            continue
        s0 = max(start, lvl.known_pos)
        pre = slice(lvl.known_pos, s0)
        if side == SSL and lo[pre].size and lo[pre].min() < lvl.price:
            continue
        if side == BSL and h[pre].size and h[pre].max() > lvl.price:
            continue
        beyond = (lo[s0:end] < lvl.price) if side == SSL else (h[s0:end] > lvl.price)
        if not beyond.any():
            continue
        tk = s0 + int(np.argmax(beyond))
        stop = min(len(c), tk + close_within)
        back = (c[tk:stop] > lvl.price) if side == SSL else (c[tk:stop] < lvl.price)
        if not back.any():
            continue
        rc = tk + int(np.argmax(back))
        if rc >= end:
            continue
        ext = float(lo[tk:rc + 1].min()) if side == SSL else float(h[tk:rc + 1].max())
        key = (round(lvl.price, 10), tk)
        if key not in out:
            out[key] = Raid(lvl, tk, rc, ext)
    return sorted(out.values(), key=lambda r: (r.reclaim_pos, r.taken_pos))


def find_raid(ctx: Context, levels: list[KeyLevel], side: str, start: int, end: int,
              close_within: int = 3) -> Raid | None:
    """The earliest completed raid (see ``find_raids``)."""
    raids = find_raids(ctx, levels, side, start, end, close_within)
    return raids[0] if raids else None


def target_ladder(levels: list[KeyLevel], entry: float, risk: float, direction: int,
                  min_first_rr: float = 1.0, merge_rr: float = 0.25) -> list[KeyLevel]:
    """Liquidity targets in trade direction, nearest first, at least ``min_first_rr`` away,
    with levels closer than ``merge_rr`` x risk to each other merged (the further one kept)."""
    side = BSL if direction == 1 else SSL
    ahead = sorted((l for l in levels if l.side == side and direction * (l.price - entry) >= min_first_rr * risk),
                   key=lambda l: direction * l.price)
    out: list[KeyLevel] = []
    for l in ahead:
        if out and abs(l.price - out[-1].price) < merge_rr * risk:
            out[-1] = l
        else:
            out.append(l)
    return out


def allocate(prices: list[float]) -> list[tuple[float, float]]:
    """Rulebook 5 partials: 50/25/25 for three targets, 50/50 for two, all for one."""
    if not prices:
        return []
    fr = {1: [1.0], 2: [0.5, 0.5]}.get(len(prices), [0.5, 0.25, 0.25])
    return list(zip(prices[:3], fr))



def trend_direction(ctx: Context, t: int, source: str) -> int:
    """Direction a ``trend_filter`` allows at bar ``t``: the last daily ('daily') or 4h ('h4')
    structure break, or 0 for 'none'."""
    if source == "none":
        return 0
    from ..indicators.structure import trend_at
    tf = {"daily": "1d", "h4": "4h"}[source]
    p = ctx.htf_pos(tf, t)
    return trend_at(ctx.analyses[tf].structure, p) if p >= 0 else 0


def po3_matches(ctx: Context, direction: int, t: int) -> bool:
    """Rulebook M8 Power of 3 (A-M-D): before New York, London manipulated against ``direction``
    (raided the Asian range on the opposite side: its low for a buy, its high for a sell)."""
    t = min(t, len(ctx.base) - 1)
    lv = ctx.day_levels(t)
    if lv is None or not np.isfinite(lv["asian_range_low"]):
        return False
    day = pd.Timestamp(ctx.trading_day[t]).date()
    l0, l1 = clock.get_window("london").bounds(day)
    seg = ctx.base[(ctx.base.index >= l0) & (ctx.base.index < min(l1, ctx.base.index[t] + pd.Timedelta(minutes=1)))]
    if seg.empty:
        return False
    if direction == 1:
        return bool(seg["low"].min() < lv["asian_range_low"])
    return bool(seg["high"].max() > lv["asian_range_high"])

