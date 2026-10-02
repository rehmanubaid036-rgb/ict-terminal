@echo off
REM ======================================================================
REM  ICT Terminal - close ONLY ICT's programs (VPS)
REM  Right-click > Run as administrator.
REM  ICC Terminal is not touched: whatever Python programs are still running
REM  afterwards are not ICT's (e.g. ICC Terminal), and they are listed below.
REM  Start ICT again with oneclickict.bat (or log off / log on).
REM ======================================================================
REM (the title must not start with "ICT ": those are the service windows)
title ictoneclickclose - close ICT Terminal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Please right-click ictoneclickclose.bat and choose "Run as administrator".
    pause & exit /b 1
)

if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0deploy\ict_services.py" close
) else (
    python "%~dp0deploy\ict_services.py" close
)
echo.
pause
