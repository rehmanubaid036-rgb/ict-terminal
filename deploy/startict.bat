@echo off
REM Starts every ICT Terminal program in its own minimized window (run at logon by the
REM "ICT Terminal" scheduled task, and by oneclickict.bat). ICC Terminal is not touched.
REM Every command carries this folder's path, so stopict.bat finds exactly these programs.
cd /d "%~dp0.."
set "ROOT=%CD%"
set "PY=%ROOT%\.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo ICT Terminal is not installed yet: run oneclickict.bat as administrator.
    exit /b 1
)

REM ICT's own MT5 (chart data) is started here, at the same Windows permission level as the
REM programs below; an MT5 opened by hand at another level cannot be reached ("IPC timeout").
set "MT5="
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"ICT_MT5_AXI_DEMO_TERMINAL=" "%ROOT%\api\.env" 2^>nul') do set "MT5=%%b"
if defined MT5 if exist "%MT5%" (
    start "" /min "%MT5%"
    echo Waiting 20 s for MT5 to log in...
    ping -n 21 127.0.0.1 >nul
)

start "ICT Admin Panel" /min /d "%ROOT%\admin_panel" cmd /k ""%PY%" -m waitress --listen=127.0.0.1:8101 --threads=8 --trusted-proxy=127.0.0.1 --trusted-proxy-headers=x-forwarded-proto config.wsgi:application"
ping -n 4 127.0.0.1 >nul
start "ICT API Server" /min /d "%ROOT%\api" cmd /k ""%PY%" -m uvicorn ictapi.main:app --app-dir "%ROOT%\api" --host 127.0.0.1 --port 8100 --proxy-headers"
start "ICT Web Terminal" /min /d "%ROOT%\web" cmd /k ""%PY%" "%ROOT%\web\serve_web.py""
start "ICT Engine Runner" /min /d "%ROOT%\engine" cmd /k ""%PY%" -m ictengine.runner --every 300"
start "ICT Crypto Watcher" /min /d "%ROOT%\admin_panel" cmd /k ""%PY%" "%ROOT%\admin_panel\manage.py" crypto_watch"
start "ICT Signal Alerts" /min /d "%ROOT%\admin_panel" cmd /k ""%PY%" "%ROOT%\admin_panel\manage.py" signal_alerts"

sc query "ICT Tunnel" >nul 2>&1 && sc start "ICT Tunnel" >nul 2>&1
echo ICT Terminal started.
exit /b 0
