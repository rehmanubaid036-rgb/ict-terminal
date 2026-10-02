"""ICT Terminal's OWN Cloudflare tunnel ("ict-terminal", Windows service "ICT Tunnel").

ICC Terminal's tunnel, its config.yml and its "ICC Tunnel" service are never read for
writing, changed or restarted. Only the three ICT addresses are pointed at this tunnel:

    ict.iccterminal.trade      -> 127.0.0.1:3100  web terminal
    ictapi.iccterminal.trade   -> 127.0.0.1:8100  API (apps, EA)
    ictadmin.iccterminal.trade -> 127.0.0.1:8101  admin panel

Uses the Cloudflare login certificate (%USERPROFILE%\\.cloudflared\\cert.pem) that already
exists on the VPS from ICC's setup; if it is missing, a browser opens once to log in.
Safe to run again: an existing tunnel / service is reused.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CF_DIR = HERE / "cloudflared"                 # ICT's own folder, never ICC's
EXE = CF_DIR / "cloudflared.exe"
CONFIG = CF_DIR / "config.yml"
TUNNEL = "ict-terminal"
CREDENTIALS = CF_DIR / f"{TUNNEL}.json"
SERVICE = "ICT Tunnel"
CERT = Path.home() / ".cloudflared" / "cert.pem"
DOWNLOAD = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
INGRESS = [("ict.iccterminal.trade", "http://127.0.0.1:3100"),
           ("ictapi.iccterminal.trade", "http://127.0.0.1:8100"),
           ("ictadmin.iccterminal.trade", "http://127.0.0.1:8101")]


def config_text(tunnel_id: str, credentials: Path) -> str:
    rules = "".join(f"  - hostname: {h}\n    service: {s}\n" for h, s in INGRESS)
    return (f"tunnel: {tunnel_id}\n"
            f"credentials-file: {credentials}\n"
            f"ingress:\n{rules}"
            f"  - service: http_status:404\n")


def cf(*args, check=True) -> subprocess.CompletedProcess:
    print("    > cloudflared " + " ".join(args), flush=True)
    r = subprocess.run([str(EXE), *args], capture_output=True, text=True, errors="replace")
    if check and r.returncode != 0:
        raise SystemExit(f"cloudflared {' '.join(args)} failed:\n{r.stdout}{r.stderr}")
    return r


def sc(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["sc", *args], capture_output=True, text=True, errors="replace")


def ensure_exe() -> None:
    CF_DIR.mkdir(parents=True, exist_ok=True)
    if EXE.exists():
        return
    print("    downloading cloudflared (Cloudflare's official release on GitHub)...", flush=True)
    tmp = EXE.with_suffix(".part")
    urllib.request.urlretrieve(DOWNLOAD, tmp)
    tmp.replace(EXE)


def ensure_login() -> None:
    if CERT.exists():
        return
    print("    No Cloudflare login on this VPS user yet. A browser opens: log in and choose iccterminal.trade.",
          flush=True)
    cf("tunnel", "login")
    if not CERT.exists():
        raise SystemExit("Cloudflare login was not completed. Run the one-click again.")


def ensure_tunnel() -> str:
    """Creates the ict-terminal tunnel (or fetches its key again) and returns its id."""
    if not CREDENTIALS.exists():
        r = cf("tunnel", "create", "--credentials-file", str(CREDENTIALS), TUNNEL, check=False)
        if r.returncode != 0:
            if "already exists" not in (r.stdout + r.stderr).lower():
                raise SystemExit(f"could not create the tunnel:\n{r.stdout}{r.stderr}")
            # tunnel exists in the account (earlier install): fetch its key again
            cf("tunnel", "token", "--cred-file", str(CREDENTIALS), TUNNEL)
    return json.loads(CREDENTIALS.read_text(encoding="utf-8"))["TunnelID"]


def ensure_service() -> None:
    bin_path = f'"{EXE}" --no-autoupdate --config "{CONFIG}" tunnel run'
    if sc("query", SERVICE).returncode == 0:
        sc("config", SERVICE, "binPath=", bin_path, "start=", "auto")
        sc("stop", SERVICE)
        for _ in range(30):
            if "STOPPED" in sc("query", SERVICE).stdout:
                break
            time.sleep(1)
    else:
        r = sc("create", SERVICE, "binPath=", bin_path, "start=", "auto", "DisplayName=", "ICT Terminal Cloudflare Tunnel")
        if r.returncode != 0:
            raise SystemExit("could not create the ICT Tunnel service (run as administrator):\n" + r.stdout)
    sc("failure", SERVICE, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/5000")
    sc("start", SERVICE)


def main() -> None:
    ensure_exe()
    ensure_login()
    tunnel_id = ensure_tunnel()
    for host, _ in INGRESS:   # only the ICT records change; ICC's records are not touched
        cf("tunnel", "route", "dns", "--overwrite-dns", TUNNEL, host)
    CONFIG.write_text(config_text(tunnel_id, CREDENTIALS), encoding="utf-8")
    ensure_service()
    print("    ICT Tunnel ready: " + ", ".join(f"https://{h}" for h, _ in INGRESS), flush=True)


if __name__ == "__main__":
    sys.exit(main())
