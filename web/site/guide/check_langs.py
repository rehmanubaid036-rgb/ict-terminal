"""Checks every guide translation against lang/en.json: same keys, sections, block kinds, list lengths,
table sizes, the same `code` snippets and links. Run: python web/site/guide/check_langs.py"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent / "lang"
LANGS = ["en", "hi", "ur", "bn", "ar", "es", "zh", "fr", "pt", "ru", "id", "de", "ja", "tr"]
CODE = re.compile(r"`[^`]+`")
LINK = re.compile(r"\]\(([^)]+)\)")


def shape(block):
    if isinstance(block, str):
        return ("p",)
    k = next(iter(block))
    if k in ("ul", "ol"):
        return (k, len(block[k]))
    if k == "table":
        return (k, len(block[k]["head"]), len(block[k]["rows"]), tuple(len(r) for r in block[k]["rows"]))
    return (k,)


def texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for x in obj:
            yield from texts(x)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from texts(v)


def main() -> int:
    en = json.loads((HERE / "en.json").read_text(encoding="utf8"))
    bad = 0
    for code in LANGS[1:]:
        p = HERE / f"{code}.json"
        if not p.exists():
            print(f"{code}: missing")
            bad += 1
            continue
        try:
            d = json.loads(p.read_text(encoding="utf8"))
        except json.JSONDecodeError as e:
            print(f"{code}: invalid JSON: {e}")
            bad += 1
            continue
        errs = []
        if set(d["ui"]) != set(en["ui"]):
            errs.append(f"ui keys {set(en['ui']) ^ set(d['ui'])}")
        if len(d["ui"]["chips"]) != len(en["ui"]["chips"]):
            errs.append("chips")
        if set(d["caps"]) != set(en["caps"]):
            errs.append(f"caps keys {set(en['caps']) ^ set(d['caps'])}")
        if [s["id"] for s in d["sections"]] != [s["id"] for s in en["sections"]]:
            errs.append("section ids differ")
        else:
            for a, b in zip(en["sections"], d["sections"]):
                if [shape(x) for x in a["b"]] != [shape(x) for x in b["b"]]:
                    errs.append(f"blocks of '{a['id']}' differ")
                ca = sorted(c for t in texts(a["b"]) for c in CODE.findall(t))
                cb = sorted(c for t in texts(b["b"]) for c in CODE.findall(t))
                if ca != cb:
                    errs.append(f"code in '{a['id']}': {set(ca) ^ set(cb)}")
                la = sorted(u for t in texts(a["b"]) for u in LINK.findall(t))
                lb = sorted(u for t in texts(b["b"]) for u in LINK.findall(t))
                if la != lb:
                    errs.append(f"links in '{a['id']}'")
        for t in texts(d):
            if t.count("**") % 2:
                errs.append(f"odd ** in: {t[:60]}")
        print(f"{code}: " + ("ok" if not errs else "; ".join(errs)))
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
