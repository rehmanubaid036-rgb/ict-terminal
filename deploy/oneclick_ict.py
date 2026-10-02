"""ICT Terminal one-click install / update / repair for the VPS (run through oneclickict.bat).

Works only inside this folder (e.g. C:\\ICT engine). ICC Terminal is never touched:
  * own Python environment (.venv): ICC's Python packages are not changed
  * own ports 3100 / 8100 / 8101 (ICC: 8000 / 8001 / 8501)
  * own Cloudflare tunnel + "ICT Tunnel" service (ICC's tunnel and config are not touched)
  * own scheduled task "ICT Terminal"; stopping touches only ICT's programs
  * own MT5 terminal for chart data (an MT5 that ICC uses is refused)

Steps: stop ICT -> .venv + packages -> settings -> database backup/migrate/plans/superadmin ->
tunnel -> auto-start -> start -> health check. Safe to run again (update or repair): the
ZIP never contains .env files or databases, so users, signals and settings stay.

    oneclickict.bat ["C:\\path\\to\\terminal64.exe"]
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import time

DEPLOY = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(DEPLOY)
VENV_PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
PANEL = os.path.join(ROOT, "admin_panel")
API_ENV = os.path.join(ROOT, "api", ".env")
TASK = "ICT Terminal"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
ICC_ROOTS = (r"C:\ICC", r"D:\ICC")
# Rehearsal on a development PC only: ICT_ONECLICK_SKIP=tunnel,autostart skips those two steps
SKIP = {s.strip() for s in os.environ.get("ICT_ONECLICK_SKIP", "").lower().split(",") if s.strip()}

# ICT needs Python 3.12+. When the VPS's own Python is older (ICC's 3.11), ICT gets a private
# Python 3.12 inside its folder. It is python.org's official NuGet package: a plain zip, so there
# is no installer, no registry entry, no PATH change, no .py association and no py launcher.
# ICC and the rest of the VPS keep using their Python exactly as before.
MIN_PY = (3, 12)
OWN_PY_DIR = os.path.join(ROOT, "python312")
OWN_PY = os.path.join(OWN_PY_DIR, "python.exe")
PY_PACKAGE = "https://www.nuget.org/api/v2/package/python/3.12.10"

sys.path.insert(0, DEPLOY)
import ict_services  # noqa: E402  (standard library only)

step_no = 0


def step(title):
    global step_no
    step_no += 1
    print(f"\n[{step_no}] {title}", flush=True)


def run(args, cwd=None, check=True, quiet=False):
    print("    > " + " ".join(str(a) for a in args), flush=True)
    kw = {"stdout": subprocess.DEVNULL, "stderr": subprocess.STDOUT} if quiet else {}
    result = subprocess.run(args, cwd=cwd, **kw)
    if check and result.returncode != 0:
        raise SystemExit(f"\nSTOPPED: this step failed (exit {result.returncode}). "
                         "Copy all the text in this window and send it to Claude.")
    return result.returncode


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


def icc_terminals():
    """MT5 terminals ICC Terminal uses (read only): its mt5_terminals.txt list and its .env."""
    found = set()
    for root in ICC_ROOTS:
        bot = os.path.join(root, "CME_Trading_Bot")
        try:
            with open(os.path.join(bot, "mt5_terminals.txt"), encoding="utf-8-sig") as f:
                found |= {os.path.normcase(l.strip().strip('"')) for l in f if l.strip() and not l.lstrip().startswith("#")}
        except OSError:
            pass
        for k, v in read_env(os.path.join(bot, ".env")).items():
            if v.lower().endswith("terminal64.exe"):
                found.add(os.path.normcase(v.strip('"')))
    return found


def choose_mt5(given):
    """ICT's own MT5 for chart data (the engine only reads prices, it never trades with it).
    Order: path given to the .bat, the one already saved, a terminal inside this folder (mt5\\)."""
    icc = icc_terminals()

    def allowed(path):
        if os.path.normcase(path) in icc:
            print(f"    NOT USED: {path} belongs to ICC Terminal. Install a separate Axi demo MT5 for ICT "
                  f"(e.g. into {os.path.join(ROOT, 'mt5')}).", flush=True)
            return False
        return True

    if given:
        if not os.path.exists(given):
            raise SystemExit(f"MT5 terminal not found: {given}")
        if not allowed(given):
            raise SystemExit("Choose an MT5 that ICC Terminal does not use.")
        return given
    saved = read_env(API_ENV).get("ICT_MT5_AXI_DEMO_TERMINAL", "")
    if saved and os.path.exists(saved) and allowed(saved):
        return saved
    own = sorted(glob.glob(os.path.join(ROOT, "mt5", "**", "terminal64.exe"), recursive=True))
    for path in own:
        if allowed(path):
            return path
    print("    No MT5 for ICT yet. Install Axi MT5 into " + os.path.join(ROOT, "mt5") +
          ", log in to the DEMO account once, then run oneclickict.bat again\n"
          "    (or: oneclickict.bat \"C:\\...\\terminal64.exe\"). Everything else is installed now.", flush=True)
    return ""


def python_version(exe):
    """(major, minor) of a python.exe, or None when it does not run."""
    try:
        out = subprocess.run([exe, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"],
                             capture_output=True, text=True, timeout=60, creationflags=NO_WINDOW).stdout.split()
        return int(out[0]), int(out[1])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def venv_version(venv_dir):
    """(major, minor) the .venv was made with (from pyvenv.cfg), or None."""
    try:
        with open(os.path.join(venv_dir, "pyvenv.cfg"), encoding="utf-8") as f:
            for line in f:
                key, _, value = line.partition("=")
                if key.strip() in ("version", "version_info"):
                    major, minor = value.strip().split(".")[:2]
                    return int(major), int(minor)
    except (OSError, ValueError):
        pass
    return None


def signed_by_psf(path):
    """The file carries a valid Python Software Foundation code signature."""
    ps = ("$s = Get-AuthenticodeSignature -LiteralPath '" + path.replace("'", "''") + "'; "
          "\"$($s.Status)|$($s.SignerCertificate.Subject)\"")
    out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                         text=True, errors="replace", creationflags=NO_WINDOW).stdout.strip()
    status, _, subject = out.partition("|")
    return status == "Valid" and "Python Software Foundation" in subject


def unpack_python_package(package, target):
    """Copies the package's tools/ folder (a complete Python) to target; nothing else is written."""
    import zipfile
    staging = target + ".part"
    shutil.rmtree(staging, ignore_errors=True)
    with zipfile.ZipFile(package) as z:
        for name in z.namelist():
            if not name.startswith("tools/") or name.endswith("/"):
                continue
            rel = name[len("tools/"):]
            dest = os.path.normpath(os.path.join(staging, rel))
            if not dest.startswith(os.path.normpath(staging) + os.sep):
                raise SystemExit(f"STOPPED: unexpected path in the Python package: {name}")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(name) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
    if not os.path.isfile(os.path.join(staging, "python.exe")):
        shutil.rmtree(staging, ignore_errors=True)
        raise SystemExit("STOPPED: the Python package has no python.exe.")
    shutil.rmtree(target, ignore_errors=True)
    os.replace(staging, target)


def install_own_python():
    """Python 3.12 (python.org's NuGet package) into this folder only; see MIN_PY above."""
    import tempfile
    import urllib.request
    package = os.path.join(tempfile.gettempdir(), "ict-python-3.12.nupkg")
    print(f"    downloading {PY_PACKAGE}", flush=True)
    urllib.request.urlretrieve(PY_PACKAGE, package)
    print(f"    unpacking into {OWN_PY_DIR} (no installer, not on PATH; ICC's Python is not changed)", flush=True)
    try:
        unpack_python_package(package, OWN_PY_DIR)
    finally:
        os.remove(package)
    for exe in ("python.exe", "python312.dll"):
        if not signed_by_psf(os.path.join(OWN_PY_DIR, exe)):
            shutil.rmtree(OWN_PY_DIR, ignore_errors=True)
            raise SystemExit(f"STOPPED: {exe} in the Python package is not signed by the Python Software Foundation.")
    if (python_version(OWN_PY) or (0, 0)) < MIN_PY:
        raise SystemExit(f"STOPPED: Python 3.12 did not start from {OWN_PY_DIR}.")


def base_python():
    """A Python 3.12+ to build ICT's .venv from: the one running this script when it is new
    enough, else ICT's own private copy (installed on first use)."""
    if sys.version_info[:2] >= MIN_PY:
        return sys.executable
    print(f"    this VPS's Python is {sys.version.split()[0]}; ICT needs 3.12+ and uses its own copy", flush=True)
    if (python_version(OWN_PY) or (0, 0)) < MIN_PY:
        install_own_python()
    return OWN_PY


def backup_accounts_db():
    db = os.path.join(PANEL, "data", "admin_panel.sqlite3")
    if not os.path.exists(db):
        return
    folder = os.path.join(PANEL, "data", "backups")
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, time.strftime("admin_panel-%Y%m%d-%H%M%S.sqlite3"))
    shutil.copy2(db, target)
    print(f"    accounts database backed up: {target}", flush=True)
    for old in sorted(f for f in os.listdir(folder) if f.startswith("admin_panel-"))[:-10]:
        os.remove(os.path.join(folder, old))


def ports_free_of_others():
    """3100/8100/8101 must be free or ICT's own (after the stop step)."""
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "Get-NetTCPConnection -State Listen -LocalPort 3100,8100,8101 -ErrorAction SilentlyContinue | "
                          "ForEach-Object { \"$($_.LocalPort) $((Get-Process -Id $_.OwningProcess).ProcessName)\" }"],
                         capture_output=True, text=True, errors="replace", creationflags=NO_WINDOW).stdout.split("\n")
    busy = [l.strip() for l in out if l.strip()]
    if busy:
        raise SystemExit("STOPPED: another program uses an ICT port: " + "; ".join(busy) +
                         ". ICT needs 3100, 8100 and 8101. Send this to Claude.")


def main():
    mt5_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    for need in ("engine", "api", "admin_panel", os.path.join("web", "terminal", "dist", "index.html"),
                 os.path.join("deploy", "requirements.txt")):
        if not os.path.exists(os.path.join(ROOT, need)):
            raise SystemExit(f"{need} is missing in {ROOT}. Extract the whole ZIP into this folder first.")
    if os.path.normcase(ROOT).startswith(tuple(os.path.normcase(r) for r in ICC_ROOTS)):
        raise SystemExit(f"{ROOT} is inside ICC Terminal's folder. Use a separate folder, e.g. C:\\ICT engine.")
    print(f"ICT Terminal one-click  -  folder {ROOT}  (ICC Terminal is not touched)", flush=True)

    step("Stopping ICT Terminal programs (ICC keeps running)")
    ict_services.stop()
    ports_free_of_others()

    step("ICT's own Python environment (.venv, Python 3.12+)")
    base = base_python()
    venv_dir = os.path.join(ROOT, ".venv")
    made_with = venv_version(venv_dir)
    if os.path.exists(venv_dir) and (made_with is None or made_with < MIN_PY or not os.path.exists(VENV_PY)):
        print(f"    removing ICT's old .venv (made with Python {made_with}); a new one is made", flush=True)
        shutil.rmtree(venv_dir)
    if not os.path.exists(VENV_PY):
        run([base, "-m", "venv", venv_dir])
    if (python_version(VENV_PY) or (0, 0)) < MIN_PY:
        raise SystemExit(f"STOPPED: {VENV_PY} is not Python 3.12+.")
    run([VENV_PY, "--version"])

    step("Python packages into .venv (first time takes a few minutes)")
    pip = [VENV_PY, "-m", "pip", "install", "--quiet", "--disable-pip-version-check"]
    run(pip + ["--upgrade", "pip"], check=False)
    run(pip + ["-r", os.path.join(DEPLOY, "requirements.txt")])
    run(pip + ["-e", os.path.join(ROOT, "engine")])

    step("Settings (.env) and ICT's MT5 data terminal")
    run([VENV_PY, os.path.join(PANEL, "setup_env.py")])
    mt5 = choose_mt5(mt5_arg)
    run([VENV_PY, os.path.join(DEPLOY, "ict_configure.py"), "--skip-tunnel"] + (["--mt5", mt5] if mt5 else []))

    step("Accounts database (backup first), plans, superadmin")
    backup_accounts_db()
    run([VENV_PY, "manage.py", "migrate", "--noinput"], cwd=PANEL)
    run([VENV_PY, "manage.py", "collectstatic", "--noinput"], cwd=PANEL, quiet=True)
    run([VENV_PY, "manage.py", "seed_plans"], cwd=PANEL)
    run([VENV_PY, "manage.py", "ensure_superuser"], cwd=PANEL)

    step("ICT's own Cloudflare tunnel (ICT Tunnel service)")
    if "tunnel" in SKIP:
        print("    skipped (ICT_ONECLICK_SKIP)", flush=True)
    else:
        run([VENV_PY, os.path.join(DEPLOY, "ict_tunnel.py")])

    step("Auto-start when the VPS user logs in (task 'ICT Terminal')")
    if "autostart" not in SKIP:
        run(["schtasks", "/create", "/f", "/tn", TASK, "/sc", "onlogon", "/ru", os.environ.get("USERNAME", "Administrator"),
             "/rl", "highest", "/tr", '"' + os.path.join(DEPLOY, "startict.bat") + '"'], quiet=True)
    else:
        print("    skipped (ICT_ONECLICK_SKIP)", flush=True)

    step("Starting ICT Terminal")
    run(["cmd", "/c", os.path.join(DEPLOY, "startict.bat")])

    step("Health check (waiting 40 s for the servers)")
    time.sleep(40)
    run([VENV_PY, os.path.join(DEPLOY, "vpscheck_ict.py")], check=False)
    print("\nDONE. Copy the report above (also in deploy\\vpscheck_ict_report.txt) and send it to Claude.", flush=True)


if __name__ == "__main__":
    main()
