"""Serves the admin panel with waitress from any working directory.

    python admin_panel/serve.py [--listen 127.0.0.1:8101]
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)
sys.path.insert(0, str(HERE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from waitress import serve  # noqa: E402

from config.wsgi import application  # noqa: E402

if __name__ == "__main__":
    listen = sys.argv[sys.argv.index("--listen") + 1] if "--listen" in sys.argv else "127.0.0.1:8101"
    print(f"ICT Terminal admin panel: http://{listen}/admin/", flush=True)
    serve(application, listen=listen)
