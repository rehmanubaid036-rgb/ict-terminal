@echo off
REM ======================================================================
REM  ICT Terminal - ONE CLICK install / update / repair (VPS)
REM  1. Extract the ICT Terminal ZIP into this folder (e.g. C:\ICT engine)
REM  2. Right-click oneclickict.bat > Run as administrator
REM  ICC Terminal is NOT touched: own Python (.venv), own ports, own tunnel,
REM  own scheduled task. Optional: the MT5 terminal for ICT's chart data:
REM     oneclickict.bat "C:\ICT engine\mt5\terminal64.exe"
REM ======================================================================
REM (the title must not start with "ICT ": those are the service windows)
title oneclickict - ICT Terminal setup
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Please right-click oneclickict.bat and choose "Run as administrator".
    pause & exit /b 1
)

python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found - downloading Python 3.13 from python.org...
    powershell -NoProfile -Command "Invoke-WebRequest https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe -OutFile $env:TEMP\python-setup.exe" || goto :error
    "%TEMP%\python-setup.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1 || goto :error
    set "PATH=C:\Program Files\Python313;C:\Program Files\Python313\Scripts;%PATH%"
)

python "%~dp0deploy\oneclick_ict.py" %* || goto :error
echo.
pause
exit /b 0

:error
echo.
echo Setup stopped. Copy all the text in this window and send it to Claude.
pause
exit /b 1
