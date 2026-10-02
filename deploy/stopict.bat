@echo off
REM Stops ICT Terminal's programs only (ICC Terminal keeps running). The ICT Tunnel service stays on.
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" "%~dp0ict_services.py" stop
) else (
    python "%~dp0ict_services.py" stop
)
