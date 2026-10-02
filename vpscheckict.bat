@echo off
REM ICT Terminal - full health check. Changes nothing (ICC Terminal is only looked at).
REM Copy the result and send it to Claude.
title vpscheckict - ICT Terminal check
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0deploy\vpscheck_ict.py"
) else (
    python "%~dp0deploy\vpscheck_ict.py"
)
echo.
echo Copy the report above (also saved in deploy\vpscheck_ict_report.txt) and send it to Claude.
pause
