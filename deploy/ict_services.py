"""Stops / lists ICT Terminal's programs only. ICC Terminal is never touched.

    python deploy/ict_services.py stop      # used by stopict.bat and oneclickict.bat
    python deploy/ict_services.py list      # what would be stopped (changes nothing)

A process counts as ICT only when one of these is true (standard library only, any Python):
  * it runs from this folder's .venv, or its command line contains this folder's path
  * it runs the ICT engine runner (python -m ictengine.runner)
  * it is a Python listening on an ICT port (3100 web, 8100 API, 8101 admin)
  * its window is one of ICT's service windows ("ICT Admin Panel", ...)
ICC's ports (8000/8001/8501), its folder and its "ICC ..." windows never match these rules.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICT_PORTS = (3100, 8100, 8101)
WINDOWS = ("ICT Admin Panel", "ICT API Server", "ICT Web Terminal", "ICT Engine Runner", "ICT Crypto Watcher",
           "ICT Signal Alerts")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def root_forms(root: str) -> set[str]:
    """The folder as Windows may spell it in a command line: the long name ("C:\\ICT engine")
    and the 8.3 short name ("C:\\ICTENG~1"); lower-case, no trailing slash."""
    forms = {os.path.abspath(root), os.path.realpath(root)}
    if sys.platform == "win32":
        import ctypes
        buf = ctypes.create_unicode_buffer(32768)
        for fn in (ctypes.windll.kernel32.GetLongPathNameW, ctypes.windll.kernel32.GetShortPathNameW):
            if fn(os.path.abspath(root), buf, len(buf)):
                forms.add(buf.value)
    return {os.path.normcase(f).rstrip("\\/") for f in forms if f}


def is_ict(proc: dict, root, ict_pids: set[int]) -> bool:
    """proc: {"pid", "exe", "cmd"} of a python process; root: the folder, or its root_forms()."""
    roots = {os.path.normcase(os.path.abspath(root)).rstrip("\\/")} if isinstance(root, str) else set(root)
    exe = os.path.normcase(proc.get("exe") or "")
    cmd = os.path.normcase(proc.get("cmd") or "")
    return (any(exe.startswith(os.path.join(r, ".venv") + os.sep) or (r + os.sep) in cmd for r in roots)
            or "ictengine.runner" in cmd or proc["pid"] in ict_pids)


def _ps(command: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
                       capture_output=True, text=True, errors="replace", timeout=90, creationflags=NO_WINDOW)
    return r.stdout


def python_processes() -> list[dict]:
    out = _ps("Get-CimInstance Win32_Process -Filter \"name like 'python%'\" | "
              "Select-Object @{n='pid';e={$_.ProcessId}}, @{n='ppid';e={$_.ParentProcessId}}, "
              "@{n='exe';e={$_.ExecutablePath}}, @{n='cmd';e={$_.CommandLine}} | ConvertTo-Json -Compress")
    try:
        data = json.loads(out) if out.strip() else []
    except ValueError:
        return []
    return [data] if isinstance(data, dict) else data


def port_owners(ports=ICT_PORTS) -> set[int]:
    out = _ps("Get-NetTCPConnection -State Listen -LocalPort " + ",".join(map(str, ports)) +
              " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess")
    return {int(x) for x in out.split() if x.strip().isdigit()}


def ict_processes() -> list[dict]:
    me = {os.getpid(), os.getppid()}
    procs = python_processes()
    by_pid = {p["pid"]: p for p in procs}
    roots, on_ports = root_forms(ROOT), port_owners() & set(by_pid)   # looked up once, not per process
    hits = {p["pid"] for p in procs if p["pid"] not in me and is_ict(p, roots, on_ports)}
    # children of an ICT python (the .venv launcher starts the real interpreter as a child)
    changed = True
    while changed:
        extra = {p["pid"] for p in procs if p.get("ppid") in hits and p["pid"] not in hits | me}
        changed = bool(extra)
        hits |= extra
    return [by_pid[pid] for pid in sorted(hits)]


def stop() -> int:
    # Pythons first and without /T: an MT5 terminal the runner opened keeps running
    stopped = 0
    for _ in range(3):
        procs = ict_processes()
        if not procs:
            break
        for p in procs:
            r = subprocess.run(["taskkill", "/F", "/PID", str(p["pid"])], capture_output=True,
                               creationflags=NO_WINDOW)
            stopped += r.returncode == 0
        time.sleep(2)
    for title in WINDOWS:   # then the empty service windows; elevated ones carry an "Administrator:" prefix
        for pattern in (f"{title}*", f"Administrator:  {title}*", f"Administrator: {title}*"):
            subprocess.run(["taskkill", "/F", "/FI", f"WINDOWTITLE eq {pattern}"],
                           capture_output=True, creationflags=NO_WINDOW)
    left = ict_processes()
    print(f"ICT Terminal stopped ({stopped} process(es))." + (f" Still running: {len(left)}" if left else ""), flush=True)
    return 1 if left else 0


def short_command(cmd: str) -> str:
    """What a python process runs, in a few words: the script or module after "python"."""
    import shlex
    try:
        parts = shlex.split(cmd or "", posix=False)
    except ValueError:
        parts = (cmd or "").split()
    words = [p.strip('"') for p in parts[1:]]
    if words and words[0] == "-m" and len(words) > 1:
        words = words[1:]
    return " ".join(words[:3])[:110] or "python"


def close_report() -> int:
    """ictoneclickclose.bat: stop ICT, then say plainly what is still running (not ICT)."""
    print("Closing ICT Terminal programs only...", flush=True)
    code = stop()
    left_ict = ict_processes()
    ports = port_owners()
    others = [p for p in python_processes() if p["pid"] not in {os.getpid(), os.getppid()}]
    print("", flush=True)
    print("ICT programs still running : " + (str(len(left_ict)) if left_ict else "none"), flush=True)
    print("ICT ports 3100/8100/8101   : " + ("still in use" if ports else "free"), flush=True)
    print(f"Other Python programs      : {len(others)} (these are NOT ICT, e.g. ICC Terminal; they were left alone)",
          flush=True)
    for p in others[:30]:
        print(f"   pid {p['pid']:>6}  {short_command(p.get('cmd') or '')}", flush=True)
    return 1 if left_ict or ports else code


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "stop":
        return stop()
    if cmd == "close":
        return close_report()
    for p in ict_processes():
        print(p["pid"], (p.get("cmd") or "")[:150])
    return 0


if __name__ == "__main__":
    sys.exit(main())
