"""Health check for ICT Terminal on the VPS (run vpscheckict.bat).

Read only: it changes nothing, starts nothing and prints no passwords or keys. Every line is
PASS / FAIL / INFO; the report is also saved to deploy\\vpscheck_ict_report.txt so it can be
copied in one go. It also confirms (read only) that ICC Terminal is still running.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PANEL = os.path.join(ROOT, "admin_panel")
REPORT = os.path.join(HERE, "vpscheck_ict_report.txt")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
PUBLIC = {"Website": "https://ict.iccterminal.trade",
          "Web terminal": "https://ict.iccterminal.trade/terminal/",
          "API": "https://ictapi.iccterminal.trade",
          "Admin panel": "https://ictadmin.iccterminal.trade"}

sys.path.insert(0, HERE)

lines: list[str] = []
fails = 0


def report(ok, name, detail=""):
    """ok: True = PASS, False = FAIL, None = INFO (shown, not counted)."""
    global fails
    tag = "INFO" if ok is None else ("PASS" if ok else "FAIL")
    if ok is False:
        fails += 1
    line = f"[{tag}] {name}" + (f" - {detail}" if detail else "")
    lines.append(line)
    print(line, flush=True)


def section(title):
    lines.extend(["", f"-- {title} --"])
    print(f"\n-- {title} --", flush=True)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None


def http(url, timeout=15, headers=None, post=None):
    """(status, body). HTTP errors are returned, redirects are not followed."""
    data = json.dumps(post).encode() if post is not None else None
    hdrs = {"User-Agent": "ICT-VPS-Check/1.0", **(headers or {})}   # Cloudflare blocks "Python-urllib"
    if data:
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs)
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def check_http(name, url, expect=200, must_contain="", headers=None, post=None):
    try:
        status, body = http(url, headers=headers, post=post)
    except Exception as e:
        report(False, name, f"not answering ({str(e)[:90]})")
        return ""
    ok = status == expect and must_contain in body
    report(ok, name, f"HTTP {status}" + ("" if ok or status != expect else " (unexpected content)"))
    return body if ok else ""


def read_env(path):
    values = {}
    try:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    values[k.strip()] = v.strip()
    except OSError:
        pass
    return values


def ps(command):
    try:
        return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True,
                              text=True, errors="replace", timeout=60, creationflags=NO_WINDOW).stdout
    except Exception:
        return ""


def service_state(name):
    r = subprocess.run(["sc", "query", name], capture_output=True, text=True, errors="replace", creationflags=NO_WINDOW)
    if r.returncode != 0:
        return "not installed"
    return "RUNNING" if "RUNNING" in r.stdout else "not running"


def age_minutes(text):
    try:
        t = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 60
    except ValueError:
        return None


def check_setup(api_env, panel_env):
    section("Setup")
    venv = os.path.normcase(sys.prefix) == os.path.normcase(os.path.join(ROOT, ".venv"))
    report(sys.version_info >= (3, 12), "Python", sys.version.split()[0])
    report(venv, "ICT's own Python environment (.venv)", "" if venv else "missing - run oneclickict.bat")
    for pkg in ("ictengine", "fastapi", "django", "waitress", "MetaTrader5"):
        try:
            __import__(pkg)
            report(True, f"Package {pkg}")
        except Exception as e:
            report(False, f"Package {pkg}", str(e)[:100])
    secret = api_env.get("INTERNAL_API_SECRET", "")
    report(bool(secret) and secret == panel_env.get("INTERNAL_API_SECRET"), "Shared secret API <-> admin panel")
    report(api_env.get("ICT_REQUIRE_AUTH", "true").lower() not in ("0", "false", "no", "off"), "Login required on the API")
    report(panel_env.get("DJANGO_HTTPS", "").lower() == "true" and
           "ictadmin.iccterminal.trade" in panel_env.get("DJANGO_ALLOWED_HOSTS", ""), "Admin panel domain settings")
    report(bool(panel_env.get("DJANGO_SUPERUSER_EMAIL")), "Superadmin email set", panel_env.get("DJANGO_SUPERUSER_EMAIL", ""))
    report(os.path.exists(os.path.join(ROOT, "web", "terminal", "dist", "index.html")), "Web terminal files")
    report(os.path.exists(os.path.join(ROOT, "web", "site", "index.html")), "Website files")
    check_downloads()
    report(os.path.exists(os.path.join(ROOT, "ea", "mt5", "ICT_Bridge.mq5")), "EA source (ea\\mt5\\ICT_Bridge.mq5)")


def check_downloads():
    """The apps the website offers (downloads/release.json and the files it names)."""
    folder = os.path.join(ROOT, "downloads")
    try:
        with open(os.path.join(folder, "release.json"), encoding="utf-8") as f:
            rel = json.load(f)
    except (OSError, ValueError):
        report(False, "App downloads", "downloads\\release.json missing - extract the whole ZIP")
        return
    files = rel.get("files", {})
    for kind in ("android", "windows"):
        info = files.get(kind)
        if not info:
            report(None, f"Download {kind}", "not in this release (website shows 'Coming soon')")
            continue
        path = os.path.join(folder, info.get("file", ""))
        report(os.path.isfile(path), f"Download {kind}", f"{info.get('file')} {info.get('size_mb')} MB, version {rel.get('version')}")


def check_servers():
    section("ICT servers on this VPS")
    https = {"X-Forwarded-Proto": "https"}   # as Cloudflare sends it (waitress trusts 127.0.0.1)
    check_http("Admin panel (127.0.0.1:8101)", "http://127.0.0.1:8101/admin/login/",
               must_contain="csrfmiddlewaretoken", headers=https)
    body = check_http("API server (127.0.0.1:8100)", "http://127.0.0.1:8100/api/v1/health", must_contain='"ok"')
    if body:
        h = json.loads(body)
        report(None, "API", f"{h.get('models')} models")
    body = check_http("Chart feeds (/udf/config)", "http://127.0.0.1:8100/udf/config", must_contain="exchanges")
    if body:
        cfg = json.loads(body)
        feeds = [e["value"] for e in cfg.get("exchanges", [])]
        mt5_feeds = [f for f in feeds if f != "BINANCE"]
        report(bool(mt5_feeds), "Broker (MT5) chart feeds", ", ".join(mt5_feeds) or
               "none - MT5 in <ICT folder>\\mt5 not reachable (open it, log in, run oneclickict.bat)")
        report(True if "BINANCE" in feeds else None, "Binance crypto feed", "top 20 USDT pairs" if "BINANCE" in feeds
               else "not reachable from this VPS")
        report(bool(cfg.get("default_symbol")), "Default chart symbol", cfg.get("default_symbol") or "none")
    body = check_http("API -> admin panel link (plans)", "http://127.0.0.1:8100/api/v1/plans")
    if body:
        try:
            data = json.loads(body)
            plans = data.get("plans", []) if isinstance(data, dict) else data
            report(None, "Plans", ", ".join(str(p.get("name")) for p in plans if isinstance(p, dict)) or "none")
        except ValueError:
            pass
    check_http("Chart data needs login", "http://127.0.0.1:8100/udf/history?symbol=AXI:XAUUSD&resolution=1&from=0&to=60",
               expect=401)
    check_http("EA feed rejects a wrong token", "http://127.0.0.1:8100/api/v1/ea/feed", expect=401,
               post={"ea_token": "vps-check-not-a-token"})
    check_http("Website (127.0.0.1:3100)", "http://127.0.0.1:3100/", must_contain='id="pricing"')
    check_http("Web terminal (127.0.0.1:3100/terminal/)", "http://127.0.0.1:3100/terminal/", must_contain='<div id="root">')
    check_http("Download list (/downloads/release.json)", "http://127.0.0.1:3100/downloads/release.json", must_contain='"files"')
    check_http("Web terminal -> API pass-through", "http://127.0.0.1:3100/api/v1/health", must_contain='"ok"')


def check_engine(mt5_path):
    section("Engine and MT5 data")
    import ict_services
    runner_on = any("ictengine.runner" in (p.get("cmd") or "") for p in ict_services.ict_processes())
    first_pass = "first pass still running (about 10 minutes after a start) - run the check again then"
    db = os.path.join(ROOT, "data", "ict.db")
    if not os.path.exists(db):
        report(None if runner_on else False, "Engine runner", first_pass if runner_on else "not running, no database yet")
    else:
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            status = [dict(r) for r in conn.execute("SELECT * FROM runner_status ORDER BY symbol")]
            total, last = conn.execute("SELECT COUNT(*), MAX(created_time) FROM signals").fetchone()
            conn.close()
            if not status:
                report(None if runner_on else False, "Engine runner",
                       first_pass if runner_on else "not running and no pass recorded")
            for s in status:
                age = age_minutes(s["last_run"])
                ok = not s["error"] and age is not None and age < 20
                report(ok, f"Runner {s['symbol']}",
                       f"last pass {age:.0f} min ago, last bar {str(s['last_bar'])[:16]}, {s['signals']} signals, "
                       f"{s['seconds']:.0f}s" + (f", ERROR {s['error'][:150]}" if s["error"] else ""))
            report(None, "Signals stored", f"{total}, newest {str(last)[:16]}")
        except Exception as e:
            report(False, "Engine database", str(e)[:150])

    # Only ICT's own terminal is ever contacted (never "any running MT5", which could be ICC's)
    if not mt5_path:
        report(False, "ICT MT5 data terminal", "not set - install Axi MT5 into " + os.path.join(ROOT, "mt5") +
               ", log in to the demo once, run oneclickict.bat again")
        return
    if not os.path.exists(mt5_path):
        report(False, "ICT MT5 data terminal", f"{mt5_path} does not exist")
        return
    report(True, "ICT MT5 data terminal path", mt5_path)
    try:
        import MetaTrader5 as mt5
    except ImportError:
        report(False, "MT5 connection", "MetaTrader5 package missing (run oneclickict.bat)")
        return
    if not mt5.initialize(path=mt5_path, timeout=60_000):
        report(False, "MT5 connection", f"not reachable: {mt5.last_error()}")
        return
    try:
        info, term = mt5.account_info(), mt5.terminal_info()
        if info:
            kind = {0: "DEMO", 1: "CONTEST", 2: "REAL"}.get(info.trade_mode, str(info.trade_mode))
            report(True, "MT5 connection", f"{info.server}, {kind} account, connected={bool(term and term.connected)}")
            if kind == "REAL":
                report(None, "MT5 note", "the engine only reads prices; a DEMO account is recommended for ICT's data")
        else:
            report(False, "MT5 connection", "terminal open but not logged in - log in to the demo account once")
        maxbars = getattr(term, "maxbars", 0) if term else 0
        report(True if maxbars >= 1_000_000 else None, "MT5 max bars in chart",
               str(maxbars) + ("" if maxbars >= 1_000_000 else " (set Unlimited: Tools > Options > Charts)"))
    finally:
        mt5.shutdown()


def check_programs():
    section("ICT programs")
    import ict_services
    cmds = " ".join((p.get("cmd") or "").lower() for p in ict_services.ict_processes())
    for marker, name in (("waitress", "Admin panel server"), ("ictapi.main", "API server"),
                         ("serve_web.py", "Web terminal server"), ("ictengine.runner", "Engine runner"),
                         ("crypto_watch", "Crypto payment watcher"), ("signal_alerts", "WhatsApp signal alerts")):
        report(marker in cmds, f"{name} running")
    report(service_state("ICT Tunnel") == "RUNNING", "Cloudflare tunnel service (ICT Tunnel)", service_state("ICT Tunnel"))
    task = subprocess.run(["schtasks", "/query", "/tn", "ICT Terminal"], capture_output=True, text=True,
                          errors="replace", creationflags=NO_WINDOW)
    report(task.returncode == 0, "Auto-start at logon (task 'ICT Terminal')")


def check_public():
    section("Public HTTPS addresses (through Cloudflare)")
    check_http(f"Website {PUBLIC['Website']}", PUBLIC["Website"] + "/", must_contain='id="pricing"')
    check_http(f"Web terminal {PUBLIC['Web terminal']}", PUBLIC["Web terminal"], must_contain='<div id="root">')
    check_http(f"API {PUBLIC['API']}", PUBLIC["API"] + "/api/v1/health", must_contain='"ok"')
    check_http(f"Admin panel {PUBLIC['Admin panel']}", PUBLIC["Admin panel"] + "/admin/login/",
               must_contain="csrfmiddlewaretoken")


def check_icc():
    """Read only: ICC Terminal must still be running next to ICT. Shown as INFO, never changed."""
    section("ICC Terminal (only looked at, never changed)")
    for name, url in (("ICC API (8000)", "http://127.0.0.1:8000/api/v1/health"),
                      ("ICC admin panel (8001)", "http://127.0.0.1:8001/admin/login/"),
                      ("ICC dashboard (8501)", "http://127.0.0.1:8501/_stcore/health")):
        try:
            status, _ = http(url, timeout=8)
            report(None, name, f"answering (HTTP {status})")
        except Exception:
            report(None, name, "not answering")
    report(None, "ICC Tunnel service", service_state("ICC Tunnel"))


def check_vps():
    section("VPS")
    disk = shutil.disk_usage(ROOT)
    report(disk.free > 3e9, "Free disk", f"{disk.free / 1e9:.1f} GB of {disk.total / 1e9:.0f} GB")
    mem = ps("$o=Get-CimInstance Win32_OperatingSystem; \"$($o.FreePhysicalMemory) $($o.TotalVisibleMemorySize)\"").split()
    if len(mem) == 2 and all(m.isdigit() for m in mem):
        free, total = int(mem[0]) / 1e6, int(mem[1]) / 1e6
        report(True if free > 0.4 else None, "Free RAM", f"{free:.1f} GB of {total:.1f} GB")


def main():
    now = datetime.now(timezone.utc)
    try:
        with open(os.path.join(ROOT, "VERSION.txt"), encoding="utf-8") as f:
            version = f.read().strip()
    except OSError:
        version = "?"
    lines.append(f"ICT Terminal VPS check  {now:%Y-%m-%d %H:%M} UTC  version {version}  (folder {ROOT})")
    print(lines[0], flush=True)
    api_env, panel_env = read_env(os.path.join(ROOT, "api", ".env")), read_env(os.path.join(PANEL, ".env"))
    for part in (lambda: check_setup(api_env, panel_env), check_servers,
                 lambda: check_engine(api_env.get("ICT_MT5_AXI_DEMO_TERMINAL", "")),
                 check_programs, check_public, check_icc, check_vps):
        try:
            part()
        except Exception as e:   # one broken part must not hide the rest of the report
            report(False, "check crashed", f"{type(e).__name__}: {str(e)[:150]}")
    lines.extend(["", f"RESULT: {fails} problem(s) found." if fails else "RESULT: all checks passed."])
    print("\n" + lines[-1])
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\nReport saved: {REPORT}")


if __name__ == "__main__":
    main()
