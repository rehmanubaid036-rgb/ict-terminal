@echo off
REM ICT Terminal - make a user's saved layout the default chart template for new users.
REM   maketemplate.bat someone@mail.com            or   maketemplate.bat someone@mail.com "Layout name"
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0deploy\make_template.py" %*
) else (
    python "%~dp0deploy\make_template.py" %*
)
