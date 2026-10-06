"""ict_configure: .env merging; it never touches ICC Terminal."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ict_configure as c  # noqa: E402


def test_set_env_updates_appends_and_keeps(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# c\nA=1\nPW=secret\n", encoding="utf-8")
    changed = c.set_env(env, {"A": "2", "B": "3", "PW": "new"}, only_if_empty=("PW",))
    assert changed == ["A", "B"]
    assert c.read_env(env) == {"A": "2", "PW": "secret", "B": "3"}
    assert env.read_text(encoding="utf-8").startswith("# c\n")


def test_writes_only_inside_this_folder():
    src = Path(c.__file__).read_text(encoding="utf-8")
    assert "ICC Tunnel" not in src and "config.yml" not in src and "sc" not in src.split()
