import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))

from ictapi.main import create_app  # noqa: E402
from ictapi.market import FrameProvider  # noqa: E402
from ictengine.data.dukascopy import parse_bi5  # noqa: E402

DATA = ROOT / "engine" / "tests" / "data"


@pytest.fixture(scope="session")
def gold():
    days = [date(2026, 9, 2), date(2026, 9, 3)]
    return pd.concat([parse_bi5((DATA / f"XAUUSD_{d}_BID.bi5").read_bytes(), d, 1000) for d in days])


@pytest.fixture(scope="session")
def store(tmp_path_factory):
    from ictengine.store import Store
    return Store(tmp_path_factory.mktemp("db") / "api.db")


@pytest.fixture(scope="session")
def client(gold, store):
    return TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold}), store, require_auth=False))


def ts(s):
    return int(pd.Timestamp(s, tz="UTC").timestamp())
