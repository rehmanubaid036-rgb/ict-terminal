from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from ictengine.data.dukascopy import parse_bi5
from ictengine.runner import RunnerConfig, run_once
from ictengine.signals import LONG, SHORT, Signal
from ictengine.store import Store

DATA = Path(__file__).parent / "data"


def utc(s):
    return pd.Timestamp(s, tz="UTC")


def sig(t="2026-09-03 14:10", entry=100.0, direction=LONG):
    stop = entry - 1 if direction == LONG else entry + 1
    tgt = entry + 2 if direction == LONG else entry - 2
    return Signal("M1_silver_bullet", "XAUUSD", direction, utc(t), entry, stop, [(tgt, 1.0)], utc(t) + pd.Timedelta(minutes=30),
                  window="ny_am_sb", grade="A", score=11)


def test_upsert_is_idempotent_and_updates(tmp_path):
    st = Store(tmp_path / "t.db")
    assert st.upsert_signals("XAUUSD", "M1", [sig(), sig("2026-09-03 15:00", 101, SHORT)], True) == 2
    st.upsert_signals("XAUUSD", "M1", [sig()], True)  # same signal again -> no duplicate
    rows = st.signals("XAUUSD", utc("2026-09-03"), utc("2026-09-04"))
    assert len(rows) == 2 and rows[0]["model_id"] == "M1" and rows[0]["entry"] == 100.0
    changed = sig()
    changed.grade = "A+"
    st.upsert_signals("XAUUSD", "M1", [changed], True)
    assert st.signals("XAUUSD", utc("2026-09-03"), utc("2026-09-04"))[0]["grade"] == "A+"


def test_queries_filter_by_symbol_model_time_and_bias(tmp_path):
    st = Store(tmp_path / "t.db")
    st.upsert_signals("XAUUSD", "M1", [sig()], True)
    st.upsert_signals("XAUUSD", "M2", [sig("2026-09-03 16:00")], True)
    st.upsert_signals("XAUUSD", "M1", [sig("2026-09-03 17:00")], False)
    st.upsert_signals("NAS100", "M1", [sig()], True)
    assert len(st.signals("XAUUSD", utc("2026-09-03"), utc("2026-09-04"))) == 2
    assert len(st.signals("XAUUSD", utc("2026-09-03"), utc("2026-09-04"), ["M2"])) == 1
    assert len(st.signals("XAUUSD", utc("2026-09-03"), utc("2026-09-04"), bias_filter=False)) == 1
    assert st.signals("XAUUSD", utc("2026-09-04"), utc("2026-09-05")) == []


@pytest.fixture(scope="module")
def gold():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    return pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])


def test_runner_pass_stores_signals_and_status(tmp_path, gold):
    st = Store(tmp_path / "r.db")

    def load(symbol, start, end):
        if symbol != "XAUUSD":
            raise RuntimeError("feed down")  # other symbols fail: the pass must continue
        return gold[(gold.index >= start) & (gold.index < end)]

    cfg = RunnerConfig(symbols=("XAUUSD", "NAS100"), models=("M1", "M2"), lookback_days=5, keep_days=5, partners={})
    out = run_once(st, load, cfg, now=utc("2026-09-04 00:00"))
    assert out["XAUUSD"] > 0 and out["NAS100"] == -1
    status = {s["symbol"]: s for s in st.status()}
    assert status["XAUUSD"]["error"] is None and status["XAUUSD"]["signals"] == out["XAUUSD"]
    assert "feed down" in status["NAS100"]["error"]
    rows = st.signals("XAUUSD", utc("2026-09-01"), utc("2026-09-05"), bias_filter=False)
    assert rows and {r["model_id"] for r in rows} <= {"M1", "M2"}
    # a second pass over the same data does not duplicate anything
    run_once(st, load, cfg, now=utc("2026-09-04 00:00"))
    assert len(st.signals("XAUUSD", utc("2026-09-01"), utc("2026-09-05"), bias_filter=False)) == len(rows)


def test_layouts_per_user(tmp_path):
    from ictengine.store import LayoutError, MAX_LAYOUTS, Store
    s = Store(tmp_path / "l.db")
    ws = {"layout": 2, "charts": [{"ticker": "AXI:XAUUSD", "tf": "5m", "ict": ["fvg"]}]}
    s.save_layout("a@x.com", "Gold 5m", ws)
    s.save_layout("b@x.com", "Gold 5m", {"layout": 1})
    assert s.layout("a@x.com", "Gold 5m")["data"] == ws
    assert s.layout("b@x.com", "Gold 5m")["data"] == {"layout": 1}       # users never see each other's
    assert s.layout("a@x.com", "nope") is None
    s.save_layout("a@x.com", "Gold 5m", {"layout": 4})                     # replace keeps one row
    assert [r["name"] for r in s.layouts("a@x.com")] == ["Gold 5m"] and s.layout("a@x.com", "Gold 5m")["data"] == {"layout": 4}
    assert s.delete_layout("a@x.com", "Gold 5m") and not s.delete_layout("a@x.com", "Gold 5m")
    assert s.layouts("a@x.com") == []


def test_layout_limits(tmp_path):
    from ictengine.store import LayoutError, MAX_LAYOUTS, Store
    s = Store(tmp_path / "l.db")
    for bad in ("", "   ", "x" * 61):
        with pytest.raises(LayoutError):
            s.save_layout("a@x.com", bad, {})
    with pytest.raises(LayoutError):
        s.save_layout("a@x.com", "big", {"d": "x" * 300_000})
    for i in range(MAX_LAYOUTS):
        s.save_layout("a@x.com", f"L{i}", {"i": i})
    with pytest.raises(LayoutError):
        s.save_layout("a@x.com", "one too many", {})
    s.save_layout("a@x.com", "L0", {"i": "updated"})                       # replacing is fine at the limit


def test_screener_row_on_the_journal_day(tmp_path):
    from datetime import date
    from pathlib import Path

    import pandas as pd

    from ictengine.context import Context
    from ictengine.data.dukascopy import parse_bi5
    from ictengine.screener import screener_row
    from ictengine.store import Store

    data = Path(__file__).parent / "data"
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    df = pd.concat([parse_bi5((data / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])
    ctx = Context("XAUUSD", df.loc[:"2026-09-03 14:30"])
    row = screener_row(ctx)
    assert row["symbol"] == "XAUUSD" and row["bias"] in (-1, 0, 1)
    assert row["midnight_open"] == pytest.approx(4431.12, abs=0.01)
    assert row["above_mo"] == (row["price"] > row["midnight_open"])
    assert isinstance(row["windows"], list) and isinstance(row["swept_pdh"], bool)
    for k in ("fvg_15m", "fvg_1h"):
        assert row[k] is None or row[k]["bottom"] < row[k]["top"]
    st = Store(tmp_path / "s.db")
    st.set_screener("XAUUSD", row)
    assert st.screener()[0]["symbol"] == "XAUUSD"
