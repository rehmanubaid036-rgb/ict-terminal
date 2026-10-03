# CLAUDE.md

Notes for Claude sessions working on this repo. See `README.md` for the project overview.

## Where this code runs

- Windows Server VPS, folder `C:\ICT engine`, user `administrator`.
- The repo was pushed from that folder; the VPS clone tracks `origin/main`.
- Runs alongside ICC Terminal on the same VPS. ICT must not touch ICC: it has its own
  Python (`.venv`), ports (API `127.0.0.1:8100`, admin panel `127.0.0.1:8101`),
  Cloudflare tunnel and scheduled task. Service windows have titles starting with `ICT `.
- Install / update / repair: `oneclickict.bat` (runs `deploy/oneclick_ict.py`).
  Stop ICT only: `ictoneclickclose.bat`. Health check: `vpscheckict.bat`
  (`deploy/vpscheck_ict.py`, report in `deploy/vpscheck_ict_report.txt`).

## VPS access from Claude cloud sessions

- Credentials are in env vars `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD`. Never print or commit them.
- `VPS_HOST` points at the RDP port. OpenSSH Server (`sshd`) is installed and running on
  the VPS (port 22), but the cloud environment's network policy has blocked outbound
  connections to the VPS IP. Direct access needs that host allowed under the
  environment's Network access settings.
- Otherwise: change code here, push, and the user runs on the VPS:
  `cd "C:\ICT engine"` then `git pull`.

## Working with the user

- The user writes Roman Urdu / English; keep replies clear and simple.
- The user operates the VPS through a mobile RDP app: long pasted commands get
  corrupted. Give short PowerShell commands, one per line.
- `winget` is not available on the VPS. Git for Windows is installed; GitHub auth uses
  Git Credential Manager with browser login.

## Repo rules

- `.gitignore` keeps out `.env*`, keys, `*secret*`, `*password*`, `credentials*`,
  database files and backups. Do not commit secrets or databases.
- `mt5/terminal64.exe` and `mt5/MetaEditor64.exe` are over GitHub's 100 MB limit and
  are ignored; they exist only on the VPS. Keep every committed file under 100 MB.
- Cloudflare caches CSS/JS for 4 hours (HTML is not cached). After changing `web/site/style.css`
  or `site.js`, bump the `?v=N` on their links in the site's HTML files.
- The web terminal's source is `web/terminal/` (React + TypeScript + KLineChart 10). Build with
  `cd web/terminal && npm ci && npm run build`; commit the resulting `web/terminal/dist/`.
  Details, features and how to test it: `docs/WEB_TERMINAL.md`.
- `python312/` (bundled Python runtime) and `web/terminal/dist/` (built web terminal)
  are committed on purpose.
