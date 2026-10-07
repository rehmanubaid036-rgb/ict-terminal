"""Market news headlines for the terminal's News tab: public RSS feeds, merged, newest first,
cached for 10 minutes (one fetch serves every user). Only titles and links are shown; the
article opens on the publisher's site.

Feeds come from ICT_NEWS_FEEDS (comma separated URLs) or the defaults below.
"""
from __future__ import annotations

import os
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

DEFAULT_FEEDS = (
    "https://www.fxstreet.com/rss/news",
    "https://www.forexlive.com/feed/news",
)
TTL = 600
_cache: dict = {"at": 0.0, "items": []}
_lock = threading.Lock()
_TAG = re.compile(r"<[^>]+>")


def feeds() -> list[str]:
    raw = os.getenv("ICT_NEWS_FEEDS", "")
    return [u.strip() for u in raw.split(",") if u.strip().startswith("https://")] or list(DEFAULT_FEEDS)


def parse_rss(xml: bytes, source: str) -> list[dict]:
    """RSS 2.0 / Atom items -> {title, link, at (unix s), source}; bad items are skipped."""
    out = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return out
    ns = {"a": "http://www.w3.org/2005/Atom"}
    items = root.findall(".//item") or root.findall(".//a:entry", ns)
    for it in items[:60]:
        tel = it.find("title")
        if tel is None:
            tel = it.find("a:title", ns)
        title = "".join(tel.itertext()).strip() if tel is not None else ""
        link = (it.findtext("link") or "").strip()
        if not link:
            el = it.find("a:link", ns)
            link = el.get("href", "") if el is not None else ""
        when = it.findtext("pubDate") or it.findtext("a:updated", namespaces=ns) or it.findtext("a:published", namespaces=ns) or ""
        try:
            at = int(parsedate_to_datetime(when).timestamp()) if "," in when else int(time.mktime(time.strptime(when[:19], "%Y-%m-%dT%H:%M:%S")))
        except (TypeError, ValueError, IndexError):
            continue
        title = _TAG.sub("", title)[:200]
        if title and link.startswith(("https://", "http://")):
            out.append({"title": title, "link": link, "at": at, "source": source})
    return out


def latest(fetch=None, limit: int = 60) -> list[dict]:
    """Merged headlines, newest first; on errors the last good list is kept."""
    with _lock:
        if time.time() - _cache["at"] < TTL and _cache["items"]:
            return _cache["items"][:limit]
        items = []
        for url in feeds():
            source = re.sub(r"^www\.", "", url.split("/")[2])
            try:
                if fetch is None:
                    req = urllib.request.Request(url, headers={"User-Agent": "ICT-Terminal/1.0 (+news headlines)"})
                    with urllib.request.urlopen(req, timeout=8) as r:
                        data = r.read(2_000_000)
                else:
                    data = fetch(url)
                items += parse_rss(data, source)
            except Exception:  # noqa: BLE001 - one feed down must not break the others
                continue
        if items:
            seen, merged = set(), []
            for x in sorted(items, key=lambda x: -x["at"]):
                key = x["title"].lower()[:80]
                if key not in seen:
                    seen.add(key)
                    merged.append(x)
            _cache.update(at=time.time(), items=merged)
        else:
            _cache["at"] = time.time() - TTL + 120     # try again in 2 minutes
        return _cache["items"][:limit]
