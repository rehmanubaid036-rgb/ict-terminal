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
CREATE TABLE IF NOT EXISTS paper_accounts (   -- paper trading: one account per user
    user          TEXT PRIMARY KEY,
    balance       REAL NOT NULL,
    start_balance REAL NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user          TEXT NOT NULL,
    data          TEXT NOT NULL,             -- JSON of ictengine.paper.PaperOrder
    status        TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_orders_user ON paper_orders (user, status);
CREATE TABLE IF NOT EXISTS screener (      -- one row per symbol, written by the runner each pass
    symbol     TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_counts (  -- website / terminal use per day, for the admin's statistics
    day     TEXT NOT NULL,                   -- YYYY-MM-DD (UTC)
    metric  TEXT NOT NULL,                   -- site_view, terminal_open, terminal_minute, ...
    key     TEXT NOT NULL DEFAULT '',        -- page, platform, referrer ...
    n       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, key)
);
CREATE TABLE IF NOT EXISTS usage_unique (  -- who was seen on a day (hashed: no IPs or emails are kept)
    day     TEXT NOT NULL,
    metric  TEXT NOT NULL,                   -- site_visitor, terminal_user
    who     TEXT NOT NULL,
    PRIMARY KEY (day, metric, who)
);
CREATE TABLE IF NOT EXISTS ea_state (      -- the latest account snapshot each EA sends (positions, orders)
    user       TEXT NOT NULL,
    mt5_login  TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user, mt5_login)
);
CREATE TABLE IF NOT EXISTS snapshots (     -- chart pictures shared by link (files in data/snapshots)
    id         TEXT PRIMARY KEY,
    user       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    ext        TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_user ON snapshots (user, created_at);
CREATE TABLE IF NOT EXISTS alert_state (   -- server-side chart alerts: what the API's alert watcher already did
    user       TEXT NOT NULL,
    alert_id   TEXT NOT NULL,
    fired_ms   INTEGER,                    -- a price / line / zone alert fired (once, until the user restarts it)
    last_day   TEXT,                       -- a session alert: NY date it last fired
    seen       INTEGER,                    -- an ICT event alert: unix seconds of the newest event told
    PRIMARY KEY (user, alert_id)
);
CREATE TABLE IF NOT EXISTS alert_fired (   -- what the server sent, so the terminal shows it when it opens
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       TEXT NOT NULL,
    alert_id   TEXT NOT NULL,
    at_ms      INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    extra      TEXT NOT NULL DEFAULT '{}',
    sent       TEXT NOT NULL DEFAULT ''    -- the channels it went to
);
CREATE INDEX IF NOT EXISTS alert_fired_user ON alert_fired (user, at_ms);
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

    def signals_window(self, start: pd.Timestamp, end: pd.Timestamp, models: list[tuple[str, bool]] | None = None) -> list[dict]:
        """Signals created in [start, end] of all symbols. ``models`` are (model_id, bias_filter) pairs; None means
        every model, made without the bias filter (each setup once)."""
        args: list = [start.isoformat(), end.isoformat()]
        if models is None:
            cond = "bias_filter = 0"
        elif not models:
            return []
        else:
            cond = " OR ".join("(model_id = ? AND bias_filter = ?)" for _ in models)
            for mid, bias in models:
                args += [mid, int(bias)]
        q = (f"SELECT id, symbol, model_id, bias_filter, payload FROM signals WHERE created_time >= ? AND created_time <= ? "
             f"AND ({cond}) ORDER BY created_time")
        with self._conn() as c:
            out = []
            for r in c.execute(q, args):
                d = json.loads(r["payload"])
                d.update(id=r["id"], model_id=r["model_id"], symbol=r["symbol"], bias_filter=bool(r["bias_filter"]))
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

    # ---- paper trading -----------------------------------------------------------------------
    def paper_account(self, user: str, start: float = 10_000.0) -> dict:
        with self._conn() as c:
            r = c.execute("SELECT * FROM paper_accounts WHERE user = ?", (user,)).fetchone()
            if r is None:
                c.execute("INSERT INTO paper_accounts (user, balance, start_balance, created_at) VALUES (?, ?, ?, ?)",
                          (user, start, start, pd.Timestamp.now(tz="UTC").isoformat()))
                return {"user": user, "balance": start, "start_balance": start}
        return dict(r)

    def paper_set_balance(self, user: str, balance: float, start: float | None = None):
        with self._conn() as c:
            if start is None:
                c.execute("UPDATE paper_accounts SET balance = ? WHERE user = ?", (balance, user))
            else:
                c.execute("UPDATE paper_accounts SET balance = ?, start_balance = ?, created_at = ? WHERE user = ?",
                          (balance, start, pd.Timestamp.now(tz="UTC").isoformat(), user))

    def paper_orders(self, user: str, statuses: tuple[str, ...] | None = None, limit: int = 200) -> list[dict]:
        q, args = "SELECT id, data FROM paper_orders WHERE user = ?", [user]
        if statuses:
            q += f" AND status IN ({','.join('?' * len(statuses))})"
            args += list(statuses)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._conn() as c:
            return [{**json.loads(r["data"]), "id": r["id"]} for r in c.execute(q, args)]

    def paper_save(self, user: str, order: dict) -> int:
        """Inserts (no id) or updates an order; returns its id."""
        now = pd.Timestamp.now(tz="UTC").isoformat()
        data = json.dumps({k: v for k, v in order.items() if k != "id"}, default=str)
        with self._conn() as c:
            if order.get("id"):
                c.execute("UPDATE paper_orders SET data = ?, status = ?, updated_at = ? WHERE id = ? AND user = ?",
                          (data, order["status"], now, order["id"], user))
                return int(order["id"])
            cur = c.execute("INSERT INTO paper_orders (user, data, status, updated_at) VALUES (?, ?, ?, ?)", (user, data, order["status"], now))
            return int(cur.lastrowid)

    def paper_reset(self, user: str, start: float):
        with self._conn() as c:
            c.execute("DELETE FROM paper_orders WHERE user = ?", (user,))
        self.paper_account(user, start)
        self.paper_set_balance(user, start, start)

    # ---- screener ----------------------------------------------------------------------------
    def set_screener(self, symbol: str, row: dict):
        with self._conn() as c:
            c.execute("INSERT INTO screener (symbol, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (symbol) DO UPDATE SET "
                      "data = excluded.data, updated_at = excluded.updated_at",
                      (symbol, json.dumps(row, default=float), pd.Timestamp.now(tz="UTC").isoformat()))

    def screener(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT symbol, data, updated_at FROM screener ORDER BY symbol").fetchall()
        return [{**json.loads(r["data"]), "updated_at": r["updated_at"]} for r in rows]

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

    # ---- usage statistics -------------------------------------------------------------------------
    def count_usage(self, metric: str, key: str = "", n: int = 1, who: str | None = None, unique_metric: str | None = None) -> None:
        day = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d")
        with self._conn() as c:
            c.execute("INSERT INTO usage_counts (day, metric, key, n) VALUES (?, ?, ?, ?) "
                      "ON CONFLICT (day, metric, key) DO UPDATE SET n = n + excluded.n", (day, metric, key[:120], n))
            if who and unique_metric:
                c.execute("INSERT OR IGNORE INTO usage_unique (day, metric, who) VALUES (?, ?, ?)", (day, unique_metric, who[:40]))

    def usage(self, since_day: str) -> dict:
        with self._conn() as c:
            counts = [dict(r) for r in c.execute("SELECT day, metric, key, n FROM usage_counts WHERE day >= ?", (since_day,))]
            uniq = [dict(r) for r in c.execute("SELECT day, metric, COUNT(*) AS n FROM usage_unique WHERE day >= ? GROUP BY day, metric", (since_day,))]
        return {"counts": counts, "unique": uniq}

    # ---- MT5 accounts seen through the EA ---------------------------------------------------------
    def set_ea_state(self, user: str, login: str, data: dict) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO ea_state (user, mt5_login, data, updated_at) VALUES (?, ?, ?, ?) "
                      "ON CONFLICT (user, mt5_login) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                      (user, login, json.dumps(data), pd.Timestamp.now(tz="UTC").isoformat()))

    def ea_states(self, user: str) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT mt5_login, data, updated_at FROM ea_state WHERE user = ? ORDER BY updated_at DESC", (user,)).fetchall()
        return [{"mt5_login": r["mt5_login"], **json.loads(r["data"]), "updated_at": r["updated_at"]} for r in rows]

    # ---- shared chart pictures ------------------------------------------------------------------
    @property
    def snapshot_dir(self) -> Path:
        d = self.path.parent / "snapshots"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def add_snapshot(self, sid: str, user: str, title: str, ext: str, size: int) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO snapshots (id, user, title, ext, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                      (sid, user, title, ext, size, pd.Timestamp.now(tz="UTC").isoformat()))

    def snapshot(self, sid: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT id, user, title, ext, bytes, created_at FROM snapshots WHERE id = ?", (sid,)).fetchone()
        return dict(r) if r else None

    def snapshots(self, user: str, since: str | None = None) -> list[dict]:
        with self._conn() as c:
            q = "SELECT id, title, ext, bytes, created_at FROM snapshots WHERE user = ?" + (" AND created_at >= ?" if since else "") + " ORDER BY created_at DESC LIMIT 200"
            return [dict(r) for r in c.execute(q, (user, since) if since else (user,))]

    def delete_snapshot(self, sid: str, user: str) -> bool:
        row = self.snapshot(sid)
        if not row or row["user"] != user:
            return False
        with self._conn() as c:
            c.execute("DELETE FROM snapshots WHERE id = ?", (sid,))
        (self.snapshot_dir / f"{sid}.{row['ext']}").unlink(missing_ok=True)
        return True

    # ---- server-side chart alerts ---------------------------------------------------------------
    def alert_states(self, user: str) -> dict[str, dict]:
        with self._conn() as c:
            rows = c.execute("SELECT alert_id, fired_ms, last_day, seen FROM alert_state WHERE user = ?", (user,)).fetchall()
        return {r["alert_id"]: dict(r) for r in rows}

    def set_alert_state(self, user: str, alert_id: str, **fields) -> None:
        cols = [k for k in ("fired_ms", "last_day", "seen") if k in fields]
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO alert_state (user, alert_id) VALUES (?, ?)", (user, alert_id))
            if cols:
                c.execute(f"UPDATE alert_state SET {', '.join(k + ' = ?' for k in cols)} WHERE user = ? AND alert_id = ?",
                          (*[fields[k] for k in cols], user, alert_id))

    def add_alert_fired(self, user: str, alert_id: str, at_ms: int, kind: str, text: str, extra: dict | None = None,
                        sent: list[str] | None = None) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO alert_fired (user, alert_id, at_ms, kind, text, extra, sent) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (user, alert_id, int(at_ms), kind, text, json.dumps(extra or {}), ",".join(sent or [])))
            # keep a week
            c.execute("DELETE FROM alert_fired WHERE at_ms < ?", (int(at_ms) - 7 * 86_400_000,))

    def alerts_fired(self, user: str, since_ms: int, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT alert_id, at_ms, kind, text, extra, sent FROM alert_fired WHERE user = ? AND at_ms > ? "
                             "ORDER BY at_ms LIMIT ?", (user, int(since_ms), limit)).fetchall()
        return [{**dict(r), "extra": json.loads(r["extra"] or "{}"), "sent": [x for x in r["sent"].split(",") if x]} for r in rows]

    # ---- chart templates: shared setups every user can open; one of them is what new users see first ----
    def templates(self) -> list[dict]:
        default = self.default_template()
        return [{**r, "default": r["name"] == default} for r in self.layouts(TEMPLATE_OWNER)]

    def template(self, name: str) -> dict | None:
        return self.layout(TEMPLATE_OWNER, name)

    def save_template(self, name: str, data) -> str:
        """Saves a layout as a template, without what belongs to one person (drawings, alerts, watchlists)."""
        return self.save_layout(TEMPLATE_OWNER, name, template_data(data))

    def delete_template(self, name: str) -> bool:
        if self.default_template() == name.strip():
            self.set_default_template(None)
        return self.delete_layout(TEMPLATE_OWNER, name)

    def default_template(self) -> str | None:
        r = self.layout(TEMPLATE_META, "default")
        name = (r or {}).get("data", {}).get("name") if r else None
        return name if name and self.template(name) is not None else None

    def set_default_template(self, name: str | None) -> None:
        if name is None:
            self.delete_layout(TEMPLATE_META, "default")
            return
        if self.template(name) is None:
            raise LayoutError("No template with this name.")
        self.save_layout(TEMPLATE_META, "default", {"name": name.strip()})


TEMPLATE_OWNER = "__template__"       # rows in ``layouts`` that are shared templates
TEMPLATE_META = "__template_meta__"   # which template is the default
_PERSONAL = ("watchlist", "lists", "listName", "flags", "alerts", "alertLog")


def template_data(data) -> dict:
    """A layout without the personal parts: drawings (they belong to past prices), alerts and watchlists."""
    if not isinstance(data, dict):
        raise LayoutError("A template must be a saved layout.")
    out = {k: v for k, v in data.items() if k not in _PERSONAL}
    if isinstance(out.get("charts"), list):
        out["charts"] = [{k: v for k, v in c.items() if k != "drawings"} if isinstance(c, dict) else c for c in out["charts"]]
    return out
