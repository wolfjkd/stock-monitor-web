@echo off
echo ========================================
echo   Stock Monitor Web v3.0
echo   A股价格预警监控系统（Web版）
echo ========================================
echo.

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.8+
    pause
    exit /b 1
)

REM 检查Flask
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Flask...
    pip install flask
)

echo [INFO] Starting server at http://localhost:5000
echo [INFO] Press Ctrl+C to stop
echo.

python app.py
