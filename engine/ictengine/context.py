"""Multi-timeframe market context for one symbol, with strict as-of alignment.

The base frame is 1m. Higher timeframes are resampled from it and analysed separately.
``htf_pos(tf, t)`` gives the last *closed* higher-timeframe bar at the close of base bar ``t``,
so a model running on bar ``t`` can never see a 15m candle that is still forming.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .analysis import Analysis, Params, analyze
from .core import clock
from .core.candles import TIMEFRAMES, bucket_labels, resample, validate
from .core.levels import daily_levels
from .indicators.common import epoch_ns
from .indicators.pd_array import ipda_ranges
from .symbols import SymbolSpec, spec

BASE_TF = "1m"
_WALL_CLOCK = {"2h", "4h", "1d", "1w"}


def bar_close_times(labels: pd.DatetimeIndex, timeframe: str) -> np.ndarray:
    """Nominal close time (UTC, int64 ns) of bars opening at ``labels``. 4h/1d/1w bars end on the
    New York wall clock, so a trading day that contains a DST switch is 23 or 25 hours long."""
    step = TIMEFRAMES[timeframe]
    if timeframe not in _WALL_CLOCK:
        return epoch_ns(labels + step)
    local = labels.tz_convert(clock.NY).tz_localize(None) + step
    return epoch_ns(local.tz_localize(clock.NY, nonexistent="shift_forward", ambiguous=False).tz_convert("UTC"))


@dataclass
class Context:
    symbol: str
    base: pd.DataFrame
    timeframes: tuple[str, ...] = ("5m", "15m", "1h", "4h", "1d")
    params: dict[str, Params] = field(default_factory=dict)
    partner: pd.DataFrame | None = None   # correlated instrument for SMT (e.g. XAGUSD for XAUUSD)

    def __post_init__(self):
        validate(self.base)
        self.spec: SymbolSpec = spec(self.symbol)
        self.partner_aligned: pd.DataFrame | None = None
        if self.partner is not None:
            validate(self.partner)
            # forward-fill only carries *past* partner bars onto our timestamps (no look-ahead)
            self.partner_aligned = self.partner[["high", "low", "close"]].reindex(self.base.index, method="ffill")
        self.frames: dict[str, pd.DataFrame] = {BASE_TF: self.base}
        self.analyses: dict[str, Analysis] = {}
        self._asof: dict[str, np.ndarray] = {}
        base_close = epoch_ns(self.base.index) + TIMEFRAMES[BASE_TF].value
        for tf in (BASE_TF,) + tuple(self.timeframes):
            frame = self.base if tf == BASE_TF else resample(self.base, tf).drop(columns="n_bars")
            self.frames[tf] = frame
            p = self.params.get(tf) or Params.for_timeframe(tf, fvg_min_size=self.spec.min_fvg)
            self.analyses[tf] = analyze(frame, p)
            if tf == BASE_TF:
                self._asof[tf] = np.arange(len(frame))
                continue
            closes = bar_close_times(frame.index, tf)
            # a bucket is also complete once the first base bar of the next bucket exists
            nxt = np.r_[epoch_ns(frame.index)[1:], np.iinfo(np.int64).max]
            closes = np.minimum(closes, nxt)
            self._asof[tf] = np.searchsorted(closes, base_close, side="right") - 1
        self.levels = daily_levels(self.base)
        self.ipda = ipda_ranges(self.levels)
        self.trading_day = clock.trading_days(self.base.index)
        self.minute = clock.minute_of_day(self.base.index)

    # ---- lookups -----------------------------------------------------------------------
    def htf_pos(self, timeframe: str, t: int) -> int:
        """Last closed ``timeframe`` bar at the close of base bar ``t`` (-1 if none yet)."""
        return int(self._asof[timeframe][t])

    def known_from(self, timeframe: str, htf_pos: int) -> int:
        """First base bar at which ``timeframe`` bar ``htf_pos`` has closed and can be used."""
        return int(np.searchsorted(self._asof[timeframe], htf_pos, side="left")) + 1

    def pos_of(self, ts: pd.Timestamp) -> int:
        """First base bar at or after ``ts``."""
        return int(self.base.index.searchsorted(ts))

    def day_levels(self, t: int) -> pd.Series | None:
        day = pd.Timestamp(self.trading_day[t])
        return self.levels.loc[day] if day in self.levels.index else None

    def price(self, t: int) -> float:
        return float(self.base["close"].iloc[t])

    def bucket(self, timeframe: str, t: int) -> pd.Timestamp:
        return bucket_labels(self.base.index[t:t + 1], timeframe)[0]
