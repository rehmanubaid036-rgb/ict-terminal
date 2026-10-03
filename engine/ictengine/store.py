"""SQLite store for engine output (signals now; alerts, journal and EA state later).

One file (``data/ict.db`` by default) shared by the engine runner (writer) and the API (reader).
A signal's identity is (symbol, model, created_time, direction, entry), so re-running the
scanner over overlapping data updates rows instead of duplicating them.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

from .signals import Signal

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "ict.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT NOT NULL,
    model        TEXT NOT NULL,
    model_id     TEXT NOT NULL,
    direction    INTEGER NOT NULL,
    created_time TEXT NOT NULL,           -- ISO UTC
    entry        REAL NOT NULL,
    stop         REAL NOT NULL,
    targets      TEXT NOT NULL,           -- JSON [[price, fraction], ...]
    expiry       TEXT NOT NULL,
    window       TEXT,
    grade        TEXT,
    score        INTEGER,
    bias_filter  INTEGER NOT NULL,        -- 1 = produced with the bias filter on
    payload      TEXT NOT NULL,           -- full Signal.to_dict() JSON
    updated_at   TEXT NOT NULL,
    UNIQUE (symbol, model, created_time, direction, entry, bias_filter)
);
CREATE INDEX IF NOT EXISTS signals_symbol_time ON signals (symbol, created_time);
CREATE TABLE IF NOT EXISTS ea_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       TEXT NOT NULL,             -- account email from the EA token
    mt_login   TEXT,
    signal_id  INTEGER,
    event      TEXT NOT NULL,             -- placed | filled | tp | sl | breakeven | closed | cancelled | error
    price      REAL,
    volume     REAL,
    profit     REAL,
    detail     TEXT,
    at         TEXT NOT NULL,             -- ISO UTC from the EA
    received   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ea_events_user ON ea_events (user, at);
CREATE TABLE IF NOT EXISTS agent_usage (
    user  TEXT NOT NULL,
    day   TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (user, day)
);
CREATE TABLE IF NOT EXISTS runner_status (
    symbol     TEXT PRIMARY KEY,
    last_run   TEXT NOT NULL,
    last_bar   TEXT,
    signals    INTEGER NOT NULL,
    seconds    REAL NOT NULL,
    error      TEXT
);
CREATE TABLE IF NOT EXISTS layouts (       -- terminal workspaces, synced between web / app / desktop
    user       TEXT NOT NULL,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,              -- JSON written by the terminal
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user, name)
);
"""

MAX_LAYOUTS = 20             # per user
MAX_LAYOUT_BYTES = 256_000   # one saved workspace (charts, indicators, drawings)


class LayoutError(ValueError):
    pass


class Store:
    def __init__(self, path: Path | str = DEFAULT_DB):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # the API reads while the runner writes
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def upsert_signals(self, symbol: str, model_id: str, signals: list[Signal], bias_filter: bool) -> int:
        now = pd.Timestamp.now(tz="UTC").isoformat()
        rows = []
        for s in signals:
            d = s.to_dict()
            rows.append((symbol, s.model, model_id, s.direction, d["created_time"], s.entry, s.stop,
                         json.dumps(d["targets"]), d["expiry"], s.window, s.grade, s.score, int(bias_filter),
                         json.dumps(d, default=str), now))
        with self._conn() as c:
            c.executemany("""
                INSERT INTO signals (symbol, model, model_id, direction, created_time, entry, stop, targets, expiry,
                                     window, grade, score, bias_filter, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (symbol, model, created_time, direction, entry, bias_filter) DO UPDATE SET
                    stop = excluded.stop, targets = excluded.targets, expiry = excluded.expiry,
                    grade = excluded.grade, score = excluded.score, payload = excluded.payload,
                    updated_at = excluded.updated_at
            """, rows)
        return len(rows)

    def prune_signals(self, symbol: str, model_id: str, signals: list[Signal], bias_filter: bool,
                      since: pd.Timestamp) -> int:
        """Deletes stored signals of this symbol / model created since ``since`` that the latest scan no
        longer produces (the model's rules changed, or the setup was recomputed differently), so the
        terminal never shows stale targets. Signals still produced keep their row (and id)."""
        keep = {(pd.Timestamp(s.created_time).isoformat(), int(s.direction), round(float(s.entry), 6)) for s in signals}
        with self._conn() as c:
            rows = c.execute("SELECT id, created_time, direction, entry FROM signals WHERE symbol = ? AND model_id = ? "
                             "AND bias_filter = ? AND created_time >= ?",
                             (symbol, model_id, int(bias_filter), pd.Timestamp(since).isoformat())).fetchall()
            gone = [r["id"] for r in rows if (r["created_time"], int(r["direction"]), round(float(r["entry"]), 6)) not in keep]
            c.executemany("DELETE FROM signals WHERE id = ?", [(i,) for i in gone])
        return len(gone)

    def signals(self, symbol: str, start: pd.Timestamp, end: pd.Timestamp, model_ids: list[str] | None = None,
                bias_filter: bool = True) -> list[dict]:
        q = "SELECT id, model_id, payload FROM signals WHERE symbol = ? AND created_time >= ? AND created_time < ? AND bias_filter = ?"
        args: list = [symbol, start.isoformat(), end.isoformat(), int(bias_filter)]
        if model_ids:
            q += f" AND model_id IN ({','.join('?' * len(model_ids))})"
            args += model_ids
        q += " ORDER BY created_time"
        with self._conn() as c:
            out = []
            for r in c.execute(q, args):
                d = json.loads(r["payload"])
                d["model_id"] = r["model_id"]
                d["id"] = r["id"]
                out.append(d)
            return out

    def live_signals(self, now: pd.Timestamp, models: list[tuple[str, bool]], max_age_minutes: int = 30) -> list[dict]:
        """Signals an EA may still act on: created in the last ``max_age_minutes`` and not expired.
        ``models`` are (model_id, bias_filter) pairs."""
        if not models:
            return []
        start = (now - pd.Timedelta(minutes=max_age_minutes)).isoformat()
        cond = " OR ".join("(model_id = ? AND bias_filter = ?)" for _ in models)
        args = [start, now.isoformat(), now.isoformat()]
        for mid, bias in models:
            args += [mid, int(bias)]
        q = (f"SELECT id, symbol, model_id, payload FROM signals WHERE created_time >= ? AND created_time <= ? "
             f"AND expiry > ? AND ({cond}) ORDER BY created_time")
        with self._conn() as c:
            out = []
            for r in c.execute(q, args):
                d = json.loads(r["payload"])
                d.update(id=r["id"], model_id=r["model_id"], symbol=r["symbol"])
                out.append(d)
            return out

    def add_ea_events(self, user: str, mt_login: str, events: list[dict]) -> int:
        now = pd.Timestamp.now(tz="UTC").isoformat()
        rows = []
        for e in events:
            rows.append((user, mt_login, e.get("signal_id"), str(e.get("event", ""))[:20], e.get("price"),
                         e.get("volume"), e.get("profit"), str(e.get("detail", ""))[:300],
                         str(e.get("at") or now), now))
        with self._conn() as c:
            c.executemany("INSERT INTO ea_events (user, mt_login, signal_id, event, price, volume, profit, detail, at, "
                          "received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        return len(rows)

    def use_agent(self, user: str, limit: int) -> bool:
        """Counts one language-model answer for today; False once ``limit`` is reached (0 = none)."""
        if limit <= 0:
            return False
        day = pd.Timestamp.now(tz="UTC").date().isoformat()
        with self._conn() as c:
            row = c.execute("SELECT count FROM agent_usage WHERE user = ? AND day = ?", (user, day)).fetchone()
            used = row["count"] if row else 0
            if used >= limit:
                return False
            c.execute("INSERT INTO agent_usage (user, day, count) VALUES (?, ?, 1) "
                      "ON CONFLICT (user, day) DO UPDATE SET count = count + 1", (user, day))
        return True

    def ea_events(self, user: str, limit: int = 200) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM ea_events WHERE user = ? ORDER BY id DESC LIMIT ?",
                                               (user, limit))]

    def set_status(self, symbol: str, last_bar: str | None, signals: int, seconds: float, error: str | None = None):
        with self._conn() as c:
            c.execute("""INSERT INTO runner_status (symbol, last_run, last_bar, signals, seconds, error)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON CONFLICT (symbol) DO UPDATE SET last_run = excluded.last_run, last_bar = excluded.last_bar,
                             signals = excluded.signals, seconds = excluded.seconds, error = excluded.error""",
                      (symbol, pd.Timestamp.now(tz="UTC").isoformat(), last_bar, signals, seconds, error))

    def status(self) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM runner_status ORDER BY symbol")]

    # ---- terminal layouts ----------------------------------------------------------------
    def layouts(self, user: str) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute(
                "SELECT name, updated_at, length(data) AS bytes FROM layouts WHERE user = ? ORDER BY updated_at DESC", (user,))]

    def layout(self, user: str, name: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT data, updated_at FROM layouts WHERE user = ? AND name = ?", (user, name)).fetchone()
        return None if r is None else {"name": name, "data": json.loads(r["data"]), "updated_at": r["updated_at"]}

    def save_layout(self, user: str, name: str, data) -> str:
        """Creates or replaces a layout; returns its update time. Raises LayoutError over the limits."""
        name = (name or "").strip()
        if not user or not name or len(name) > 60:
            raise LayoutError("A layout needs a name of 1-60 characters.")
        raw = json.dumps(data, separators=(",", ":"))
        if len(raw.encode()) > MAX_LAYOUT_BYTES:
            raise LayoutError(f"This layout is too large (over {MAX_LAYOUT_BYTES // 1000} KB). Remove some drawings.")
        now = pd.Timestamp.now(tz="UTC").isoformat()
        with self._conn() as c:
            exists = c.execute("SELECT 1 FROM layouts WHERE user = ? AND name = ?", (user, name)).fetchone()
            if not exists:
                n = c.execute("SELECT COUNT(*) FROM layouts WHERE user = ?", (user,)).fetchone()[0]
                if n >= MAX_LAYOUTS:
                    raise LayoutError(f"You can keep up to {MAX_LAYOUTS} layouts. Delete one first.")
            c.execute("INSERT INTO layouts (user, name, data, updated_at) VALUES (?, ?, ?, ?) "
                      "ON CONFLICT (user, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                      (user, name, raw, now))
        return now

    def delete_layout(self, user: str, name: str) -> bool:
        with self._conn() as c:
            return c.execute("DELETE FROM layouts WHERE user = ? AND name = ?", (user, name)).rowcount > 0
