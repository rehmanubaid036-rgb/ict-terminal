"""oneclickict / vpscheckict helpers: ICC Terminal must never be matched or used."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ict_services as svc  # noqa: E402
import ict_tunnel  # noqa: E402
import oneclick_ict as oc  # noqa: E402

ROOT = r"C:\ICT engine"


def p(cmd="", exe=r"C:\Program Files\Python313\python.exe", pid=10, ppid=1):
    return {"pid": pid, "ppid": ppid, "exe": exe, "cmd": cmd}


@pytest.mark.parametrize("proc", [
    p(exe=r"C:\ICT engine\.venv\Scripts\python.exe"),
    p(r'"C:\Program Files\Python313\python.exe" "C:\ICT engine\web\serve_web.py"'),
    p(r'python.exe -m uvicorn ictapi.main:app --app-dir "C:\ICT engine\api" --port 8100'),
    p(r'"C:\ICT engine\.venv\Scripts\python.exe" "C:\ICT engine\admin_panel\manage.py" crypto_watch'),
    p("python.exe -m ictengine.runner --every 300"),
    p("python.exe -m waitress --listen=127.0.0.1:8101 config.wsgi:application", pid=77),   # found by its port
])
def test_ict_processes_match(proc):
    assert svc.is_ict(proc, ROOT, {77})


@pytest.mark.parametrize("proc", [
    p(r"python -m uvicorn api_server:app --host 0.0.0.0 --port 8000"),                      # ICC API
    p(r"python -m waitress --listen=127.0.0.1:8001 config.wsgi:application"),               # ICC admin
    p(r"python -m streamlit run dashboard.py --server.port 8501"),                          # ICC dashboard
    p(r'python "C:\ICC\CME_Trading_Bot\mt5_trade_watcher.py"'),
    p(r"python manage.py crypto_watch"),                                                     # ICC's watcher
    p(r'python "C:\ICT engine backup\x.py"'),                                                # similar folder name
    p(exe=r"C:\ICC\.venv\Scripts\python.exe"),
])
def test_icc_processes_never_match(proc):
    assert not svc.is_ict(proc, ROOT, {77})


def test_tunnel_config_only_ict_hosts():
    text = ict_tunnel.config_text("abc-123", Path(r"C:\ICT engine\deploy\cloudflared\ict-terminal.json"))
    assert text.startswith("tunnel: abc-123\n")
    assert "ict.iccterminal.trade" in text and "127.0.0.1:3100" in text and "127.0.0.1:8100" in text
    hosts = [l.split("hostname: ")[1] for l in text.splitlines() if "hostname: " in l]
    assert hosts == ["ict.iccterminal.trade", "ictapi.iccterminal.trade", "ictadmin.iccterminal.trade"]
    assert "127.0.0.1:8000" not in text and "127.0.0.1:8001" not in text and "8501" not in text   # nothing of ICC
    assert text.rstrip().endswith("- service: http_status:404")
    assert ict_tunnel.SERVICE == "ICT Tunnel" and ict_tunnel.CF_DIR.parent == Path(ict_tunnel.__file__).parent


def test_icc_mt5_is_refused(tmp_path, monkeypatch):
    icc = tmp_path / "ICC"
    (icc / "CME_Trading_Bot").mkdir(parents=True)
    icc_mt5 = tmp_path / "IC Markets" / "terminal64.exe"
    icc_mt5.parent.mkdir()
    icc_mt5.write_text("x")
    (icc / "CME_Trading_Bot" / "mt5_terminals.txt").write_text(f"# master\n\"{icc_mt5}\"\n", encoding="utf-8")
    monkeypatch.setattr(oc, "ICC_ROOTS", (str(icc),))
    monkeypatch.setattr(oc, "ROOT", str(tmp_path / "ICT engine"))
    monkeypatch.setattr(oc, "API_ENV", str(tmp_path / "none.env"))
    with pytest.raises(SystemExit):
        oc.choose_mt5(str(icc_mt5))
    assert oc.choose_mt5("") == ""                                   # nothing of ICT's own yet
    own = tmp_path / "ICT engine" / "mt5" / "Axi" / "terminal64.exe"
    own.parent.mkdir(parents=True)
    own.write_text("x")
    assert oc.choose_mt5("") == str(own)


def test_saved_mt5_kept(tmp_path, monkeypatch):
    mt5 = tmp_path / "axi" / "terminal64.exe"
    mt5.parent.mkdir()
    mt5.write_text("x")
    env = tmp_path / ".env"
    env.write_text(f"ICT_MT5_AXI_DEMO_TERMINAL={mt5}\n", encoding="utf-8")
    monkeypatch.setattr(oc, "ICC_ROOTS", (str(tmp_path / "noicc"),))
    monkeypatch.setattr(oc, "API_ENV", str(env))
    assert oc.choose_mt5("") == str(mt5)


@pytest.mark.skipif(sys.platform != "win32", reason="8.3 names are Windows only")
def test_long_and_short_folder_names_both_match(tmp_path):
    """Found in the laptop rehearsal: started via the long name, stopped via the 8.3 short name,
    the crypto watcher (matched only by folder path) was missed."""
    import ctypes
    root = tmp_path / "ICT engine"
    (root / "admin_panel").mkdir(parents=True)
    buf = ctypes.create_unicode_buffer(1024)
    assert ctypes.windll.kernel32.GetShortPathNameW(str(root), buf, 1024)
    short = buf.value
    for given in (str(root), short):            # however the stop script was started
        forms = svc.root_forms(given)
        for spelled in (str(root), short):       # however the program was started
            cmd = f'"{spelled}\\.venv\\Scripts\\python.exe" "{spelled}\\admin_panel\\manage.py" crypto_watch'
            assert svc.is_ict(p(cmd), forms, set()), (given, spelled)
            assert svc.is_ict(p(exe=f"{spelled}\\.venv\\Scripts\\python.exe"), forms, set())
        assert not svc.is_ict(p(r'python "C:\ICC\admin_panel\manage.py" crypto_watch'), forms, set())


def test_check_engine_first_pass_is_info_not_fail(tmp_path, monkeypatch):
    import vpscheck_ict as chk
    monkeypatch.setattr(chk, "ROOT", str(tmp_path))          # no data/ict.db yet
    monkeypatch.setattr(chk, "lines", [])
    for running, expected_fails in ((True, 1), (False, 2)):   # the 1 left is "MT5 not set"
        monkeypatch.setattr(chk, "fails", 0)
        monkeypatch.setattr(svc, "ict_processes",
                            lambda r=running: [p("python -m ictengine.runner --every 300")] if r else [])
        chk.check_engine("")
        assert chk.fails == expected_fails, (running, chk.lines)
    assert any(l.startswith("[INFO] Engine runner - first pass") for l in chk.lines)


def test_no_hidden_escapes_in_windows_paths():
    """"downloads\release.json" written with one backslash becomes a carriage return (found in
    review). No string constant in the VPS scripts may hold \r, \t, \a, \b, \f or \v."""
    import ast
    bad = []
    for f in Path(__file__).resolve().parent.glob("*.py"):
        if f.name.startswith("test_"):
            continue                       # the tests spell these characters on purpose
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if any(c in node.value for c in "\r\t\a\b\f\v"):
                    bad.append(f"{f.name}:{node.lineno}")
    assert not bad, bad


def test_close_report_names_programs_briefly():
    assert svc.short_command(r'"C:\Program Files\Python313\python.exe" manage.py crypto_watch') == "manage.py crypto_watch"
    assert svc.short_command(r'python -m uvicorn api_server:app --host 0.0.0.0 --port 8000') == "uvicorn api_server:app --host"
    assert svc.short_command("") == "python"


def test_bat_files_are_clean_crlf():
    """cmd.exe needs CRLF, and a stray control character (e.g. a bell from a mangled backslash)
    silently breaks a path. Found once in startict.bat; checked for every .bat we ship."""
    root = Path(__file__).resolve().parents[1]
    bats = sorted(root.glob("*.bat")) + sorted((root / "deploy").glob("*.bat"))
    assert len(bats) >= 5
    for f in bats:
        data = f.read_bytes()
        assert not any(b in data for b in (bytes([0]), bytes([7]), bytes([8]), bytes([11]), bytes([12]))), f.name
        lines = data.split(bytes([10]))[:-1]
        assert lines and all(line.endswith(bytes([13])) for line in lines), f"{f.name} is not CRLF"
