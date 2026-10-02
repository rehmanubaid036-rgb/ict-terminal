@echo off
title ICT Terminal Admin Panel
cd /d "%~dp0"
echo Admin panel: http://127.0.0.1:8101/admin/
python -m waitress --listen=127.0.0.1:8101 config.wsgi:application
pause
