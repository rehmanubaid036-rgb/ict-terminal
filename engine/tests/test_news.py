from datetime import date

import pandas as pd

from ictengine.news import FOMC_DATES, NewsEvent, blackouts, filter_signals, us_high_impact_history
from ictengine.signals import LONG, Signal


def utc(s):
    return pd.Timestamp(s, tz="UTC")


def test_history_has_fomc_and_nfp_at_new_york_times():
    ev = us_high_impact_history(date(2026, 9, 1), date(2026, 9, 30))
    titles = {e.title: e.time for e in ev}
    assert titles["FOMC Statement"] == utc("2026-09-16 18:00")      # 14:00 EDT (journal: FOMC 16 Sep 2026)
    assert titles["Non-Farm Payrolls"] == utc("2026-09-04 12:30")   # first Friday, 08:30 EDT
    winter = us_high_impact_history(date(2026, 1, 1), date(2026, 1, 31))
    assert {e.time for e in winter} == {utc("2026-01-02 13:30"), utc("2026-01-28 19:00")}  # EST


def test_fomc_dates_are_wednesdays_mostly_and_sorted():
    assert FOMC_DATES == sorted(FOMC_DATES)
    assert sum(d.weekday() == 2 for d in FOMC_DATES) >= len(FOMC_DATES) - 1


def test_blackouts_and_filter():
    nfp = NewsEvent(utc("2026-09-04 12:30"), "USD", "High", "Non-Farm Payrolls")
    fomc = NewsEvent(utc("2026-09-16 18:00"), "USD", "High", "FOMC Statement")
    med = NewsEvent(utc("2026-09-10 14:00"), "USD", "Medium", "Speech")
    b = blackouts([nfp, fomc, med])
    assert b == [(utc("2026-09-04 12:15"), utc("2026-09-04 12:45")), (utc("2026-09-16 17:45"), utc("2026-09-16 20:00"))]

    def sig(created, expiry):
        return Signal("t", "XAUUSD", LONG, utc(created), 100, 99, [(102, 1.0)], utc(expiry))
    keep = sig("2026-09-04 14:00", "2026-09-04 14:45")
    drop = sig("2026-09-04 12:00", "2026-09-04 12:20")
    drop_fomc = sig("2026-09-16 19:00", "2026-09-16 19:30")
    assert filter_signals([keep, drop, drop_fomc], b) == [keep]


def test_ff_feed_parse_and_calendar_merge():
    from ictengine import news
    rows = [{"title": "Non-Farm Employment Change", "country": "USD", "date": "2026-10-02T08:30:00-04:00", "impact": "High"},
            {"title": "ECB Speech", "country": "EUR", "date": "2026-10-02T10:00:00-04:00", "impact": "Medium"},
            {"date": "bad"}, {"title": "no date"}]
    live = news.parse_ff(rows)
    assert [e.title for e in live] == ["Non-Farm Employment Change", "ECB Speech"]
    assert live[0].time == pd.Timestamp("2026-10-02 12:30", tz="UTC") and live[0].currency == "USD"
    start, end = pd.Timestamp("2026-09-01", tz="UTC"), pd.Timestamp("2026-10-31", tz="UTC")
    high = news.calendar(start, end, ("High",), live)
    assert [e.title for e in high if e.time.month == 9] == ["Non-Farm Payrolls", "FOMC Statement"]
    # the feed's NFP and the rebuilt one are the same event at the same time
    assert sum(e.time == live[0].time for e in high) == 1
    assert any(e.title == "ECB Speech" for e in news.calendar(start, end, ("High", "Medium"), live))


def test_ff_week_caches_and_survives_failures(monkeypatch):
    from ictengine import news
    monkeypatch.setattr(news, "_ff_cache", {"at": 0.0, "events": []})
    calls = []
    assert news.ff_week(fetch=lambda: calls.append(1) or [{"title": "CPI", "country": "USD", "date": "2026-10-14T08:30:00-04:00", "impact": "High"}])[0].title == "CPI"
    assert news.ff_week(fetch=lambda: calls.append(1) or []) and len(calls) == 1     # cached
    monkeypatch.setattr(news, "_ff_cache", {"at": 0.0, "events": []})
    assert news.ff_week(fetch=lambda: (_ for _ in ()).throw(OSError("down"))) == []
