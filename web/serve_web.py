"""ict.iccterminal.trade: the website, the web terminal and the app downloads, from one server
(port 3100). /udf and /api calls are passed to the ICT API, so the browser only ever talks to
this one address.

    /                 website            web/site
    /terminal/        web terminal       web/terminal/dist (built with base /terminal/)
    /downloads/<file> APK / Windows app  <ICT folder>/downloads (+ release.json)
    /api/*, /udf/*    ICT API            http://127.0.0.1:8100

    python web/serve_web.py [--port 3100] [--api http://127.0.0.1:8100]
"""
from __future__ import annotations

import mimetypes
import os
import sys
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse, RedirectResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect
from starlette.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
DIST = HERE / "terminal" / "dist"
SITE = HERE / "site"
DOWNLOADS = HERE.parent / "downloads"
HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"}

# Android only offers to install an APK served with its own type
mimetypes.add_type("application/vnd.android.package-archive", ".apk")


class ImmutableAssets(StaticFiles):
    """The terminal's built files have their content hash in the name (index-B7nWz6EY.js), so phones and
    Cloudflare may keep them for a year: the app then opens without downloading 300 KB again. A new build
    gets new names through index.html, which is never cached."""

    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def inside(root: Path, rel: str) -> Path | None:
    """root/rel when it is an existing file inside root (no "..", no absolute paths), else None."""
    if not rel:
        return None
    base = root.resolve()
    f = (base / rel).resolve()
    return f if f.is_file() and base in f.parents else None


def create_app(api_url: str, dist: Path = DIST, site: Path = SITE, downloads: Path = DOWNLOADS) -> Starlette:
    if not (dist / "index.html").exists():
        raise SystemExit(f"{dist} has no index.html: build the terminal first (npm run build)")
    if not (site / "index.html").exists():
        raise SystemExit(f"{site} has no index.html: the website files are missing")
    client = httpx.AsyncClient(base_url=api_url.rstrip("/"), timeout=120)

    async def proxy(request: Request) -> Response:
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
        # the API sees the visitor's address, not this server's
        headers["x-forwarded-for"] = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")
        try:
            r = await client.request(request.method, request.url.path, params=request.query_params,
                                     content=await request.body(), headers=headers)
        except httpx.HTTPError:
            return Response('{"detail":"ICT Terminal API is not reachable."}', 502, media_type="application/json")
        out = {k: v for k, v in r.headers.items() if k.lower() not in HOP_HEADERS}
        return Response(r.content, r.status_code, headers=out)

    async def ws_proxy(ws: WebSocket) -> None:
        """Live bars: the browser's WebSocket is joined to the API's, both ways."""
        import asyncio
        import websockets
        await ws.accept()
        url = api_url.rstrip("/").replace("http", "ws", 1) + ws.url.path
        try:
            async with websockets.connect(url, max_size=2 ** 20, open_timeout=10) as up:
                async def down() -> None:
                    async for msg in up:
                        await ws.send_text(msg if isinstance(msg, str) else msg.decode())
                async def upward() -> None:
                    while True:
                        await up.send(await ws.receive_text())
                done, pending = await asyncio.wait([asyncio.create_task(down()), asyncio.create_task(upward())],
                                                   return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
        except (OSError, WebSocketDisconnect, websockets.WebSocketException, asyncio.TimeoutError):
            pass
        try:
            await ws.close()
        except RuntimeError:
            pass

    async def terminal_root(request: Request) -> Response:
        return RedirectResponse("/terminal/", 308)

    async def terminal(request: Request) -> Response:
        # files of the build (favicon.svg ...); any other path is the single-page app itself
        f = inside(dist, request.path_params.get("path", ""))
        if f:
            return FileResponse(f)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    async def download(request: Request) -> Response:
        # the folder may not exist yet (no apps published): then every file is simply 404
        f = inside(downloads, request.path_params["path"])
        if not f:
            return PlainTextResponse("Not found", 404)
        return FileResponse(f, headers={"Cache-Control": "no-cache"})

    methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    return Starlette(routes=[
        Route("/udf/{path:path}", proxy, methods=methods),
        Route("/api/{path:path}", proxy, methods=methods),
        WebSocketRoute("/ws/stream", ws_proxy),
        Route("/terminal", terminal_root),
        Mount("/terminal/assets", ImmutableAssets(directory=dist / "assets"), name="terminal-assets"),
        Route("/terminal/{path:path}", terminal),
        Route("/downloads/{path:path}", download),
        Mount("/", StaticFiles(directory=site, html=True), name="site"),
    ])


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 3100
    api = sys.argv[sys.argv.index("--api") + 1] if "--api" in sys.argv else os.getenv("ICT_API_URL", "http://127.0.0.1:8100")
    print(f"ICT Terminal web: http://127.0.0.1:{port} (API {api})", flush=True)
    uvicorn.run(create_app(api), host="127.0.0.1", port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1")
