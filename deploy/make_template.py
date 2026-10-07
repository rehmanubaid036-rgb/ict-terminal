"""Makes one user's saved layout the default chart template (what every new user sees first).

    maketemplate.bat someone@mail.com                 picks their layout with "template" / "ict" in the name
    maketemplate.bat someone@mail.com "Layout name"   that exact layout

Only reads that user's layout and writes the template rows in data/ict.db; the user's own layout stays
as it is. Drawings, alerts and watchlists are not copied (they are personal). Later templates can be
managed from the terminal's Templates menu by an admin (staff) account.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "engine"))

from ictengine.store import Store  # noqa: E402

AUTOSAVE = "__autosave__"


def pick(names: list[str], wanted: str | None) -> str | None:
    if wanted:
        return next((n for n in names if n.lower() == wanted.lower()), None)
    named = [n for n in names if n != AUTOSAVE]
    for key in ("template", "ict"):
        hits = [n for n in named if key in n.lower()]
        if len(hits) == 1:
            return hits[0]
    if len(named) == 1:
        return named[0]
    if not named and AUTOSAVE in names:
        return AUTOSAVE           # no named layout: their current screen
    return None


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    email, wanted = argv[0].strip(), (argv[1].strip() if len(argv) > 1 else None)
    store = Store()
    with store._conn() as c:
        users = [r[0] for r in c.execute("SELECT DISTINCT user FROM layouts")]
    user = next((u for u in users if u.lower() == email.lower()), None)
    if user is None:
        print(f"No saved layouts for {email}. They must open the terminal and save the layout first.")
        return 2
    rows = store.layouts(user)
    names = [r["name"] for r in rows]
    print(f"Layouts of {user}:")
    for r in rows:
        print(f"  - {r['name']}  (saved {r['updated_at'][:16]}, {r['bytes']} bytes)")
    name = pick(names, wanted)
    if name is None:
        print('\nWhich one? Run again with the name in quotes, e.g.:  maketemplate.bat ' + email + ' "' + names[0] + '"')
        return 3
    data = store.layout(user, name)["data"]
    title = "ICT Template" if name == AUTOSAVE else name
    store.save_template(title, data)
    store.set_default_template(title)
    print(f'\nOK: "{name}" is now the default template "{title}" '
          f"(chart layout {data.get('layout')}). New users see it first; everyone finds it under Templates.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
