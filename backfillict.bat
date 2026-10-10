@echo off
REM ICT Terminal - downloads as much MT5 history as the broker gives (M1 M5 M15 H1) into the cache, for backtests.
REM Read only: never trades. Safe to stop (close the window) and start again: finished months are skipped.
title backfillict - ICT history download
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0deploy\backfill_ict.py" %*
) else (
    python "%~dp0deploy\backfill_ict.py" %*
)
echo.
pause
