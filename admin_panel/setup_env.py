"""Creates admin_panel/.env with random secrets and shares INTERNAL_API_SECRET and
ADMIN_PANEL_URL with api/.env (the ICT Terminal FastAPI reads them).
Safe to run again: existing values are kept."""
import secrets
from pathlib import Path

HERE = Path(__file__).resolve().parent
PANEL_ENV = HERE / ".env"
BOT_ENV = HERE.parent / "api" / ".env"
PANEL_URL = "http://127.0.0.1:8101"


def read_env(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    return values


def set_values(path, updates):
    """Replace or append KEY=value lines, leaving everything else untouched."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if "=" in line and not line.lstrip().startswith("#") and key in updates:
            lines[i] = f"{key}={updates[key]}"
            done.add(key)
    for key, value in updates.items():
        if key not in done:
            lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    (HERE / "data").mkdir(exist_ok=True)

    if not PANEL_ENV.exists():
        template = (HERE / ".env.example").read_text(encoding="utf-8")
        PANEL_ENV.write_text(template, encoding="utf-8")
        print("created  admin_panel/.env")

    panel = read_env(PANEL_ENV)
    updates = {}
    if panel.get("DJANGO_SECRET_KEY", "change-me") in ("", "change-me"):
        updates["DJANGO_SECRET_KEY"] = secrets.token_urlsafe(50)
    secret = panel.get("INTERNAL_API_SECRET", "")
    if secret in ("", "change-me"):
        secret = secrets.token_urlsafe(32)
        updates["INTERNAL_API_SECRET"] = secret
    if updates:
        set_values(PANEL_ENV, updates)
        print("set      " + ", ".join(updates) + " in admin_panel/.env")

    set_values(BOT_ENV, {"ADMIN_PANEL_URL": read_env(BOT_ENV).get("ADMIN_PANEL_URL") or PANEL_URL,
                         "INTERNAL_API_SECRET": secret})
    print("shared   INTERNAL_API_SECRET and ADMIN_PANEL_URL with api/.env")


if __name__ == "__main__":
    main()
