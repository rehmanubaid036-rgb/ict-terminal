"""M17 Wolf Asia model, checked on the PDF's own example (ICT, NQ, Thu 8 Aug 2024) rebuilt bar by bar."""
import numpy as np
import pandas as pd
import pytest

from ictengine.context import Context
from ictengine.models import wolf_asia as wa

NY = "America/New_York"
EVENING = pd.Timestamp("2024-08-08 18:00", tz=NY)


def _bars(points: list[tuple[str, float, float, float, float]]) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(t, tz=NY).tz_convert("UTC") for t, *_ in points])
    return pd.DataFrame([p[1:] for p in points], index=idx, columns=["open", "high", "low", "close"]).assign(volume=1.0)


def _walk(start: str, prices: list[float], wick: float = 0.5) -> list[tuple]:
    """One bar per minute from ``start`` (NY), each from the previous price to the next one."""
    t0 = pd.Timestamp(start)
    out = []
    for k in range(len(prices) - 1):
        o, c = prices[k], prices[k + 1]
        out.append(((t0 + pd.Timedelta(minutes=k)).strftime("%Y-%m-%d %H:%M"), o, max(o, c) + wick, min(o, c) - wick, c))
    return out


def ict_example() -> pd.DataFrame:
    rng = np.random.default_rng(3)
    # three quiet days before, so the daily bias and levels have data
    days = pd.date_range(pd.Timestamp("2024-08-05 09:00", tz=NY), pd.Timestamp("2024-08-08 16:59", tz=NY), freq="1min")
    days = days[(days.hour < 17) | (days.hour >= 18)]
    close = 18560 + np.cumsum(rng.normal(0, 1.0, len(days)))
    close += 18558 - close[-1]                                    # 16:59 close = 18558 (NDOG high)
    open_ = np.r_[close[0], close[:-1]]
    pre = pd.DataFrame({"open": open_, "high": np.maximum(open_, close) + 0.5, "low": np.minimum(open_, close) - 0.5,
                        "close": close, "volume": 1.0}, index=days.tz_convert("UTC"))
    rows = []
    rows += _walk("2024-08-08 18:00", [18550, 18566, 18578, 18570, 18562])                 # gap down open, initial BSL 18578.5
    rows += _walk("2024-08-08 18:04", [18562, 18555, 18548, 18542, 18537, 18533, 18531, 18530, 18533, 18536, 18540])  # initial SSL
    rows += _walk("2024-08-08 18:14", [18540, 18542, 18541, 18545, 18548, 18552, 18556, 18560, 18562, 18564, 18565.25,
                                       18563, 18560, 18556, 18553, 18552, 18550, 18549, 18548])   # 18:24 high 18565.75
    rows += _walk("2024-08-08 18:32", [18548, 18546, 18544, 18543, 18541, 18540, 18539, 18538, 18540, 18541.5, 18539,
                                       18537, 18536, 18536.5, 18538, 18537, 18539, 18538, 18540, 18539, 18538])
    # 18:52 the low (wick to 18534), MSS level = the 18:49 swing high 18540.5
    rows += [("2024-08-08 18:52", 18538, 18538.5, 18534, 18536), ("2024-08-08 18:53", 18536, 18538, 18535.5, 18537.5)]
    rows += _walk("2024-08-08 18:54", [18537.5, 18538, 18537, 18538.5, 18538, 18539, 18538.5])
    # 19:00 the algorithm comes online: displacement through the MSS level, BISI 18540 - 18546
    rows += [("2024-08-08 19:00", 18538.5, 18548, 18537.5, 18547), ("2024-08-08 19:01", 18547, 18562, 18546, 18561)]
    rows += _walk("2024-08-08 19:02", [18561, 18566, 18570, 18578, 18590, 18598, 18604, 18608, 18606, 18607.5, 18614,
                                       18610, 18600, 18596, 18590, 18585, 18580, 18575, 18570])
    rows += _walk("2024-08-08 19:20", list(np.linspace(18570, 18560, 120)))
    return pd.concat([pre, _bars(rows)]).sort_index()


@pytest.fixture(scope="module")
def sig():
    ctx = Context("NAS100", ict_example())
    out = [s for s in wa.scan(ctx) if s.direction == 1 and s.created_time >= EVENING]
    assert len(out) == 1
    return out[0]


def test_ndog_and_initial_liquidity(sig):
    n = sig.notes
    assert (n["ndog"]["low"], n["ndog"]["high"], n["ndog"]["ce"]) == (18550, 18558, 18554)
    assert n["ndog"]["significant"] is False                    # 8 handles: under 20
    assert n["initial_bsl"] == 18578.5 and n["initial_ssl"] == 18529.5


def test_entry_stop_and_sd_targets_follow_the_pdf(sig):
    n = sig.notes
    assert n["mss_level"] == 18540.5 and "19:00" in pd.Timestamp(n["mss_time"]).tz_convert(NY).strftime("%H:%M")
    assert sig.entry == pytest.approx((18539.5 + 18546) / 2)     # CE of the BISI (18:59 high - 19:01 low)
    assert sig.stop == pytest.approx((18534 + 18536) / 2)        # "Wick C.E" of the low candle (no spread: not in the PDF)
    # PDF: the last opposite leg 18565.75 -> 18534, targets at -1 / -1.25 / -1.5 SD, half at -1
    assert n["fib"]["0"] == 18565.75 and n["fib"]["1"] == 18534
    assert [round(p, 4) for p, _ in sig.targets] == [18597.5, 18605.4375, 18613.375]
    assert [f for _, f in sig.targets] == [0.5, 0.25, 0.25]


def test_time_first_window(sig):
    created = sig.created_time.tz_convert(NY)
    assert created.strftime("%H:%M") == "19:01"
    assert sig.expiry.tz_convert(NY).strftime("%H:%M") == "21:00"


def test_no_trade_outside_the_window():
    df = ict_example()
    late = df.copy()
    # the same pattern two and a half hours later is after 21:00: no setup
    cut = pd.Timestamp("2024-08-08 18:00", tz=NY).tz_convert("UTC")
    body = late[late.index >= cut]
    shifted = body.copy()
    shifted.index = shifted.index + pd.Timedelta(minutes=150)
    flat = late[late.index < cut]
    filler_idx = pd.date_range(cut, cut + pd.Timedelta(minutes=149), freq="1min")
    filler = pd.DataFrame({"open": 18555.0, "high": 18555.5, "low": 18554.5, "close": 18555.0, "volume": 1.0}, index=filler_idx)
    ctx = Context("NAS100", pd.concat([flat, filler, shifted]).sort_index())
    assert [s for s in wa.scan(ctx) if s.direction == 1 and s.created_time >= EVENING] == []


def test_only_the_pdf_markets():
    assert wa.scan(Context("XAUUSD", ict_example())) == []


def test_nothing_the_pdf_does_not_have(sig):
    """Rebuilt from the PDF only: no time exit, no daily bias, the stop is the Wick C.E itself."""
    assert sig.exit_by is None
    assert "with_daily_bias" not in sig.checklist and "bias_score" not in sig.notes
    assert set(wa.WolfConfig().__dataclass_fields__) == {"window_start", "window_end", "ndog_handles", "sd_targets", "sd_split", "symbols"}


def test_20_handles_and_breakaway_stop():
    """p.1 over 20 handles marks the NDOG CE; p.2 a breakaway move through it puts the stop at that CE."""
    df = ict_example()
    t18 = pd.Timestamp("2024-08-08 18:00", tz=NY).tz_convert("UTC")
    before = df.index[df.index < t18 - pd.Timedelta(hours=1)][-1]
    df.loc[before, "close"] = 18520.0                       # 16:59 close 18520, 18:00 open 18550: a 30-handle NDOG
    df.loc[before, "low"] = min(df.loc[before, "low"], 18520.0)
    s = [x for x in wa.scan(Context("NAS100", df)) if x.direction == 1 and x.created_time >= EVENING]
    assert len(s) == 1
    n = s[0].notes
    assert n["ndog"]["significant"] is True and n["ndog"]["ce"] == 18535.0
    # the low (18534) is under the NDOG high (18550) but the MSS candle closes at 18547: not through the gap
    assert n["stop_mode"] == "wick_ce"
    assert s[0].checklist["ndog_over_20_handles"] is True
