@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 launcher.py
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel% equ 0 (
  python launcher.py
  exit /b %errorlevel%
)

where python3 >nul 2>nul
if %errorlevel% equ 0 (
  python3 launcher.py
  exit /b %errorlevel%
)

echo Python 3 was not found.
echo Install Python 3 from https://www.python.org/downloads/windows/
echo During setup, enable "Add python.exe to PATH", then run this file again.
pause
exit /b 1
