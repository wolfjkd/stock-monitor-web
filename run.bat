@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   Stock Monitor Web v3.0
echo   A Stock Price Alert Monitor (Web)
echo ========================================
echo.

set PYTHON=C:\Users\wolfj\.workbuddy\binaries\python\versions\3.13.12\python.exe

REM Check Python
"%PYTHON%" --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found at %PYTHON%
    pause
    exit /b 1
)

REM Check Flask
"%PYTHON%" -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Flask...
    "%PYTHON%" -m pip install flask eltdx
)

echo [INFO] Starting server at http://localhost:5000
echo [INFO] Press Ctrl+C to stop
echo.

"%PYTHON%" app.py
pause
