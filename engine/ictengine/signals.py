"""The Signal every model emits (and the EA / chart / AI agent consume)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import pandas as pd

LONG, SHORT = 1, -1


@dataclass
class Signal:
    model: str                 # e.g. "M1_silver_bullet"
    symbol: str
    direction: int             # LONG / SHORT
    created_time: pd.Timestamp  # open time of the bar that completed the setup; the order is live after it closes
    entry: float               # limit price
    stop: float
    targets: list[tuple[float, float]]  # [(price, fraction of position)], fractions sum to 1
    expiry: pd.Timestamp       # pending order cancelled if not filled by then
    time_stop: pd.Timestamp | None = None  # close everything if TP1 not reached by then
    exit_by: pd.Timestamp | None = None    # hard flat time for any remainder
    window: str = ""
    grade: str = ""
    score: int = 0
    checklist: dict[str, bool] = field(default_factory=dict)
    notes: dict[str, object] = field(default_factory=dict)

    def __post_init__(self):
        if self.direction not in (LONG, SHORT):
            raise ValueError("direction must be LONG (1) or SHORT (-1)")
        if not self.targets:
            raise ValueError("a signal needs at least one target")
        if abs(sum(f for _, f in self.targets) - 1.0) > 1e-9:
            raise ValueError("target fractions must sum to 1")
        d = self.direction
        if not (d * (self.entry - self.stop) > 0):
            raise ValueError(f"stop {self.stop} is on the wrong side of entry {self.entry}")
        prev = self.entry
        for price, _ in self.targets:
            if not d * (price - prev) > 0:
                raise ValueError("targets must move away from entry in trade direction, in order")
            prev = price

    @property
    def risk(self) -> float:
        return abs(self.entry - self.stop)

    def rr(self, k: int = -1) -> float:
        """Reward:risk to target ``k`` (default: final target)."""
        return abs(self.targets[k][0] - self.entry) / self.risk

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("created_time", "expiry", "time_stop", "exit_by"):
            if d[k] is not None:
                d[k] = pd.Timestamp(d[k]).isoformat()
        return d
