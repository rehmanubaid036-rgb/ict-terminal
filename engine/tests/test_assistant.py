from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from ictengine.assistant import ask, detect_intent, safe_question
from ictengine.context import Context
from ictengine.data.dukascopy import parse_bi5

DATA = Path(__file__).parent / "data"


@pytest.fixture(scope="module")
def ctx():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    df = pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])
    return Context("XAUUSD", df.loc[:"2026-09-03 14:30"])  # 10:30 NY on the journal day


@pytest.mark.parametrize("q, intent", [
    ("what is the bias?", "bias"), ("aaj ka rukh kya hai", "bias"), ("show levels", "levels"),
    ("liquidity kahan hai?", "liquidity"), ("any BSL above?", "liquidity"), ("FVG", "fvg"),
    ("koi setup hai?", "signals"), ("killzone kab hai", "session"), ("help", "help"), ("hello", "unknown"),
])
def test_intents(q, intent):
    assert detect_intent(q) == intent


def test_session_answer_on_journal_day(ctx):
    a = ask(ctx, "session?")
    assert "10:30" in a.text and a.data["session"] == "ny_am"
    assert "ny_am_sb" in a.data["windows"]
    assert "NY PM Silver Bullet" in a.text  # next window after 10:30 is 14:00


def test_levels_and_liquidity_are_real_numbers(ctx):
    lv = ask(ctx, "levels").data["levels"]
    assert lv["Midnight Open"] == pytest.approx(4431.12, abs=0.01)
    liq = ask(ctx, "where is liquidity").data
    assert all(p > liq["price"] for p, _ in liq["bsl"]) and all(p < liq["price"] for p, _ in liq["ssl"])
    assert liq["bsl"] and liq["ssl"]


def test_fvg_bias_and_roman_urdu(ctx):
    f = ask(ctx, "fvg", fvg_tf="5m").data["fvgs"]
    assert all(x["top"] > x["bottom"] for x in f)
    b = ask(ctx, "bias kya hai", lang="ur")
    assert "daily bias" in b.text and set(b.data["components"]) == {"daily_structure", "h4_structure", "ipda_zone", "pd_reaction", "mo_zone"}
    assert ask(ctx, "xyz", lang="ur").text.startswith("Samajh nahi")


def test_signals_answer_uses_given_signals(ctx):
    assert ask(ctx, "signals").data["signals"] == []
    s = {"model_id": "M1", "direction": 1, "grade": "A", "entry": 4470.68, "stop": 4461.0, "targets": [[4495.89, 1.0]]}
    a = ask(ctx, "any setup?", signals=[s])
    assert "M1 LONG A entry 4,470.68" in a.text


def test_signals_answer_tells_the_time_newest_first(ctx):
    end = ctx.base.index[-1]
    old = {"model_id": "M1", "direction": 1, "grade": "A", "entry": 1.0, "stop": 0.5, "targets": [[2.0, 1.0]],
           "created_time": (end - pd.Timedelta(hours=5)).isoformat()}
    new = {**old, "model_id": "M9", "direction": -1, "created_time": (end - pd.Timedelta(minutes=30)).isoformat()}
    text = ask(ctx, "signals", signals=[old, new]).text
    ny = (end - pd.Timedelta(minutes=30)).tz_convert("America/New_York").strftime("%d %b %H:%M")
    assert f"{ny} NY (30m ago) M9 SHORT" in text and "(5h ago) M1 LONG" in text
    assert text.index("M9") < text.index("M1 LONG")                     # newest first
    ur = ask(ctx, "signals", signals=[new], lang="ur").text
    assert "NY (30m ago)" in ur


def test_safe_question():
    assert safe_question("  hi\x00there\n" + "x" * 500) == ("hi there " + "x" * 500)[:300].strip()


def test_liquidity_levels_are_unique(ctx):
    liq = ask(ctx, "liquidity").data
    for side in ("bsl", "ssl"):
        prices = [p for p, _ in liq[side]]
        assert len(prices) == len(set(prices))
