@echo off
title ICT Terminal Admin Panel - Setup
cd /d "%~dp0"

echo [1/6] Installing Python packages...
python -m pip install -r requirements.txt || goto :error

echo [2/6] Creating .env files and secrets...
python setup_env.py || goto :error

echo [3/6] Creating / updating the database...
python manage.py migrate || goto :error

echo [4/6] Preparing admin panel styles...
python manage.py collectstatic --noinput >nul || goto :error

echo [5/6] Default plans...
python manage.py seed_plans || goto :error

echo [6/6] Default superadmin (from DJANGO_SUPERUSER_EMAIL / _PASSWORD in .env)...
python manage.py ensure_superuser || goto :error

echo.
echo Setup complete. Start the panel with start_admin_panel.bat
pause
exit /b 0

:error
echo.
echo Setup failed. Read the error above.
pause
exit /b 1
