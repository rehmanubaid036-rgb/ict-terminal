import pandas as pd
import pytest
from conftest import ts


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_udf_config_and_search(client):
    cfg = client.get("/udf/config").json()
    assert "1" in cfg["supported_resolutions"] and cfg["supports_search"]
    res = client.get("/udf/search", params={"query": "xau"}).json()
    assert [r["symbol"] for r in res] == ["AXI:XAUUSD"]
    sym = client.get("/udf/symbols", params={"symbol": "AXI:XAUUSD"}).json()
    assert sym["pricescale"] == 100 and sym["timezone"] == "America/New_York"
    assert client.get("/udf/symbols", params={"symbol": "FOO:BAR"}).status_code == 404


def test_udf_history_1m_matches_source(client, gold):
    r = client.get("/udf/history", params={"symbol": "AXI:XAUUSD", "resolution": "1",
                                           "from": ts("2026-09-03 14:00"), "to": ts("2026-09-03 14:05")}).json()
    assert r["s"] == "ok" and len(r["t"]) == 5
    assert r["t"][0] == ts("2026-09-03 14:00")
    bar = gold.loc["2026-09-03 14:00"]
    assert (r["o"][0], r["h"][0], r["l"][0], r["c"][0]) == (bar.open, bar.high, bar.low, bar.close)


def test_udf_history_resampled_and_errors(client):
    r = client.get("/udf/history", params={"symbol": "AXI:XAUUSD", "resolution": "15",
                                           "from": ts("2026-09-03 13:00"), "to": ts("2026-09-03 15:00")}).json()
    assert r["s"] == "ok" and len(r["t"]) == 8 and all(b - a == 900 for a, b in zip(r["t"], r["t"][1:]))
    assert client.get("/udf/history", params={"symbol": "AXI:XAUUSD", "resolution": "7",
                                              "from": 0, "to": 10}).status_code == 400
    empty = client.get("/udf/history", params={"symbol": "AXI:XAUUSD", "resolution": "1",
                                               "from": ts("2020-01-01"), "to": ts("2020-01-02")}).json()
    assert empty == {"s": "no_data"}


def test_overlays(client):
    r = client.get("/api/v1/ict/overlays", params={"symbol": "AXI:XAUUSD", "resolution": "1",
                                                   "from": ts("2026-09-03 13:30"), "to": ts("2026-09-03 15:00"),
                                                   "indicators": "fvg,liquidity"}).json()
    kinds = {o["kind"] for o in r["objects"]}
    assert kinds == {"fvg", "liquidity"}
    # the journal's 10:13 NY bullish FVG (4465.975-4466.415) is drawn
    assert any(o["kind"] == "fvg" and o["bottom"] == 4465.975 and o["top"] == 4466.415 for o in r["objects"])
    bad = client.get("/api/v1/ict/overlays", params={"symbol": "AXI:XAUUSD", "resolution": "1", "from": 0,
                                                     "to": 10, "indicators": "magic"})
    assert bad.status_code == 400


def test_models_and_signals(client):
    ms = client.get("/api/v1/models").json()
    assert {m["id"] for m in ms} >= {"M1", "M2", "M3", "M4"}
    r = client.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": ts("2026-09-03 00:00"),
                                              "to": ts("2026-09-04 00:00"), "models": "M1",
                                              "require_bias": "false", "source": "scan"}).json()
    assert r["source"] == "scan"
    assert r["signals"] and all(s["model_id"] == "M1" for s in r["signals"])
    s = r["signals"][0]
    assert {"entry", "stop", "targets", "expiry", "grade", "checklist"} <= set(s)
    # a removed model (still named in an old saved layout) is skipped, not an error
    gone = client.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": 0, "to": 10, "models": "M99"})
    assert gone.status_code == 200 and gone.json()["signals"] == []


def test_signals_from_store_and_engine_status(client, store):
    import pandas as pd
    from ictengine.signals import LONG, Signal
    t = pd.Timestamp("2026-09-03 14:10", tz="UTC")
    s = Signal("M1_silver_bullet", "XAUUSD", LONG, t, 4470.0, 4461.0, [(4495.0, 1.0)], t + pd.Timedelta(minutes=35))
    store.upsert_signals("XAUUSD", "M1", [s], True)
    store.set_status("XAUUSD", "2026-09-03 21:59", 1, 4.2)
    r = client.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": ts("2026-09-03 00:00"),
                                              "to": ts("2026-09-04 00:00"), "models": "M1"}).json()
    assert r["source"] == "store" and len(r["signals"]) == 1 and r["signals"][0]["entry"] == 4470.0
    st = client.get("/api/v1/engine/status").json()["symbols"]
    assert st[0]["symbol"] == "XAUUSD" and st[0]["signals"] == 1
    assert client.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": 0, "to": 10,
                                                 "source": "magic"}).status_code == 400


ALL_LAYERS = ("fvg,liquidity,structure,order_blocks,pd_ote,displacement,sessions,key_levels,quarters,"
              "projections,opening_gaps,ipda,smt,bias")


def test_overlays_all_ict_layers(client):
    r = client.get("/api/v1/ict/overlays", params={"symbol": "AXI:XAUUSD", "resolution": "5",
                                                   "from": ts("2026-09-02 23:00"), "to": ts("2026-09-03 18:00"),
                                                   "indicators": ALL_LAYERS})
    assert r.status_code == 200
    objs = r.json()["objects"]
    kinds = {o["kind"] for o in objs}
    for k in ("fvg", "dealing_range", "session", "killzone", "silver_bullet", "macro", "key_level",
              "quarter", "true_open", "range", "projection", "bias"):
        assert k in kinds, k
    assert "smt" not in kinds                         # no silver data in this test feed
    sb = [o for o in objs if o["kind"] == "silver_bullet" and o["key"] == "ny_am_sb"]
    assert sb and all(o["top"] >= o["bottom"] for o in sb)
    panel = [o for o in objs if o["kind"] == "bias"][0]
    assert panel["direction"] in (-1, 0, 1) and "components" in panel


def test_session_layers_skip_daily_charts(client):
    r = client.get("/api/v1/ict/overlays", params={"symbol": "AXI:XAUUSD", "resolution": "1D",
                                                   "from": ts("2026-08-01"), "to": ts("2026-09-04"),
                                                   "indicators": "sessions,quarters,projections"}).json()
    assert r["objects"] == []


def test_smt_needs_the_partner_symbol(gold, store):
    import numpy as np
    from fastapi.testclient import TestClient
    from ictapi.main import create_app
    from ictapi.market import FrameProvider
    rng = np.random.default_rng(1)
    silver = gold.copy()
    wobble = 1 + np.cumsum(rng.normal(0, 0.0004, len(gold)))   # silver drifts apart from gold
    for c in ("open", "high", "low", "close"):
        silver[c] = gold[c] / 80 * wobble
    silver["high"] = silver[["open", "high", "close"]].max(axis=1)
    silver["low"] = silver[["open", "low", "close"]].min(axis=1)
    c = TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold, "AXI:XAGUSD": silver}), store, require_auth=False))
    r = c.get("/api/v1/ict/overlays", params={"symbol": "AXI:XAUUSD", "resolution": "1",
                                              "from": ts("2026-09-03 12:00"), "to": ts("2026-09-03 16:00"),
                                              "indicators": "smt"}).json()
    marks = r["objects"]
    assert marks and {o["kind"] for o in marks} == {"smt"} and {o["direction"] for o in marks} <= {-1, 1}


def test_quotes_for_the_watchlist(client, gold):
    r = client.get("/api/v1/quotes", params={"symbols": "AXI:XAUUSD,AXI:NAS100,FOO:BAR"}).json()["quotes"]
    by = {q["symbol"]: q for q in r}
    assert set(by) == {"AXI:XAUUSD", "AXI:NAS100"}                          # unknown symbols skipped
    assert by["AXI:NAS100"]["price"] is None                                 # no data in this feed: blank row
    # test data ends 2026-09-03, so "now" sees no bars either; the shape is what matters here
    assert set(by["AXI:XAUUSD"]) >= {"price", "change", "change_pct"}


def test_quote_change_is_against_the_previous_daily_close(store):
    import numpy as np
    from fastapi.testclient import TestClient
    from ictapi.main import create_app
    from ictapi.market import FrameProvider
    end = pd.Timestamp.now(tz="UTC").floor("min")
    idx = pd.date_range(end - pd.Timedelta(days=4), end, freq="1min", tz="UTC")
    price = np.linspace(100, 110, len(idx))
    df = pd.DataFrame({"open": price, "high": price + 0.1, "low": price - 0.1, "close": price, "volume": 1.0}, index=idx)
    c = TestClient(create_app(FrameProvider({"AXI:XAUUSD": df}), store, require_auth=False))
    q = c.get("/api/v1/quotes", params={"symbols": "axi:xauusd"}).json()["quotes"][0]
    assert q["price"] == pytest.approx(110.0)
    assert q["change"] > 0 and q["change_pct"] == pytest.approx(q["change"] / (q["price"] - q["change"]) * 100)


def test_calendar_events(client, monkeypatch):
    import ictapi.main as m
    monkeypatch.setattr(m, "ff_week", lambda: [])
    frm, to = int(pd.Timestamp("2026-09-01", tz="UTC").timestamp()), int(pd.Timestamp("2026-09-30", tz="UTC").timestamp())
    r = client.get("/api/v1/calendar", params={"from": frm, "to": to})
    assert r.status_code == 200
    ev = r.json()["events"]
    assert [e["title"] for e in ev] == ["Non-Farm Payrolls", "FOMC Statement"]
    assert ev[1]["time"] == int(pd.Timestamp("2026-09-16 18:00", tz="UTC").timestamp()) and ev[1]["currency"] == "USD"


def test_signals_tell_if_the_runner_covers_the_symbol(client):
    frm, to = int(pd.Timestamp("2026-09-02", tz="UTC").timestamp()), int(pd.Timestamp("2026-09-04", tz="UTC").timestamp())
    r = client.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": frm, "to": to, "models": "M1"})
    assert r.status_code == 200 and r.json()["covered"] in (True, False)
    p = {"symbol": "AXI:XAUUSD", "from": frm, "to": to, "models": "M1", "source": "scan", "require_bias": "false"}
    a, b = client.get("/api/v1/signals", params=p).json(), client.get("/api/v1/signals", params=p).json()
    assert a["source"] == "scan" and a["signals"] == b["signals"]          # the second answer comes from the cache
